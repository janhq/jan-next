//! Parsing of the llama.cpp router preset INI the worker serves.
//!
//! Lives in the library rather than the worker binary because the reload
//! endpoint re-reads the file at runtime, so both the startup path and the
//! HTTP layer need it.

use std::collections::HashMap;

use super::registry::LoadSpec;

/// Section names from a preset. `[*]` is the shared defaults block, not a
/// model, and the C++ loader applies it to every section.
pub fn sections(ini: &str) -> Vec<String> {
    ini.lines()
        .map(str::trim)
        .filter_map(|l| l.strip_prefix('[')?.strip_suffix(']'))
        .filter(|s| *s != "*")
        .map(str::to_string)
        .collect()
}

/// The body of one section, used to tell a changed model from an unchanged one
/// across a reload. Lines are kept verbatim apart from trimming, so a
/// whitespace-only edit does not look like a settings change.
fn section_bodies(ini: &str) -> HashMap<String, Vec<String>> {
    let mut out: HashMap<String, Vec<String>> = HashMap::new();
    let mut current: Option<String> = None;
    for line in ini.lines().map(str::trim) {
        if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            current = Some(name.to_string());
            out.entry(name.to_string()).or_default();
            continue;
        }
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        if let Some(name) = &current {
            out.entry(name.clone()).or_default().push(line.to_string());
        }
    }
    out
}

/// A key from the shared `[*]` block.
///
/// Read on the Rust side as well as by the C++ loader because the worker has to
/// act on two of them before any model is loaded: `slot-save-path` names a
/// directory llama.cpp *throws* on if it does not exist
/// (`--slot-save-path` in `common/arg.cpp`), and the KV state store has to
/// agree with llama.cpp on where files land.
pub fn shared_value(ini: &str, key: &str) -> Option<String> {
    let mut in_shared = false;
    for line in ini.lines().map(str::trim) {
        if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            in_shared = name == "*";
            continue;
        }
        if !in_shared || line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            if k.trim() == key {
                return Some(v.trim().to_string());
            }
        }
    }
    None
}

/// Worker-only key: a section whose only key is `alias-of = <section>` is not
/// a model but a second name for that section. llama.cpp's loader ignores it
/// (`ignore_unknown_keys`), and requests naming the alias reach the target's
/// engine, so one file serves both names without loading it twice.
pub const ALIAS_KEY: &str = "alias-of";

/// A parsed preset: how each model starts, and which names are aliases.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Preset {
    pub specs: HashMap<String, LoadSpec>,
    /// Alias name to the model section it serves.
    pub aliases: HashMap<String, String>,
}

/// Parses a preset into model specs and aliases.
///
/// An alias must name a model section, never another alias or itself, and
/// carry no other key: settings on it would have nothing to apply to.
pub fn parse(ini_path: &str, ini: &str) -> Result<Preset, String> {
    let bodies = section_bodies(ini);
    let mut aliases = HashMap::new();
    for section in sections(ini) {
        let body = bodies.get(&section).map(Vec::as_slice).unwrap_or_default();
        let targets: Vec<&str> = body.iter().filter_map(|line| alias_target(line)).collect();
        match targets.as_slice() {
            [] => {}
            [target] if body.len() == 1 => {
                aliases.insert(section, (*target).to_string());
            }
            [_] => {
                return Err(format!(
                    "alias [{section}] sets keys other than {ALIAS_KEY}"
                ))
            }
            _ => return Err(format!("alias [{section}] names more than one model")),
        }
    }
    let specs = specs(ini_path, ini);
    for (alias, target) in &aliases {
        if !specs.contains_key(target) {
            return Err(format!(
                "alias [{alias}] names {target}, which is not a model section"
            ));
        }
    }
    Ok(Preset { specs, aliases })
}

fn alias_target(line: &str) -> Option<&str> {
    let (key, value) = line.split_once('=')?;
    (key.trim() == ALIAS_KEY).then(|| value.trim())
}

