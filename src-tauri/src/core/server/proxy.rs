use futures_util::StreamExt;
use http_body_util::combinators::BoxBody;
use http_body_util::{BodyExt, Empty, Full, StreamBody};
use hyper::body::Bytes;
use hyper::body::{Frame, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use jan_utils::{
    is_cors_header, is_same_or_app_origin, is_trusted_origin, is_valid_host, remove_prefix,
};
use reqwest::Client;
use serde_json;
use std::collections::HashMap;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;
use tauri_plugin_llamacpp::state::LlamacppState;
use tokio::sync::Mutex;

use crate::core::state::{ProviderConfig, ServerHandle};

use crate::core::openai_schema::{
    http_status_indicates_api_key_retry, normalize_openai_tools_in_chat_body,
};

type ResBody = BoxBody<Bytes, Infallible>;

fn full<B: Into<Bytes>>(chunk: B) -> ResBody {
    Full::new(chunk.into()).boxed()
}

fn empty() -> ResBody {
    Empty::<Bytes>::new().boxed()
}

/// hyper 1.0 dropped `Body::channel`; this mpsc-backed `StreamBody` restores a
/// sender handle for the streaming/passthrough paths. `send_data` returns
/// `Result<(), ()>` so existing `.is_err()` disconnect checks compile unchanged.
struct BodySender(tokio::sync::mpsc::Sender<Result<Frame<Bytes>, Infallible>>);

impl BodySender {
    async fn send_data(&mut self, data: Bytes) -> Result<(), ()> {
        self.0.send(Ok(Frame::data(data))).await.map_err(|_| ())
    }
}

fn body_channel() -> (BodySender, ResBody) {
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Frame<Bytes>, Infallible>>(32);
    let body = BodyExt::boxed(StreamBody::new(
        tokio_stream::wrappers::ReceiverStream::new(rx),
    ));
    (BodySender(tx), body)
}

/// Keeps `lease` alive until `body` has been read to its end or dropped, which
/// is when the client has everything it asked the engine for or has gone away.
fn hold_lease(body: ResBody, lease: tauri_plugin_llamacpp::state::EngineLease) -> ResBody {
    BodyExt::boxed(lease.guard(body))
}


/// Configuration for the proxy server
#[derive(Clone)]
pub struct ProxyConfig {
    pub prefix: String,
    pub proxy_api_key: String,
    pub trusted_hosts: Vec<Vec<String>>,
    pub host: String,
    pub port: u16,
    /// "Allow cross-origin requests" setting. When off, only the server's own
    /// pages and the app webview may call it from a browser context.
    pub cors_enabled: bool,
}

/// Whether a request carrying this `Origin` may proceed. Requests without an
/// Origin (curl, SDKs, CLI tools, LAN clients) always may; browser requests
/// must come from a trusted origin (see `jan_utils::is_trusted_origin`).
///
/// Runs on every non-preflight request, before auth and body parsing, because
/// a browser sends "simple" cross-origin POSTs (e.g. `text/plain`) without a
/// preflight, so CORS headers alone do not stop the request from executing.
pub(crate) fn origin_allowed(
    origin: &str,
    host_header: &str,
    trusted_hosts: &[Vec<String>],
    cors_enabled: bool,
) -> bool {
    if origin.is_empty() {
        return true;
    }
    // Same-origin trust relies on the Host header naming this server, so only
    // a Host that passes validation counts.
    let host = if is_valid_host(host_header, trusted_hosts) {
        host_header
    } else {
        ""
    };
    if cors_enabled {
        is_trusted_origin(origin, host, trusted_hosts)
    } else {
        is_same_or_app_origin(origin, host)
    }
}

/// The request's `Origin` header, or "" when there is none. None when the
/// header is present but not visible ASCII: such a request must be refused,
/// not treated as one without an origin.
pub(crate) fn request_origin(headers: &hyper::HeaderMap) -> Option<&str> {
    match headers.get(hyper::header::ORIGIN) {
        None => Some(""),
        Some(value) => value.to_str().ok(),
    }
}

/// Determines the final destination path based on the original request path
pub fn get_destination_path(original_path: &str, prefix: &str) -> String {
    remove_prefix(original_path, prefix)
}

/// The loopback endpoint local-model requests are forwarded to: the engine
/// worker's `/v1` surface, or None when no engine is running.
pub(crate) async fn engine_upstream(
    llama_state: &LlamacppState,
    destination_path: &str,
) -> Option<(String, String)> {
    let guard = llama_state.engine.lock().await;
    guard.as_ref().map(|h| {
        (
            format!("http://127.0.0.1:{}/v1{}", h.port, destination_path),
            h.api_key.clone(),
        )
    })
}

pub(crate) async fn engine_list_models(
    llama_state: &LlamacppState,
    client: &Client,
) -> Vec<String> {
    let (url, key) = match engine_upstream(llama_state, "/models").await {
        Some(v) => v,
        None => return Vec::new(),
    };
    let resp = match client
        .get(&url)
        .header("Authorization", format!("Bearer {key}"))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            log::warn!("Failed to query the engine's /v1/models: {e}");
            return Vec::new();
        }
    };
    if !resp.status().is_success() {
        return Vec::new();
    }
    let json: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    json.get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("id").and_then(|v| v.as_str()).map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

