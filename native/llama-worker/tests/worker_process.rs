//! The worker binary's process contract: the handshake line, bearer auth on
//! the listing, and exit on stdin EOF. Needs no model; preset sections only
//! register models, and nothing here asks for one to load.
#![cfg(feature = "engine")]

use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

const KEY: &str = "test-key";

fn spawn(args: &[&str]) -> Child {
    Command::new(env!("CARGO_BIN_EXE_jan-llama-worker"))
        .args(args)
        .env("JAN_LLAMA_API_KEY", KEY)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .expect("spawn the worker")
}

async fn handshake(child: &mut Child) -> serde_json::Value {
    let stdout = child.stdout.take().expect("piped stdout");
    let mut lines = BufReader::new(stdout).lines();
    let line = tokio::time::timeout(Duration::from_secs(60), lines.next_line())
        .await
        .expect("handshake within 60s")
        .expect("readable stdout")
        .expect("a handshake line");
    serde_json::from_str(&line).expect("the handshake is JSON")
}

/// Well under the worker's 10 s drain, so an idle keep-alive connection that
/// held shutdown for the whole drain fails the test.
const EXIT_WITHIN: Duration = Duration::from_secs(5);

async fn exits_on_stdin_eof(mut child: Child) {
    drop(child.stdin.take());
    let status = tokio::time::timeout(EXIT_WITHIN, child.wait())
        .await
        .expect("exit soon after stdin closes")
        .expect("wait for the worker");
    assert!(status.success(), "worker exited with {status}");
}

#[tokio::test(flavor = "multi_thread")]
async fn serves_an_empty_registry_and_exits_on_stdin_eof() {
    let mut child = spawn(&[]);
    let hs = handshake(&mut child).await;
    assert_eq!(hs["pid"].as_u64(), child.id().map(u64::from));
    assert_eq!(hs["models"], serde_json::json!([]));
    assert!(
        hs.get("cuda_toolkit").is_some(),
        "cuda_toolkit is always present"
    );
    assert!(hs["devices"].is_array() || hs["devices"].is_null());
    let port = hs["port"].as_u64().expect("a numeric port");
    assert!(port > 0);

    let url = format!("http://127.0.0.1:{port}/v1/models");
    let client = reqwest::Client::new();
    let unauthorized = client.get(&url).send().await.expect("request");
    assert_eq!(unauthorized.status(), reqwest::StatusCode::UNAUTHORIZED);
    let listed: serde_json::Value = client
        .get(&url)
        .bearer_auth(KEY)
        .send()
        .await
        .expect("request")
        .json()
        .await
        .expect("json");
    assert_eq!(listed["data"], serde_json::json!([]));

    exits_on_stdin_eof(child).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn registers_preset_sections_without_loading_them() {
    let dir = tempfile::tempdir().expect("tempdir");
    let preset = dir.path().join("router.preset.ini");
    std::fs::write(
        &preset,
        "[*]\nctx-size = 512\n\n[zeta]\nmodel = /nonexistent/z.gguf\n\n[alpha]\nmodel = /nonexistent/a.gguf\n",
    )
    .expect("write the preset");

    let mut child = spawn(&["--preset", preset.to_str().expect("utf-8 path")]);
    let hs = handshake(&mut child).await;
    assert_eq!(hs["models"], serde_json::json!(["alpha", "zeta"]));

    let port = hs["port"].as_u64().expect("a numeric port");
    let listed: serde_json::Value = reqwest::Client::new()
        .get(format!("http://127.0.0.1:{port}/v1/models"))
        .bearer_auth(KEY)
        .send()
        .await
        .expect("request")
        .json()
        .await
        .expect("json");
    let mut ids: Vec<(String, String)> = listed["data"]
        .as_array()
        .expect("a data array")
        .iter()
        .map(|m| {
            (
                m["id"].as_str().unwrap_or_default().to_string(),
                m["status"]["value"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
            )
        })
        .collect();
    ids.sort();
    assert_eq!(
        ids,
        [
            ("alpha".to_string(), "unloaded".to_string()),
            ("zeta".to_string(), "unloaded".to_string())
        ]
    );

    exits_on_stdin_eof(child).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn rejects_an_unknown_flag() {
    let status = spawn(&["--no-such-flag"]).wait().await.expect("wait");
    assert_eq!(status.code(), Some(2));
}