/// Load specs for every model in a preset; alias sections are not models.
///
/// The spec carries the section body so `Registry::reload` can diff it. Two
/// presets that differ only in a model the caller did not touch therefore
/// leave that model loaded, which is the whole point of reloading rather than
/// restarting.
pub fn specs(ini_path: &str, ini: &str) -> HashMap<String, LoadSpec> {
    let mut bodies = section_bodies(ini);
    let shared = bodies.get("*").cloned().unwrap_or_default();
    sections(ini)
        .into_iter()
        .filter_map(|section| {
            let own = bodies.remove(&section).unwrap_or_default();
            if own.iter().any(|line| alias_target(line).is_some()) {
                return None;
            }
            let mut body = shared.clone();
            body.extend(own);
            body.sort();
            Some((
                section.clone(),
                LoadSpec::Preset {
                    ini_path: ini_path.to_string(),
                    section,
                    body,
                },
            ))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const INI: &str = "\
[*]
parallel = 1

[Qwen3-0_6B-IQ4_XS]
model = /models/qwen.gguf
load-on-startup = false

[sentence-transformer-mini]
model = /models/st.gguf
embeddings = true
";

    #[test]
    fn sections_skips_the_shared_defaults_block() {
        assert_eq!(
            sections(INI),
            vec!["Qwen3-0_6B-IQ4_XS", "sentence-transformer-mini"]
        );
    }

    #[test]
    fn sections_tolerates_indentation_and_blank_files() {
        assert_eq!(sections("  [a]  \n key = 1"), vec!["a"]);
        assert!(sections("").is_empty());
        assert!(sections("key = 1\n# comment").is_empty());
    }

    #[test]
    fn a_shared_key_is_read_only_from_the_star_section() {
        let ini = "[*]\nslot-save-path = /a/b\n\n[m]\nslot-save-path = /c/d\n";
        assert_eq!(
            shared_value(ini, "slot-save-path"),
            Some("/a/b".to_string()),
            "a per-model override must not be mistaken for the engine-wide value"
        );
        assert_eq!(shared_value(ini, "absent"), None);
        assert_eq!(
            shared_value("[m]\nslot-save-path = /c/d\n", "slot-save-path"),
            None
        );
    }

    #[test]
    fn a_shared_value_keeps_paths_with_spaces_and_equals_signs() {
        let ini = "[*]\nslot-save-path = /home/a b/Jan Data/cache\n";
        assert_eq!(
            shared_value(ini, "slot-save-path"),
            Some("/home/a b/Jan Data/cache".to_string())
        );
        assert_eq!(
            shared_value("[*]\nchat-template = a=b\n", "chat-template"),
            Some("a=b".to_string())
        );
    }

    #[test]
    fn a_model_id_containing_brackets_is_not_mistaken_for_a_section() {
        assert!(sections("model = /a/[b].gguf").is_empty());
    }

    #[test]
    fn a_spec_carries_the_shared_defaults_so_a_change_there_reloads_every_model() {
        let base = specs("/p.ini", INI);
        let edited = specs("/p.ini", &INI.replace("parallel = 1", "parallel = 4"));
        for id in base.keys() {
            assert_ne!(base[id], edited[id], "{id} should differ");
        }
    }

    #[test]
    fn editing_one_model_leaves_the_others_specs_untouched() {
        let base = specs("/p.ini", INI);
        let edited = specs(
            "/p.ini",
            &INI.replace("load-on-startup = false", "load-on-startup = true"),
        );
        assert_ne!(base["Qwen3-0_6B-IQ4_XS"], edited["Qwen3-0_6B-IQ4_XS"]);
        assert_eq!(
            base["sentence-transformer-mini"],
            edited["sentence-transformer-mini"]
        );
    }

    // Comments and blank lines are not settings; a reload triggered by one
    // would cold-load the user's chat model for nothing.
    #[test]
    fn comments_and_blank_lines_do_not_count_as_a_change() {
        let commented = specs("/p.ini", &INI.replace("[*]", "# note\n\n[*]"));
        assert_eq!(specs("/p.ini", INI), commented);
    }

    // Key order within a section is an artifact of how the preset is written.
    #[test]
    fn key_order_within_a_section_does_not_count_as_a_change() {
        let reordered = specs("/p.ini", "[a]\nmodel = /m.gguf\nembeddings = true\n");
        let original = specs("/p.ini", "[a]\nembeddings = true\nmodel = /m.gguf\n");
        assert_eq!(original, reordered);
    }

    const ALIASED: &str = "\
[*]
parallel = 1

[qwen]
model = /models/qwen.gguf

[local]
alias-of = qwen
";

    #[test]
    fn an_alias_section_is_a_second_name_not_a_model() {
        let preset = parse("/p.ini", ALIASED).unwrap();
        assert_eq!(preset.specs.keys().collect::<Vec<_>>(), vec!["qwen"]);
        assert_eq!(
            preset.aliases.get("local").map(String::as_str),
            Some("qwen")
        );
    }

    // The point of an alias: retargeting it must not reload the model it named.
    #[test]
    fn retargeting_an_alias_leaves_every_model_spec_unchanged() {
        let two = format!("{ALIASED}\n[gemma]\nmodel = /models/gemma.gguf\n");
        let moved = parse(
            "/p.ini",
            &two.replace("alias-of = qwen", "alias-of = gemma"),
        )
        .unwrap();
        let before = parse("/p.ini", &two).unwrap();
        assert_eq!(before.specs, moved.specs);
        assert_eq!(
            moved.aliases.get("local").map(String::as_str),
            Some("gemma")
        );
    }

    #[test]
    fn an_alias_must_name_a_model_section_and_nothing_else() {
        let dangling = ALIASED.replace("alias-of = qwen", "alias-of = absent");
        assert!(parse("/p.ini", &dangling).unwrap_err().contains("absent"));
        let chained = format!("{ALIASED}\n[other]\nalias-of = local\n");
        assert!(parse("/p.ini", &chained).is_err(), "an alias of an alias");
        let itself = ALIASED.replace("alias-of = qwen", "alias-of = local");
        assert!(parse("/p.ini", &itself).is_err());
        let extra = ALIASED.replace("alias-of = qwen", "alias-of = qwen\nctx-size = 4096");
        assert!(parse("/p.ini", &extra).unwrap_err().contains("other than"));
        let twice = ALIASED.replace("alias-of = qwen", "alias-of = qwen\nalias-of = qwen");
        assert!(parse("/p.ini", &twice).is_err());
    }

    #[test]
    fn a_preset_without_aliases_parses_to_its_specs() {
        let preset = parse("/p.ini", INI).unwrap();
        assert!(preset.aliases.is_empty());
        assert_eq!(preset.specs, specs("/p.ini", INI));
    }
}