/// Handles the proxy request logic
#[allow(clippy::too_many_arguments)]
async fn proxy_request(
    req: Request<Incoming>,
    client: Client,
    config: ProxyConfig,
    llama_state: Arc<LlamacppState>,
    provider_configs: Arc<Mutex<HashMap<String, ProviderConfig>>>,
) -> Result<Response<ResBody>, hyper::Error> {
    if req.method() == hyper::Method::OPTIONS {
        log::debug!(
            "Handling CORS preflight request from {:?} {:?}",
            req.headers().get(hyper::header::HOST),
            req.headers()
                .get(hyper::header::ACCESS_CONTROL_REQUEST_METHOD)
        );

        let host = req
            .headers()
            .get(hyper::header::HOST)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

        let origin = req
            .headers()
            .get(hyper::header::ORIGIN)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

        let requested_method = req
            .headers()
            .get("Access-Control-Request-Method")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

        let allowed_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"];
        let method_allowed = requested_method.is_empty()
            || allowed_methods
                .iter()
                .any(|&method| method.eq_ignore_ascii_case(requested_method));

        if !method_allowed {
            log::warn!("CORS preflight: Method '{requested_method}' not allowed");
            return Ok(Response::builder()
                .status(StatusCode::METHOD_NOT_ALLOWED)
                .body(full("Method not allowed"))
                .unwrap());
        }

        let request_path = req.uri().path();
        let whitelisted_paths = ["/openapi.json"];
        let is_whitelisted_path = whitelisted_paths.contains(&request_path);

        let is_trusted = if is_whitelisted_path {
            log::debug!(
                "CORS preflight: Bypassing host check for whitelisted path: {request_path}"
            );
            true
        } else if !host.is_empty() {
            log::debug!(
                "CORS preflight: Host is '{host}', trusted hosts: {:?}",
                config.trusted_hosts
            );
            is_valid_host(host, &config.trusted_hosts)
        } else {
            log::warn!("CORS preflight: No Host header present");
            false
        };

        if !is_trusted {
            log::warn!("CORS preflight: Host '{host}' not trusted for path '{request_path}'");
            return Ok(Response::builder()
                .status(StatusCode::FORBIDDEN)
                .body(full("Host not allowed"))
                .unwrap());
        }

        let requested_headers = req
            .headers()
            .get("Access-Control-Request-Headers")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

        let allowed_headers = [
            "accept",
            "accept-language",
            "authorization",
            "cache-control",
            "connection",
            "content-type",
            "dnt",
            "host",
            "if-modified-since",
            "keep-alive",
            "origin",
            "user-agent",
            "x-api-key",
            "x-csrf-token",
            "x-forwarded-for",
            "x-forwarded-host",
            "x-forwarded-proto",
            "x-requested-with",
            "x-stainless-arch",
            "x-stainless-lang",
            "x-stainless-os",
            "x-stainless-package-version",
            "x-stainless-retry-count",
            "x-stainless-runtime",
            "x-stainless-runtime-version",
            "x-stainless-timeout",
        ];

        let headers_valid = if requested_headers.is_empty() {
            true
        } else {
            requested_headers
                .split(',')
                .map(|h| h.trim())
                .all(|header| {
                    allowed_headers
                        .iter()
                        .any(|&allowed| allowed.eq_ignore_ascii_case(header))
                })
        };

        if !headers_valid {
            log::warn!("CORS preflight: Some requested headers not allowed: {requested_headers}");
            return Ok(Response::builder()
                .status(StatusCode::FORBIDDEN)
                .body(full("Headers not allowed"))
                .unwrap());
        }

        let mut response = Response::builder()
            .status(StatusCode::OK)
            .header("Access-Control-Allow-Methods", allowed_methods.join(", "))
            .header("Access-Control-Allow-Headers", allowed_headers.join(", "))
            .header("Access-Control-Max-Age", "86400")
            .header(
                "Vary",
                "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
            );

        if !origin.is_empty() {
            if origin_allowed(origin, host, &config.trusted_hosts, config.cors_enabled) {
                response = response
                    .header("Access-Control-Allow-Origin", origin)
                    .header("Access-Control-Allow-Credentials", "true");
            } else {
                log::warn!(
                    "CORS preflight: Origin '{origin}' is not trusted, not reflecting origin"
                );
            }
        }

        log::debug!("CORS preflight response: host_trusted={is_trusted}, origin='{origin}'");
        return Ok(response.body(empty()).unwrap());
    }

    let (parts, body) = req.into_parts();

    let Some(origin_header) = request_origin(&parts.headers).map(str::to_string) else {
        log::warn!("Rejected request with an Origin header that is not visible ASCII");
        return Ok(Response::builder()
            .status(StatusCode::FORBIDDEN)
            .header("Vary", "Origin")
            .body(full("Origin not allowed"))
            .unwrap());
    };

    let host_header = parts
        .headers
        .get(hyper::header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    if !origin_allowed(
        &origin_header,
        &host_header,
        &config.trusted_hosts,
        config.cors_enabled,
    ) {
        log::warn!("Rejected request from untrusted origin '{origin_header}'");
        return Ok(Response::builder()
            .status(StatusCode::FORBIDDEN)
            .header("Vary", "Origin")
            .body(full("Origin not allowed"))
            .unwrap());
    }

    let original_path = parts.uri.path();
    let headers = parts.headers.clone();

    let path = get_destination_path(original_path, &config.prefix);
    let method = parts.method.clone();

    let whitelisted_paths = [
        "/openapi.json",
    ];
    let is_whitelisted_path = whitelisted_paths.contains(&path.as_str());

    if !is_whitelisted_path {
        if !host_header.is_empty() {
            if !is_valid_host(&host_header, &config.trusted_hosts) {
                let mut error_response = Response::builder().status(StatusCode::FORBIDDEN);
                error_response = add_cors_headers_with_host_and_origin(
                    error_response,
                    &host_header,
                    &origin_header,
                    &config.trusted_hosts,
                );
                return Ok(error_response.body(full("Invalid host header")).unwrap());
            }
        } else {
            let mut error_response = Response::builder().status(StatusCode::BAD_REQUEST);
            error_response = add_cors_headers_with_host_and_origin(
                error_response,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );
            return Ok(error_response.body(full("Missing host header")).unwrap());
        }
    } else {
        log::debug!("Bypassing host validation for whitelisted path: {path}");
    }

    if !is_whitelisted_path && !config.proxy_api_key.is_empty() {
        // Check Authorization header (Bearer token)
        let auth_valid = parts
            .headers
            .get(hyper::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|auth_str| auth_str.strip_prefix("Bearer "))
            .map(|token| token == config.proxy_api_key)
            .unwrap_or(false);

        // Check X-Api-Key header
        let api_key_valid = parts
            .headers
            .get("X-Api-Key")
            .and_then(|v| v.to_str().ok())
            .map(|key| key == config.proxy_api_key)
            .unwrap_or(false);

        if !auth_valid && !api_key_valid {
            let mut error_response = Response::builder().status(StatusCode::UNAUTHORIZED);
            error_response = add_cors_headers_with_host_and_origin(
                error_response,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );
            return Ok(error_response
                .body(full("Invalid or missing authorization token"))
                .unwrap());
        }
    } else if is_whitelisted_path {
        log::debug!("Bypassing authorization check for whitelisted path: {path}");
    }

    if path.contains("/configs") {
        let mut error_response = Response::builder().status(StatusCode::NOT_FOUND);
        error_response = add_cors_headers_with_host_and_origin(
            error_response,
            &host_header,
            &origin_header,
            &config.trusted_hosts,
        );
        return Ok(error_response.body(full("Not Found")).unwrap());
    }

    let original_path = parts.uri.path();
    let destination_path = get_destination_path(original_path, &config.prefix);

    // Initialize variables that will be set in the match
    let mut session_api_keys: Vec<String> = Vec::new();
    #[allow(unused_assignments)]
    let mut buffered_body: Option<Bytes> = None;
    let mut target_base_url: Option<String> = None;

    match (method.clone(), destination_path.as_str()) {
        (hyper::Method::POST, "/chat/completions")
        | (hyper::Method::POST, "/completions")
        | (hyper::Method::POST, "/embeddings") => {
            log::info!(
                "Handling POST request to {destination_path} requiring model lookup in body",
            );
            let body_bytes = match body.collect().await {
                Ok(c) => c.to_bytes(),
                Err(_) => {
                    let mut error_response =
                        Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR);
                    error_response = add_cors_headers_with_host_and_origin(
                        error_response,
                        &host_header,
                        &origin_header,
                        &config.trusted_hosts,
                    );
                    return Ok(error_response
                        .body(full("Failed to read request body"))
                        .unwrap());
                }
            };
            buffered_body = Some(body_bytes.clone());

            match serde_json::from_slice::<serde_json::Value>(&body_bytes) {
                Ok(mut json_body) => {
                    // Work around strict JSON-schema converters that reject property schemas
                    // of the form `{ "description": "..." }` (missing `type`).
                    // This happens for OpenAI-style tool schemas used with /chat/completions.
                    if destination_path == "/chat/completions" {
                        normalize_openai_tools_in_chat_body(&mut json_body);
                    }
                    if let Ok(cleaned) = serde_json::to_vec(&json_body) {
                        buffered_body = Some(cleaned.into());
                    }

                    if let Some(model_id) = json_body.get("model").and_then(|v| v.as_str()) {
                        log::debug!("Extracted model_id: {model_id}");

                        // First, check if there's a registered remote provider for this model
                        let pc = provider_configs.lock().await;

                        // Try to find a provider that has this model configured
                        let provider_name = pc
                            .iter()
                            .find(|(_, config)| {
                                // Check if any model in this provider matches
                                config.models.iter().any(|m| m == model_id)
                            })
                            .map(|(_, config)| config.provider.clone())
                            .or_else(|| {
                                // Try to find by provider name in model_id (e.g., "provider/model")
                                if let Some(sep_pos) = model_id.find('/') {
                                    let potential_provider: &str = &model_id[..sep_pos];
                                    if pc.contains_key(potential_provider) {
                                        return Some(potential_provider.to_string());
                                    }
                                }
                                // Also check if the model_id itself matches a provider name
                                pc.get(model_id).map(|c| c.provider.clone())
                            });

                        drop(pc);

                        if let Some(ref provider) = provider_name {
                            // Found a remote provider, stream the response directly
                            log::info!("Found remote provider '{provider}' for model '{model_id}'");

                            // Get the provider config
                            let pc2 = provider_configs.lock().await;
                            let provider_config = pc2.get(provider.as_str()).cloned();

                            // Log registered providers for debugging
                            log::debug!(
                                "Registered providers: {:?}",
                                pc2.keys().collect::<Vec<_>>()
                            );

                            drop(pc2);

                            if let Some(provider_cfg) = provider_config {
                                target_base_url = provider_cfg
                                    .base_url
                                    .clone()
                                    .map(|api_url| format!("{api_url}{destination_path}"));
                                session_api_keys = provider_cfg.bearer_key_chain();
                            } else {
                                log::error!("Provider config not found for '{provider}'");
                            }
                        } else {
                            let router_up = engine_upstream(&llama_state, &destination_path).await;

                            if router_up.is_none() {
                                log::warn!(
                                    "Request for model '{model_id}' but no models are running."
                                );
                                let mut error_response =
                                    Response::builder().status(StatusCode::SERVICE_UNAVAILABLE);
                                error_response = add_cors_headers_with_host_and_origin(
                                    error_response,
                                    &host_header,
                                    &origin_header,
                                    &config.trusted_hosts,
                                );
                                return Ok(error_response
                                    .body(full("No models are available"))
                                    .unwrap());
                            }

                            if let Some((url, key)) = router_up {
                                log::debug!("Routing model_id {model_id} via llamacpp router");
                                session_api_keys = vec![key];
                                target_base_url = Some(url);
                            } else {
                                log::warn!("No running session found for model_id: {model_id}");
                                let mut error_response =
                                    Response::builder().status(StatusCode::NOT_FOUND);
                                error_response = add_cors_headers_with_host_and_origin(
                                    error_response,
                                    &host_header,
                                    &origin_header,
                                    &config.trusted_hosts,
                                );
                                return Ok(error_response
                                    .body(full(format!(
                                        "No running session found for model '{model_id}'"
                                    )))
                                    .unwrap());
                            }
                        }
                    } else {
                        let error_msg = "Request body must contain a 'model' field";
                        log::warn!(
                            "POST body for {destination_path} is missing 'model' field or it's not a string"
                        );
                        let mut error_response =
                            Response::builder().status(StatusCode::BAD_REQUEST);
                        error_response = add_cors_headers_with_host_and_origin(
                            error_response,
                            &host_header,
                            &origin_header,
                            &config.trusted_hosts,
                        );
                        return Ok(error_response.body(full(error_msg)).unwrap());
                    }
                }
                Err(e) => {
                    log::warn!("Failed to parse POST body for {destination_path} as JSON: {e}");
                    let mut error_response = Response::builder().status(StatusCode::BAD_REQUEST);
                    error_response = add_cors_headers_with_host_and_origin(
                        error_response,
                        &host_header,
                        &origin_header,
                        &config.trusted_hosts,
                    );
                    let error_msg = format!("Invalid JSON body: {}", e);
                    return Ok(error_response.body(full(error_msg)).unwrap());
                }
            }
        }
        (hyper::Method::GET, "/models") => {
            log::debug!("Handling GET /v1/models request");

            let local_models: Vec<_> = engine_list_models(&llama_state, &client)
                .await
                .into_iter()
                .map(|id| {
                    serde_json::json!({
                        "id": id,
                        "object": "model",
                        "created": 1,
                        "owned_by": "llama.cpp"
                    })
                })
                .collect();

            // Get remote provider models
            let pc = provider_configs.lock().await;
            let remote_models: Vec<_> = pc
                .values()
                .flat_map(|provider_cfg| provider_cfg.models.clone())
                .map(|model_id| {
                    serde_json::json!({
                        "id": model_id,
                        "object": "model",
                        "created": 1,
                        "owned_by": "remote"
                    })
                })
                .collect();

            // Store counts before moving
            let local_count = local_models.len();
            let remote_count = remote_models.len();

            // Combine all models
            let mut all_models = Vec::with_capacity(local_count + remote_count);
            all_models.extend(local_models);
            all_models.extend(remote_models);

            let response_json = serde_json::json!({
                "object": "list",
                "data": all_models
            });

            let body_str =
                serde_json::to_string(&response_json).unwrap_or_else(|_| "{}".to_string());

            let mut response_builder = Response::builder()
                .status(StatusCode::OK)
                .header(hyper::header::CONTENT_TYPE, "application/json");

            response_builder = add_cors_headers_with_host_and_origin(
                response_builder,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );

            log::debug!(
                "Returning {} models ({} llama.cpp, {} remote)",
                all_models.len(),
                local_count,
                remote_count
            );

            return Ok(response_builder.body(full(body_str)).unwrap());
        }

        (hyper::Method::GET, "/openapi.json") => {
            let static_body = include_str!("../../../static/openapi.json"); // relative to src-tauri/src/
                                                                            // Parse the static OpenAPI JSON and update the server URL with actual host and port
            match serde_json::from_str::<serde_json::Value>(static_body) {
                Ok(mut openapi_spec) => {
                    // Update the servers array with the actual host and port
                    if let Some(servers) = openapi_spec
                        .get_mut("servers")
                        .and_then(|s| s.as_array_mut())
                    {
                        for server in servers {
                            if let Some(server_obj) = server.as_object_mut() {
                                if let Some(url) = server_obj.get_mut("url") {
                                    let base_url = format!(
                                        "http://{}:{}{}",
                                        config.host, config.port, config.prefix
                                    );
                                    *url = serde_json::Value::String(base_url);
                                }
                            }
                        }
                    }
                    let body = serde_json::to_string(&openapi_spec)
                        .unwrap_or_else(|_| static_body.to_string());
                    return Ok(Response::builder()
                        .status(StatusCode::OK)
                        .header(hyper::header::CONTENT_TYPE, "application/json")
                        .body(full(body))
                        .unwrap());
                }
                Err(_) => {
                    // If parsing fails, return the static file as fallback
                    return Ok(Response::builder()
                        .status(StatusCode::OK)
                        .header(hyper::header::CONTENT_TYPE, "application/json")
                        .body(full(static_body))
                        .unwrap());
                }
            }
        }

        _ => {
            let is_explicitly_whitelisted_get = method == hyper::Method::GET
                && whitelisted_paths.contains(&destination_path.as_str());
            if is_explicitly_whitelisted_get {
                log::debug!("Handled whitelisted GET path: {destination_path}");
                let mut error_response = Response::builder().status(StatusCode::NOT_FOUND);
                error_response = add_cors_headers_with_host_and_origin(
                    error_response,
                    &host_header,
                    &origin_header,
                    &config.trusted_hosts,
                );
                return Ok(error_response.body(full("Not Found")).unwrap());
            } else {
                log::warn!(
                    "Unhandled method/path for dynamic routing: {method} {destination_path}"
                );
                let mut error_response = Response::builder().status(StatusCode::NOT_FOUND);
                error_response = add_cors_headers_with_host_and_origin(
                    error_response,
                    &host_header,
                    &origin_header,
                    &config.trusted_hosts,
                );
                return Ok(error_response.body(full("Not Found")).unwrap());
            }
        }
    }

    let upstream_url = match target_base_url.clone() {
        Some(p) => p,
        None => {
            log::error!(
                "Internal API server routing error: target is None after successful lookup"
            );
            let mut error_response = Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR);
            error_response = add_cors_headers_with_host_and_origin(
                error_response,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );
            return Ok(error_response.body(full("Internal routing error")).unwrap());
        }
    };
    log::info!(
        "Proxying request to model server at base URL {upstream_url}, path: {destination_path}"
    );

    let body_bytes_for_proxy = match buffered_body.clone() {
        Some(b) => b,
        None => {
            log::error!(
                "Internal logic error: Request reached proxy stage without a buffered body."
            );
            let mut error_response = Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR);
            error_response = add_cors_headers_with_host_and_origin(
                error_response,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );
            return Ok(error_response
                .body(full("Internal server error: unhandled request path"))
                .unwrap());
        }
    };

    let key_attempts: Vec<Option<String>> = if session_api_keys.is_empty() {
        vec![None]
    } else {
        session_api_keys.iter().cloned().map(Some).collect()
    };


    for (key_idx, key_opt) in key_attempts.iter().enumerate() {
        let mut outbound_req = client.request(method.clone(), upstream_url.clone());

        // Body is re-buffered/rewritten, so a stale inbound Content-Length would
        // mismatch the bytes we send and stall the upstream; reqwest re-derives it.
        for (name, value) in headers.iter() {
            if name != hyper::header::HOST
                && name != hyper::header::AUTHORIZATION
                && name != hyper::header::CONTENT_LENGTH
                && name != hyper::header::TRANSFER_ENCODING
            {
                outbound_req = outbound_req.header(name, value);
            }
        }

        if let Some(key) = key_opt {
            outbound_req = outbound_req.header("authorization", format!("Bearer {key}"));
        } else {
            log::debug!("No session API key for this attempt");
        }

        let outbound_req_with_body = outbound_req.body(body_bytes_for_proxy.clone());

        match outbound_req_with_body.send().await {
            Ok(response) => {
                let status = response.status();

                let is_error = !status.is_success();

                if is_error
                    && http_status_indicates_api_key_retry(status)
                    && key_idx + 1 < key_attempts.len()
                {
                    let _ = response.text().await;
                    log::warn!("Upstream {status} for API key index {key_idx}, trying next key");
                    continue;
                }

                if is_error {
                    // Return error response with body
                    let error_body = response
                        .text()
                        .await
                        .unwrap_or_else(|e| format!("Failed to read error body: {}", e));

                    let mut error_response = Response::builder().status(status);
                    error_response = add_cors_headers_with_host_and_origin(
                        error_response,
                        &host_header,
                        &origin_header,
                        &config.trusted_hosts,
                    );
                    return Ok(error_response.body(full(error_body)).unwrap());
                }

                // Success case - stream the response
                let mut builder = Response::builder().status(status);

                for (name, value) in response.headers() {
                    if !is_cors_header(name.as_str()) && name != hyper::header::CONTENT_LENGTH {
                        builder = builder.header(name, value);
                    }
                }

                builder = add_cors_headers_with_host_and_origin(
                    builder,
                    &host_header,
                    &origin_header,
                    &config.trusted_hosts,
                );

                let mut stream = response.bytes_stream();
                let (mut sender, body) = body_channel();

                tokio::spawn(async move {
                    // Regular passthrough: the response is already OpenAI-shaped
                    while let Some(chunk_result) = stream.next().await {
                        match chunk_result {
                            Ok(chunk) => {
                                if sender.send_data(chunk).await.is_err() {
                                    log::debug!("Client disconnected during streaming");
                                    break;
                                }
                            }
                            Err(e) => {
                                log::error!("Stream error: {e}");
                                break;
                            }
                        }
                    }
                    log::debug!("Streaming complete to client");
                });

                return Ok(builder.body(body).unwrap());
            }
            Err(e) => {
                let error_msg = format!("Proxy request to model failed: {e}");
                log::error!("{error_msg}");
                let mut error_response = Response::builder().status(StatusCode::BAD_GATEWAY);
                error_response = add_cors_headers_with_host_and_origin(
                    error_response,
                    &host_header,
                    &origin_header,
                    &config.trusted_hosts,
                );
                return Ok(error_response.body(full(error_msg)).unwrap());
            }
        }
    }

    log::error!("Internal error: proxy key loop exited without a response");
    let mut error_response = Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR);
    error_response = add_cors_headers_with_host_and_origin(
        error_response,
        &host_header,
        &origin_header,
        &config.trusted_hosts,
    );
    Ok(error_response.body(full("Internal proxy error")).unwrap())
}

