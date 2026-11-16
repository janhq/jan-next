//! Op-family lists for the diagnostic: the fixed Quick preset, and the
//! per-model plan a caller passes on `--diagnose-plan`.
//!
//! Deliberately outside the `engine` feature: these are pure data, so
//! `cargo test` covers them with no C++ toolchain and no ggml, exactly as
//! [`super::diagnose`] is.

use serde::{Deserialize, Serialize};

use super::diag::FamilyFilter;

/// What the root is asked to run for a model, as the worker receives it on
/// `--diagnose-plan`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelPlan {
    /// The model's file name, for the `start` event. Never the directory: that
    /// is the user's and means nothing to a result.
    pub model: String,
    pub families: Vec<FamilyFilter>,
}

/// Families every transformer graph contains, and which are small enough to
/// run whole.
const BASE_FAMILIES: &[&str] = &[
    "ADD", "SUB", "MUL", "DIV", "SCALE", "NORM", "RMS_NORM", "SOFT_MAX", "GET_ROWS", "SET_ROWS",
    "ROPE", "CPY", "CONT", "CONCAT", "SILU", "GELU", "SWIGLU", "GEGLU",
];

/// Types every attention matmul uses whatever the weights are quantized to:
/// the KV cache defaults to f16 and the activations are f32. Leaving them out
/// would narrow `MUL_MAT` to the weight kernels alone and miss the attention
/// ones, which is where a broken device usually shows.
const ALWAYS_MATMUL_TYPES: &[&str] = &["f32", "f16"];

/// The weight types real downloads use, for the Quick preset's `MUL_MAT`.
/// Upstream also tests several research and accelerator-specific formats that
/// no model on the hub ships.
const COMMON_MATMUL_TYPES: &[&str] = &[
    "f32", "f16", "bf16", "q4_0", "q8_0", "q2_K", "q3_K", "q4_K", "q5_K", "q6_K", "iq4_xs", "mxfp4",
];

/// Head sizes the overwhelming majority of chat models use. Quick is a fixed
/// list, so this is a judgement about the population.
const COMMON_HEAD_SIZES: &[u64] = &[64, 128];

/// Upstream's `-p` for a matmul over `types`: an alternation anchored on the
/// trailing comma of `type_a=<name>,` so `q4_0` cannot match `q4_0_whatever`
/// and a short name cannot prefix a longer one.
fn matmul_filter(types: &[&str]) -> String {
    let mut names = types.to_vec();
    for always in ALWAYS_MATMUL_TYPES {
        if !names.contains(always) {
            names.push(always);
        }
    }
    format!("type_a=({}),", names.join("|"))
}

/// The Quick preset: the small families whole, plus the three expensive ones
/// narrowed to what real models use.
///
/// `MUL_MAT` and `FLASH_ATTN_EXT` are most of what a model spends its time in,
/// but an unfiltered `FLASH_ATTN_EXT` is 5,439 cases; narrowing them is what
/// makes including them affordable.
pub fn quick_families() -> Vec<FamilyFilter> {
    let matmul = Some(matmul_filter(COMMON_MATMUL_TYPES));
    let heads = COMMON_HEAD_SIZES
        .iter()
        .map(|h| h.to_string())
        .collect::<Vec<_>>()
        .join("|");

    let mut out: Vec<FamilyFilter> = BASE_FAMILIES
        .iter()
        .map(|f| FamilyFilter::new(*f, None))
        .collect();
    out.push(FamilyFilter {
        family: "MUL_MAT".into(),
        params: matmul.clone(),
    });
    out.push(FamilyFilter {
        family: "MUL_MAT_ID".into(),
        params: matmul,
    });
    out.push(FamilyFilter::new(
        "FLASH_ATTN_EXT",
        Some(&format!("hsk=({heads}),hsv=({heads}),")),
    ));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn filter_for<'a>(families: &'a [FamilyFilter], name: &str) -> Option<&'a FamilyFilter> {
        families.iter().find(|f| f.family == name)
    }

    #[test]
    fn the_matmul_filter_always_carries_the_attention_types() {
        let params = matmul_filter(&["q4_K"]);
        assert!(params.contains("q4_K"), "{params}");
        assert!(params.contains("f16"), "{params}");
        assert!(params.contains("f32"), "{params}");
        assert!(
            params.ends_with("),"),
            "the trailing comma anchors it: {params}"
        );
    }

    #[test]
    fn a_type_is_not_repeated_when_the_model_already_has_it() {
        let params = matmul_filter(&["f32", "f16"]);
        assert_eq!(params, "type_a=(f32|f16),");
    }

    #[test]
    fn the_quick_preset_covers_the_expensive_families_under_a_filter() {
        let families = quick_families();
        for name in ["MUL_MAT", "MUL_MAT_ID", "FLASH_ATTN_EXT"] {
            let f = filter_for(&families, name).unwrap_or_else(|| panic!("{name} is planned"));
            assert!(f.params.is_some(), "{name} must be narrowed");
        }
        // Every base family runs whole: they are small and on every token's path.
        for name in BASE_FAMILIES {
            assert_eq!(
                filter_for(&families, name).map(|f| f.params.clone()),
                Some(None),
                "{name}"
            );
        }
    }

    #[test]
    fn the_plan_round_trips_through_json() {
        let plan = ModelPlan {
            model: "qwen3-8b-q4_k_m.gguf".into(),
            families: vec![
                FamilyFilter::new("MUL_MAT", Some("type_a=(q4_K|f32|f16),")),
                FamilyFilter::new("FLASH_ATTN_EXT", None),
            ],
        };
        let json = serde_json::to_string(&plan).unwrap();
        assert_eq!(serde_json::from_str::<ModelPlan>(&json).unwrap(), plan);
        assert!(
            !json.contains(r#""params":null"#),
            "an absent filter is omitted: {json}"
        );
    }
}
