//! Upgrade-path compatibility: thread data written by past releases must stay
//! readable by current code.
//!
//! Everything under `tests/fixtures/upgrade/` is real bytes written by the
//! named release (0.8.3 stable on macOS for the thread files), committed so a
//! schema drift that would silently eat user data fails here instead of on a
//! user machine. Threads are plain per-thread JSON/JSONL files.
//!
//! When a release intentionally changes the thread schema, commit the old
//! release's output as a new fixture directory under
//! `tests/fixtures/upgrade/<release>/` and add assertions for it (pass that
//! directory to `fixture_root`); update an existing fixture only when the
//! current schema itself is being pinned, never to make a test pass.

use app_lib::core::threads::helpers::read_messages_from_file;
use app_lib::core::threads::utils::{get_messages_path, get_thread_dir, get_thread_metadata_path};
use serde_json::Value;
use std::path::PathBuf;

/// Root of a committed release data-folder fixture. Mirrors the layout of
/// `~/Library/Application Support/Jan/data` (macOS) / `%APPDATA%\Jan\data`
/// (Windows): `threads/<id>/{thread.json,messages.jsonl}`.
fn fixture_root(release: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/upgrade")
        .join(release)
}

fn read_thread_metadata(release: &str, thread_id: &str) -> Value {
    let path = get_thread_metadata_path(&fixture_root(release), thread_id).unwrap();
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("{release} thread metadata {path:?} unreadable: {e}"));
    serde_json::from_str(&raw).expect("thread.json must parse as JSON")
}

fn read_all_messages(release: &str, thread_id: &str) -> Vec<Value> {
    // The reader returns Ok(vec![]) for a missing file, which would turn a
    // layout-constant drift into a confusing downstream length failure —
    // assert the resolved path exists first so the cause is named.
    let path = get_messages_path(&fixture_root(release), thread_id).unwrap();
    assert!(
        path.exists(),
        "{release} messages file missing at {path:?} — layout constant drifted"
    );
    read_messages_from_file(&fixture_root(release), thread_id)
        .unwrap_or_else(|e| panic!("{release} messages for {thread_id} failed to parse: {e}"))
}

#[test]
fn threads_written_by_0_8_3_resolve_and_parse() {
    let thread_ids = [
        "1fa772e9-47e5-4a8c-a664-4b1cef37c5aa",
        "784952d3-dc72-474e-ab24-0d78e7035280",
    ];
    for id in thread_ids {
        let dir = get_thread_dir(&fixture_root("0.8.3"), id).unwrap();
        assert!(dir.is_dir(), "0.8.3 thread dir {id} missing from fixtures");
        let metadata = read_thread_metadata("0.8.3", id);
        assert_eq!(
            metadata["object"], "thread",
            "0.8.3 thread.json lost its `object` discriminator"
        );
        assert!(
            metadata["title"].is_string(),
            "0.8.3 thread.json lost its `title`"
        );
        assert!(
            !metadata["assistants"]
                .as_array()
                .expect("assistants")
                .is_empty(),
            "0.8.3 thread.json carried a default assistant; schema must keep parsing it"
        );
    }
}

#[test]
fn messages_written_by_0_8_3_round_trip_through_the_current_reader() {
    // Seeded during the 0.8.3 QA run: user message plus the mock provider's
    // reply. Both turns must survive the current JSONL reader.
    let messages = read_all_messages("0.8.3", "784952d3-dc72-474e-ab24-0d78e7035280");
    assert!(
        messages.len() >= 2,
        "0.8.3 thread should have at least a user and an assistant turn"
    );
    assert_eq!(messages[0]["role"], "user");
    assert_eq!(messages[1]["role"], "assistant");
    // 0.8.3 content shape: content[0] = {type: "text", text: {value: "..."}}.
    let user_text = messages[0]["content"][0]["text"]["value"]
        .as_str()
        .expect("0.8.3 user message text must be readable");
    assert!(
        user_text.contains("QA thread 1"),
        "0.8.3 message content drifted: {user_text}"
    );
}

#[test]
fn thread_dir_layout_matches_current_path_resolution() {
    // get_thread_dir/get_messages_path are what every reader resolves through;
    // if the layout constants drift (e.g. `threads` renamed), this fails.
    let id = "1fa772e9-47e5-4a8c-a664-4b1cef37c5aa";
    assert!(get_thread_dir(&fixture_root("0.8.3"), id).unwrap().is_dir());
    let messages = read_all_messages("0.8.3", id);
    assert!(
        !messages.is_empty(),
        "0.8.3 messages must not read as empty"
    );
}