/// True when this bind exposes the API to the network with no authentication:
/// a non-loopback host and an empty API key. Every loopback address is safe
/// (127.0.0.0/8, ::1, "localhost"): only this machine can reach it.
fn is_insecure_public_bind(host: &str, api_key: &str) -> bool {
    let is_loopback = host == "localhost"
        || host
            .trim_matches(['[', ']'])
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback());
    !is_loopback && api_key.is_empty()
}

/// Convert a TCP bind failure into a user-facing message. Address-in-use
/// (Windows error 10048 / WSAEADDRINUSE, Unix EADDRINUSE) almost always means
/// a leftover Jan process or another service still owns the port after a
/// restart, so name the port and the remedy instead of surfacing a bare OS
/// errno. Any other error is passed through unchanged.
fn map_bind_error(
    addr: SocketAddr,
    err: std::io::Error,
) -> Box<dyn std::error::Error + Send + Sync> {
    if err.kind() == std::io::ErrorKind::AddrInUse {
        let msg = format!(
            "Port {port} ({addr}) is already in use. A previous Jan process may still be \
             running or another application may be using the port. Close the leftover \
             process and try again, or pick a different port in Settings > Local API Server.",
            port = addr.port()
        );
        return msg.into();
    }
    Box::new(err)
}

pub(crate) fn add_cors_headers_with_host_and_origin(
    builder: hyper::http::response::Builder,
    host: &str,
    origin: &str,
    trusted_hosts: &[Vec<String>],
) -> hyper::http::response::Builder {
    let mut builder = builder;

    // Requests from an origin `origin_allowed` refuses never reach a handler,
    // so this only decides whether to reflect an already-admitted origin.
    let origin_trusted = !origin.is_empty()
        && is_trusted_origin(
            origin,
            if is_valid_host(host, trusted_hosts) { host } else { "" },
            trusted_hosts,
        );

    builder = builder
        .header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH")
        .header("Access-Control-Allow-Headers", "Authorization, Content-Type, Host, Accept, Accept-Language, Cache-Control, Connection, DNT, If-Modified-Since, Keep-Alive, Origin, User-Agent, X-Requested-With, X-CSRF-Token, X-Forwarded-For, X-Forwarded-Proto, X-Forwarded-Host, authorization, content-type, x-api-key")
        .header("Vary", "Origin");

    if origin_trusted {
        builder = builder
            .header("Access-Control-Allow-Origin", origin)
            .header("Access-Control-Allow-Credentials", "true");
    } else {
        log::warn!(
            "CORS: Origin '{}' is not trusted, not reflecting origin",
            origin
        );
    }

    builder
}

pub async fn is_server_running(server_handle: Arc<Mutex<Option<ServerHandle>>>) -> bool {
    let handle_guard = server_handle.lock().await;
    handle_guard.is_some()
}

#[allow(clippy::too_many_arguments)]
pub async fn start_server(
    server_handle: Arc<Mutex<Option<ServerHandle>>>,
    llama_state: Arc<LlamacppState>,
    host: String,
    port: u16,
    prefix: String,
    proxy_api_key: String,
    trusted_hosts: Vec<Vec<String>>,
    proxy_timeout: u64,
    provider_configs: Arc<Mutex<HashMap<String, ProviderConfig>>>,
    cors_enabled: bool,
) -> Result<u16, Box<dyn std::error::Error + Send + Sync>> {
    start_server_internal(
        server_handle,
        llama_state,
        host,
        port,
        prefix,
        proxy_api_key,
        trusted_hosts,
        proxy_timeout,
        provider_configs,
        cors_enabled,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn start_server_internal(
    server_handle: Arc<Mutex<Option<ServerHandle>>>,
    llama_state: Arc<LlamacppState>,
    host: String,
    port: u16,
    prefix: String,
    proxy_api_key: String,
    trusted_hosts: Vec<Vec<String>>,
    proxy_timeout: u64,
    provider_configs: Arc<Mutex<HashMap<String, ProviderConfig>>>,
    cors_enabled: bool,
) -> Result<u16, Box<dyn std::error::Error + Send + Sync>> {
    let mut handle_guard = server_handle.lock().await;
    if handle_guard.is_some() {
        return Err("Server is already running".into());
    }

    let addr: SocketAddr = format!("{host}:{port}")
        .parse()
        .map_err(|e| format!("Invalid address: {e}"))?;

    // Binding to 0.0.0.0 exposes the server on the LAN, but that must NOT discard
    // the user's Trusted Hosts allowlist. LAN clients connect via http://192.168.x.x:port
    // and send that literal IP as the Host header; is_valid_host now accepts loopback
    // and private-range IP literals, which is safe against DNS rebinding (that sends an
    // attacker *hostname*, not an IP). Hostnames still require an explicit allowlist entry.

    // Security: a non-loopback bind exposes the OpenAI-compatible API on the
    // network, and with no API key any reachable host could call it
    // unauthenticated (inference and model enumeration). Refuse before binding
    // rather than serve it open.
    if is_insecure_public_bind(&host, &proxy_api_key) {
        return Err(format!(
            "The API server is set to listen on {host}, which other devices on the network \
             can reach, but no API key is set. Set an API key in Settings > Local API Server, \
             or switch the host to 127.0.0.1."
        )
        .into());
    }

    let config = ProxyConfig {
        prefix,
        proxy_api_key,
        trusted_hosts,
        host: host.clone(),
        port,
        cors_enabled,
    };

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(proxy_timeout))
        .pool_max_idle_per_host(10)
        .pool_idle_timeout(std::time::Duration::from_secs(30))
        .build()?;

    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            log::error!("Failed to bind to {addr}: {e}");
            return Err(map_bind_error(addr, e));
        }
    };
    log::info!("Jan API server started on http://{addr}");

    let server_task = tokio::spawn(async move {
        loop {
            let (stream, _) = match listener.accept().await {
                Ok(c) => c,
                Err(e) => {
                    log::error!("Accept error: {e}");
                    continue;
                }
            };
            let io = TokioIo::new(stream);

            let client = client.clone();
            let config = config.clone();
            let llama_state = llama_state.clone();
            let provider_configs = provider_configs.clone();

            let svc = service_fn(move |req| {
                let client = client.clone();
                let config = config.clone();
                let llama_state = llama_state.clone();
                let provider_configs = provider_configs.clone();
                async move {
                    // Taken before the request resolves the engine's address and
                    // kept until its response body is finished, so a device-change
                    // restart cannot stop the worker between the two. A request
                    // arriving mid-restart waits here and is then served by the
                    // new worker instead of failing with "no models are running".
                    let lease = llama_state.lease().await;
                    let response = proxy_request(
                        req,
                        client,
                        config,
                        llama_state,
                        provider_configs,
                    )
                    .await?;
                    Ok::<_, hyper::Error>(response.map(|body| hold_lease(body, lease)))
                }
            });

            tokio::spawn(async move {
                if let Err(e) = http1::Builder::new().serve_connection(io, svc).await {
                    log::debug!("Error serving connection: {e}");
                }
            });
        }
        #[allow(unreachable_code)]
        Ok::<(), Box<dyn std::error::Error + Send + Sync>>(())
    });

    *handle_guard = Some(server_task);
    let actual_port = addr.port();
    log::info!("Jan API server started successfully on port {actual_port}");
    Ok(actual_port)
}

pub async fn stop_server(
    server_handle: Arc<Mutex<Option<ServerHandle>>>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut handle_guard = server_handle.lock().await;

    if let Some(handle) = handle_guard.take() {
        handle.abort();
        *handle_guard = None;
        log::info!("Jan API server stopped");
    } else {
        log::debug!("Server was not running");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{is_insecure_public_bind, map_bind_error};
    use std::net::SocketAddr;

    #[test]
    fn loopback_hosts_need_no_key() {
        for host in ["127.0.0.1", "127.0.0.2", "localhost", "::1", "[::1]"] {
            assert!(!is_insecure_public_bind(host, ""), "{host} should be safe");
            assert!(!is_insecure_public_bind(host, "secret"));
        }
    }

    #[test]
    fn public_bind_without_key_is_insecure() {
        for host in ["0.0.0.0", "192.168.1.10", "::", "10.0.0.5"] {
            assert!(is_insecure_public_bind(host, ""), "{host} should need a key");
        }
    }

    #[test]
    fn public_bind_with_key_is_ok() {
        assert!(!is_insecure_public_bind("0.0.0.0", "secret"));
        assert!(!is_insecure_public_bind("192.168.1.10", "secret"));
    }

    #[test]
    fn addr_in_use_maps_to_actionable_message() {
        let addr: SocketAddr = "127.0.0.1:1337".parse().unwrap();
        let err = std::io::Error::new(std::io::ErrorKind::AddrInUse, "Address already in use");
        let msg = map_bind_error(addr, err).to_string();
        assert!(msg.contains("1337"), "should name the port: {msg}");
        assert!(
            msg.contains("already in use") && msg.contains("process"),
            "should explain the leftover-process remedy: {msg}"
        );
    }

    #[test]
    fn non_addr_in_use_error_passes_through() {
        let addr: SocketAddr = "127.0.0.1:1337".parse().unwrap();
        let err = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "denied");
        let msg = map_bind_error(addr, err).to_string();
        assert!(msg.contains("denied"), "should keep the original error: {msg}");
    }
}
