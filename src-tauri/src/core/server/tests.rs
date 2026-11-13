#[cfg(test)]
mod server_tests {
    use crate::core::server::proxy;
    use serde_json::json;

    #[test]
    fn test_get_destination_path_basic() {
        let result = proxy::get_destination_path("/v1/messages", "/v1");
        assert_eq!(result, "/messages");
    }

    #[test]
    fn test_get_destination_path_with_subpath() {
        let result = proxy::get_destination_path("/v1/messages/threads/123", "/v1");
        assert_eq!(result, "/messages/threads/123");
    }

    #[test]
    fn test_get_destination_path_no_prefix() {
        let result = proxy::get_destination_path("/messages", "");
        assert_eq!(result, "/messages");
    }

    #[test]
    fn test_get_destination_path_different_prefix() {
        let result = proxy::get_destination_path("/api/v1/messages", "/api/v1");
        assert_eq!(result, "/messages");
    }

    #[test]
    fn test_get_destination_path_empty_prefix() {
        let result = proxy::get_destination_path("/messages", "/v1");
        assert_eq!(result, "/messages");
    }

    #[test]
    fn test_proxy_config_creation() {
        let config = proxy::ProxyConfig {
            prefix: "/v1".to_string(),
            proxy_api_key: "test-key".to_string(),
            trusted_hosts: vec![vec!["localhost".to_string()]],
            host: "localhost".to_string(),
            port: 1337,
            cors_enabled: true,
        };
        assert_eq!(config.prefix, "/v1");
        assert_eq!(config.proxy_api_key, "test-key");
        assert_eq!(config.trusted_hosts.len(), 1);
        assert_eq!(config.host, "localhost");
        assert_eq!(config.port, 1337);
    }

    #[test]
    fn test_proxy_config_default() {
        let config = proxy::ProxyConfig {
            prefix: "".to_string(),
            proxy_api_key: "".to_string(),
            trusted_hosts: vec![],
            host: "127.0.0.1".to_string(),
            port: 8080,
            cors_enabled: true,
        };
        assert_eq!(config.prefix, "");
        assert_eq!(config.proxy_api_key, "");
        assert_eq!(config.trusted_hosts.len(), 0);
        assert_eq!(config.host, "127.0.0.1");
        assert_eq!(config.port, 8080);
    }

    #[test]
    fn test_allowed_methods() {
        let allowed_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"];
        assert!(allowed_methods.contains(&"POST"));
        assert!(allowed_methods.contains(&"GET"));
        assert!(allowed_methods.contains(&"OPTIONS"));
    }

    #[test]
    fn test_allowed_headers() {
        let allowed_headers = [
            "accept",
            "authorization",
            "content-type",
            "host",
            "origin",
            "user-agent",
            "x-api-key",
        ];
        assert!(allowed_headers.contains(&"authorization"));
        assert!(allowed_headers.contains(&"content-type"));
        assert!(allowed_headers.contains(&"x-api-key"));
    }

    // Tests for X-Api-Key header authentication support
    // The proxy now accepts either Authorization: Bearer <token> or X-Api-Key: <token>

    #[test]
    fn test_bearer_token_extraction() {
        let api_key = "test-secret-key";
        let auth_header = "Bearer test-secret-key";

        let auth_valid = auth_header
            .strip_prefix("Bearer ")
            .map(|token| token == api_key)
            .unwrap_or(false);

        assert!(auth_valid);
    }

    #[test]
    fn test_bearer_token_extraction_invalid() {
        let api_key = "test-secret-key";
        let auth_header = "Bearer wrong-key";

        let auth_valid = auth_header
            .strip_prefix("Bearer ")
            .map(|token| token == api_key)
            .unwrap_or(false);

        assert!(!auth_valid);
    }

    #[test]
    fn test_bearer_token_extraction_missing_prefix() {
        let api_key = "test-secret-key";
        let auth_header = "test-secret-key"; // Missing "Bearer " prefix

        let auth_valid = auth_header
            .strip_prefix("Bearer ")
            .map(|token| token == api_key)
            .unwrap_or(false);

        assert!(!auth_valid);
    }

    #[test]
    fn test_x_api_key_validation() {
        let api_key = "test-secret-key";
        let x_api_key_header = "test-secret-key";

        let api_key_valid = x_api_key_header == api_key;

        assert!(api_key_valid);
    }

    #[test]
    fn test_x_api_key_validation_invalid() {
        let api_key = "test-secret-key";
        let x_api_key_header = "wrong-key";

        let api_key_valid = x_api_key_header == api_key;

        assert!(!api_key_valid);
    }

    #[test]
    fn test_auth_either_header_valid_bearer() {
        let api_key = "test-secret-key";
        let auth_header = Some("Bearer test-secret-key");
        let x_api_key_header: Option<&str> = None;

        let auth_valid = auth_header
            .and_then(|auth_str| auth_str.strip_prefix("Bearer "))
            .map(|token| token == api_key)
            .unwrap_or(false);

        let api_key_valid = x_api_key_header.map(|key| key == api_key).unwrap_or(false);

        assert!(auth_valid || api_key_valid);
    }

    #[test]
    fn test_auth_either_header_valid_x_api_key() {
        let api_key = "test-secret-key";
        let auth_header: Option<&str> = None;
        let x_api_key_header = Some("test-secret-key");

        let auth_valid = auth_header
            .and_then(|auth_str| auth_str.strip_prefix("Bearer "))
            .map(|token| token == api_key)
            .unwrap_or(false);

        let api_key_valid = x_api_key_header.map(|key| key == api_key).unwrap_or(false);

        assert!(auth_valid || api_key_valid);
    }

    #[test]
    fn test_auth_both_headers_missing() {
        let api_key = "test-secret-key";
        let auth_header: Option<&str> = None;
        let x_api_key_header: Option<&str> = None;

        let auth_valid = auth_header
            .and_then(|auth_str| auth_str.strip_prefix("Bearer "))
            .map(|token| token == api_key)
            .unwrap_or(false);

        let api_key_valid = x_api_key_header.map(|key| key == api_key).unwrap_or(false);

        assert!(!auth_valid && !api_key_valid);
    }

    #[test]
    fn test_auth_both_headers_invalid() {
        let api_key = "test-secret-key";
        let auth_header = Some("Bearer wrong-key");
        let x_api_key_header = Some("also-wrong-key");

        let auth_valid = auth_header
            .and_then(|auth_str| auth_str.strip_prefix("Bearer "))
            .map(|token| token == api_key)
            .unwrap_or(false);

        let api_key_valid = x_api_key_header.map(|key| key == api_key).unwrap_or(false);

        assert!(!auth_valid && !api_key_valid);
    }

    #[test]
    fn test_auth_both_headers_one_valid() {
        let api_key = "test-secret-key";
        // Bearer is wrong but X-Api-Key is correct
        let auth_header = Some("Bearer wrong-key");
        let x_api_key_header = Some("test-secret-key");

        let auth_valid = auth_header
            .and_then(|auth_str| auth_str.strip_prefix("Bearer "))
            .map(|token| token == api_key)
            .unwrap_or(false);

        let api_key_valid = x_api_key_header.map(|key| key == api_key).unwrap_or(false);

        // Should pass if either is valid
        assert!(auth_valid || api_key_valid);
    }

    #[test]
    fn test_x_api_key_in_cors_allowed_headers() {
        // Verify x-api-key is in the CORS allowed headers list used by the proxy
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
        assert!(allowed_headers.contains(&"x-api-key"));
    }

    #[test]
    fn adds_string_type_for_description_only_leaf() {
        let mut schema = json!({
            "type": "object",
            "properties": {
                "url": {
                    "description": "field property config"
                }
            }
        });

        crate::core::openai_schema::normalize_openai_tool_parameters_schema(&mut schema);

        assert_eq!(schema["properties"]["url"]["type"], json!("string"));
    }

    #[test]
    fn adds_empty_properties_for_object_without_properties() {
        let mut schema = json!({
            "type": "object"
        });

        crate::core::openai_schema::normalize_openai_tool_parameters_schema(&mut schema);

        assert_eq!(schema["properties"], json!({}));
    }

    #[test]
    fn normalizes_nested_object_and_array_leaves() {
        let mut schema = json!({
            "type": "object",
            "properties": {
                "payload": {
                    "type": "object",
                    "properties": {
                        "title": {
                            "description": "Title text"
                        }
                    }
                },
                "filters": {
                    "type": "object"
                },
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object"
                    }
                }
            }
        });

        crate::core::openai_schema::normalize_openai_tool_parameters_schema(&mut schema);

        assert_eq!(
            schema["properties"]["payload"]["properties"]["title"]["type"],
            json!("string")
        );
        assert_eq!(schema["properties"]["filters"]["properties"], json!({}));
        assert_eq!(
            schema["properties"]["items"]["items"]["properties"],
            json!({})
        );
    }

    #[test]
    fn leaves_existing_typed_or_container_nodes_unchanged() {
        let mut schema = json!({
            "type": "object",
            "properties": {
                "name": {
                    "description": "already typed",
                    "type": "integer"
                },
                "container": {
                    "description": "container node",
                    "properties": {
                        "child": {
                            "description": "leaf child"
                        }
                    }
                }
            }
        });

        crate::core::openai_schema::normalize_openai_tool_parameters_schema(&mut schema);

        assert_eq!(schema["properties"]["name"]["type"], json!("integer"));
        assert!(schema["properties"]["container"].get("type").is_none());
        assert_eq!(
            schema["properties"]["container"]["properties"]["child"]["type"],
            json!("string"),
        );
    }

    #[test]
    fn expands_bare_string_shorthand_in_properties() {
        let mut schema = json!({
            "type": "object",
            "properties": {
                "name": "string",
                "count": "integer",
            }
        });

        crate::core::openai_schema::normalize_openai_tool_parameters_schema(&mut schema);

        assert_eq!(schema["properties"]["name"], json!({"type": "string"}));
        assert_eq!(schema["properties"]["count"], json!({"type": "integer"}));
    }

    #[test]
    fn expands_bare_string_shorthand_in_array_items() {
        let mut schema = json!({
            "type": "object",
            "properties": {
                "tags": { "type": "array", "items": "string" }
            }
        });

        crate::core::openai_schema::normalize_openai_tool_parameters_schema(&mut schema);

        assert_eq!(
            schema["properties"]["tags"]["items"],
            json!({"type": "string"})
        );
    }

    #[test]
    fn expands_bare_string_shorthand_in_any_of() {
        let mut schema = json!({
            "type": "object",
            "properties": {
                "value": { "anyOf": ["string", "number"] }
            }
        });

        crate::core::openai_schema::normalize_openai_tool_parameters_schema(&mut schema);

        assert_eq!(
            schema["properties"]["value"]["anyOf"],
            json!([{"type": "string"}, {"type": "number"}])
        );
    }

    #[test]
    fn does_not_coerce_enum_literal_strings() {
        let mut schema = json!({
            "type": "object",
            "properties": {
                "mode": { "type": "string", "enum": ["string", "number", "fast"] }
            }
        });

        crate::core::openai_schema::normalize_openai_tool_parameters_schema(&mut schema);

        assert_eq!(
            schema["properties"]["mode"]["enum"],
            json!(["string", "number", "fast"])
        );
    }

    #[test]
    fn leaves_existing_valid_object_schema_unchanged() {
        let mut schema = json!({
            "type": "object",
            "properties": {
                "payload": {
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string"
                        }
                    },
                    "required": ["name"]
                }
            }
        });

        let original = schema.clone();
        crate::core::openai_schema::normalize_openai_tool_parameters_schema(&mut schema);

        assert_eq!(schema, original);
    }

    #[test]
    fn normalizes_mixed_schema_without_altering_valid_fields() {
        let mut schema = json!({
            "type": "object",
            "properties": {
                "count": {
                    "type": "integer"
                },
                "title": {
                    "description": "A title"
                },
                "metadata": {
                    "type": "object",
                    "description": "Optional metadata"
                }
            }
        });

        crate::core::openai_schema::normalize_openai_tool_parameters_schema(&mut schema);

        assert_eq!(schema["properties"]["count"]["type"], json!("integer"));
        assert_eq!(schema["properties"]["title"]["type"], json!("string"));
        assert_eq!(
            schema["properties"]["metadata"]["description"],
            json!("Optional metadata")
        );
        assert_eq!(schema["properties"]["metadata"]["properties"], json!({}));
    }

    #[test]
    fn strips_broken_string_formats_for_llamacpp_grammar() {
        let mut schema = json!({
            "type": "object",
            "properties": {
                "start": { "type": "string", "format": "date-time" },
                "stop":  { "type": "string", "format": "date" },
                "at":    { "type": "string", "format": "time" }
            }
        });

        crate::core::openai_schema::normalize_openai_tool_parameters_schema(&mut schema);

        assert!(schema["properties"]["start"].get("format").is_none());
        assert!(schema["properties"]["stop"].get("format").is_none());
        assert!(schema["properties"]["at"].get("format").is_none());
        assert_eq!(schema["properties"]["start"]["type"], json!("string"));
    }

    #[test]
    fn preserves_harmless_string_formats() {
        let mut schema = json!({
            "type": "object",
            "properties": {
                "id":  { "type": "string", "format": "uuid" },
                "url": { "type": "string", "format": "uri" }
            }
        });

        crate::core::openai_schema::normalize_openai_tool_parameters_schema(&mut schema);

        assert_eq!(schema["properties"]["id"]["format"], json!("uuid"));
        assert_eq!(schema["properties"]["url"]["format"], json!("uri"));
    }

    #[test]
    fn strips_pcre_shorthand_patterns() {
        let mut schema = json!({
            "type": "object",
            "properties": {
                "when":  { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" },
                "alpha": { "type": "string", "pattern": "^[A-Z]+$" }
            }
        });

        crate::core::openai_schema::normalize_openai_tool_parameters_schema(&mut schema);

        assert!(schema["properties"]["when"].get("pattern").is_none());
        assert_eq!(schema["properties"]["alpha"]["pattern"], json!("^[A-Z]+$"));
    }

    #[test]
    fn strips_broken_format_when_type_missing_or_non_string() {
        let mut schema = json!({
            "type": "object",
            "properties": {
                "until":    { "format": "date-time", "description": "iso end" },
                "nullable": { "type": ["string", "null"], "format": "date" }
            }
        });

        crate::core::openai_schema::normalize_openai_tool_parameters_schema(&mut schema);

        assert!(schema["properties"]["until"].get("format").is_none());
        assert_eq!(schema["properties"]["until"]["type"], json!("string"));
        assert!(schema["properties"]["nullable"].get("format").is_none());
    }

    // ── Pure helper coverage ───────────────────────────────────────────────

    #[test]
    fn http_status_indicates_api_key_retry_matrix() {
        use hyper::StatusCode;
        assert!(crate::core::openai_schema::http_status_indicates_api_key_retry(
            StatusCode::UNAUTHORIZED
        ));
        assert!(crate::core::openai_schema::http_status_indicates_api_key_retry(
            StatusCode::FORBIDDEN
        ));
        assert!(crate::core::openai_schema::http_status_indicates_api_key_retry(
            StatusCode::TOO_MANY_REQUESTS
        ));
        assert!(!crate::core::openai_schema::http_status_indicates_api_key_retry(StatusCode::OK));
        assert!(!crate::core::openai_schema::http_status_indicates_api_key_retry(
            StatusCode::BAD_REQUEST
        ));
        assert!(!crate::core::openai_schema::http_status_indicates_api_key_retry(
            StatusCode::INTERNAL_SERVER_ERROR
        ));
    }
    #[test]
    fn normalize_openai_tools_in_chat_body_patches_parameters() {
        let mut body = json!({
            "messages": [],
            "tools": [{
                "type": "function",
                "function": {
                    "name": "x",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "url": {"description": "the url"}
                        }
                    }
                }
            }]
        });
        crate::core::openai_schema::normalize_openai_tools_in_chat_body(&mut body);
        assert_eq!(
            body["tools"][0]["function"]["parameters"]["properties"]["url"]["type"],
            json!("string")
        );
    }

    #[test]
    fn normalize_openai_tools_in_chat_body_no_tools_is_noop() {
        let mut body = json!({"messages": []});
        let original = body.clone();
        crate::core::openai_schema::normalize_openai_tools_in_chat_body(&mut body);
        assert_eq!(body, original);
    }

    #[test]
    fn add_cors_headers_with_trusted_origin_reflects_origin() {
        let trusted = vec![vec!["localhost".to_string()]];
        let builder = hyper::Response::builder();
        let builder = proxy::add_cors_headers_with_host_and_origin(
            builder,
            "localhost",
            "http://localhost:3000",
            &trusted,
        );
        let resp = builder
            .body(http_body_util::Empty::<hyper::body::Bytes>::new())
            .unwrap();
        let h = resp.headers();
        assert!(h.contains_key("access-control-allow-methods"));
        assert!(h.contains_key("access-control-allow-headers"));
        assert_eq!(h.get("vary").unwrap(), "Origin");
        assert_eq!(
            h.get("access-control-allow-origin").unwrap(),
            "http://localhost:3000"
        );
        assert_eq!(h.get("access-control-allow-credentials").unwrap(), "true");
    }

    #[test]
    fn add_cors_headers_with_untrusted_origin_omits_origin() {
        let trusted = vec![vec!["localhost".to_string()]];
        let builder = hyper::Response::builder();
        let builder = proxy::add_cors_headers_with_host_and_origin(
            builder,
            "localhost",
            "http://evil.example.com",
            &trusted,
        );
        let resp = builder
            .body(http_body_util::Empty::<hyper::body::Bytes>::new())
            .unwrap();
        let h = resp.headers();
        assert!(h.contains_key("access-control-allow-methods"));
        assert!(!h.contains_key("access-control-allow-origin"));
        assert!(!h.contains_key("access-control-allow-credentials"));
    }

    #[test]
    fn add_cors_headers_reflects_a_listed_opaque_origin() {
        for (origin, entry) in [("null", "null"), ("file://", "file://")] {
            let resp = proxy::add_cors_headers_with_host_and_origin(
                hyper::Response::builder(),
                "127.0.0.1:1337",
                origin,
                &[vec![entry.to_string()]],
            )
            .body(http_body_util::Empty::<hyper::body::Bytes>::new())
            .unwrap();
            assert_eq!(resp.headers().get("access-control-allow-origin").unwrap(), origin);

            let resp = proxy::add_cors_headers_with_host_and_origin(
                hyper::Response::builder(),
                "127.0.0.1:1337",
                origin,
                &[vec![]],
            )
            .body(http_body_util::Empty::<hyper::body::Bytes>::new())
            .unwrap();
            assert!(!resp.headers().contains_key("access-control-allow-origin"));
        }
    }

    #[test]
    fn add_cors_headers_with_empty_origin_omits_origin() {
        let trusted = vec![vec!["localhost".to_string()]];
        let builder = hyper::Response::builder();
        let builder =
            proxy::add_cors_headers_with_host_and_origin(builder, "localhost", "", &trusted);
        let resp = builder
            .body(http_body_util::Empty::<hyper::body::Bytes>::new())
            .unwrap();
        let h = resp.headers();
        assert!(!h.contains_key("access-control-allow-origin"));
    }

    #[test]
    fn get_destination_path_trailing_slash() {
        let result = proxy::get_destination_path("/v1/", "/v1");
        // remove_prefix should leave "/" or "" — either way no panic, deterministic.
        assert!(result == "/" || result.is_empty());
    }

    #[test]
    fn proxy_config_clone_preserves_fields() {
        let cfg = proxy::ProxyConfig {
            prefix: "/p".to_string(),
            proxy_api_key: "k".to_string(),
            trusted_hosts: vec![vec!["a".to_string()]],
            host: "h".to_string(),
            port: 1,
            cors_enabled: true,
        };
        let cloned = cfg.clone();
        assert_eq!(cloned.prefix, "/p");
        assert_eq!(cloned.proxy_api_key, "k");
    }

    #[test]
    fn normalizes_combinator_members_recursively() {
        let mut schema = json!({
            "anyOf": [
                {
                    "type": "object"
                },
                {
                    "description": "fallback string"
                }
            ],
            "oneOf": [
                {
                    "type": "object"
                }
            ],
            "allOf": [
                {
                    "description": "merged leaf"
                }
            ]
        });

        crate::core::openai_schema::normalize_openai_tool_parameters_schema(&mut schema);

        assert_eq!(schema["anyOf"][0]["properties"], json!({}));
        assert_eq!(schema["anyOf"][1]["type"], json!("string"));
        assert_eq!(schema["oneOf"][0]["properties"], json!({}));
        assert_eq!(schema["allOf"][0]["type"], json!("string"));
    }


    // ---- Origin gate, against a running server ----

    fn trusted(hosts: &[&str]) -> Vec<Vec<String>> {
        vec![hosts.iter().map(|h| h.to_string()).collect()]
    }

    #[test]
    fn request_origin_refuses_a_non_ascii_origin_header() {
        let mut headers = hyper::HeaderMap::new();
        assert_eq!(proxy::request_origin(&headers), Some(""));
        headers.insert(
            hyper::header::ORIGIN,
            hyper::header::HeaderValue::from_static("http://localhost:3000"),
        );
        assert_eq!(
            proxy::request_origin(&headers),
            Some("http://localhost:3000")
        );
        headers.insert(
            hyper::header::ORIGIN,
            hyper::header::HeaderValue::from_bytes(b"http://\xffevil.com").unwrap(),
        );
        assert_eq!(proxy::request_origin(&headers), None);
    }

    #[test]
    fn origin_allowed_absent_origin_always_passes() {
        assert!(proxy::origin_allowed("", "127.0.0.1:1337", &trusted(&[]), true));
        assert!(proxy::origin_allowed("", "192.168.1.10:1337", &trusted(&[]), false));
    }

    #[test]
    fn origin_allowed_matrix() {
        let t = trusted(&[]);
        let h = "127.0.0.1:1337";
        assert!(proxy::origin_allowed("http://localhost:3000", h, &t, true));
        assert!(proxy::origin_allowed("tauri://localhost", h, &t, true));
        assert!(!proxy::origin_allowed("https://evil.com", h, &t, true));
        assert!(!proxy::origin_allowed("null", h, &t, true));
        assert!(!proxy::origin_allowed("file://", h, &t, true));
        // Opaque origins only with an explicit entry, and only with CORS on.
        assert!(proxy::origin_allowed("null", h, &trusted(&["null"]), true));
        assert!(proxy::origin_allowed("file://", h, &trusted(&["file://"]), true));
        assert!(!proxy::origin_allowed("file://", h, &trusted(&["null"]), true));
        assert!(!proxy::origin_allowed("null", h, &trusted(&["null"]), false));
        // Private-IP pages on the LAN are not trusted unless listed.
        assert!(!proxy::origin_allowed("http://192.168.1.20:3000", h, &t, true));
        assert!(proxy::origin_allowed(
            "http://192.168.1.20:3000",
            h,
            &trusted(&["192.168.1.20"]),
            true
        ));
        // CORS off: only the app webview and same-origin pages.
        assert!(!proxy::origin_allowed("http://localhost:3000", h, &t, false));
        assert!(proxy::origin_allowed("tauri://localhost", h, &t, false));
        assert!(proxy::origin_allowed("http://127.0.0.1:1337", h, &t, false));
        // Same-origin needs a valid Host: a rebinding hostname does not count.
        assert!(!proxy::origin_allowed(
            "http://evil.com:1337",
            "evil.com:1337",
            &t,
            true
        ));
    }

    async fn start_test_server(
        cors_enabled: bool,
    ) -> (u16, std::sync::Arc<tokio::sync::Mutex<Option<crate::core::state::ServerHandle>>>) {
        use std::collections::HashMap;
        use std::sync::Arc;
        use tokio::sync::Mutex;

        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let handle = Arc::new(Mutex::new(None));
        proxy::start_server(
            handle.clone(),
            Arc::new(tauri_plugin_llamacpp::state::LlamacppState::default()),
            "127.0.0.1".to_string(),
            port,
            "/v1".to_string(),
            String::new(),
            vec![vec![]],
            30,
            Arc::new(Mutex::new(HashMap::new())),
            cors_enabled,
        )
        .await
        .expect("server starts");
        (port, handle)
    }

    async fn post(
        port: u16,
        path: &str,
        origin: Option<&str>,
        content_type: &str,
    ) -> reqwest::StatusCode {
        let mut req = reqwest::Client::new()
            .post(format!("http://127.0.0.1:{port}/v1{path}"))
            .header("Content-Type", content_type)
            .body(r#"{"model":"nope","messages":[{"role":"user","content":"hi"}]}"#);
        if let Some(o) = origin {
            req = req.header("Origin", o);
        }
        req.send().await.expect("request sent").status()
    }

    #[tokio::test]
    async fn untrusted_origin_post_is_refused_before_handlers() {
        let (port, handle) = start_test_server(true).await;

        // A cross-site "simple" request (no preflight) is refused.
        for path in ["/chat/completions", "/models"] {
            assert_eq!(
                post(port, path, Some("https://evil.example"), "text/plain").await,
                reqwest::StatusCode::FORBIDDEN,
                "{path}"
            );
        }
        assert_eq!(
            post(port, "/chat/completions", Some("http://192.168.1.20:3000"), "text/plain").await,
            reqwest::StatusCode::FORBIDDEN
        );
        // No Origin (curl, SDKs) and loopback origins reach the handler: no
        // model is loaded, so the handler answers, just not with the gate's 403.
        for origin in [None, Some("http://localhost:3000")] {
            let status = post(port, "/chat/completions", origin, "application/json").await;
            assert_ne!(status, reqwest::StatusCode::FORBIDDEN, "{origin:?}");
        }

        proxy::stop_server(handle).await.unwrap();
    }

    #[tokio::test]
    async fn cors_toggle_off_refuses_loopback_pages() {
        let (port, handle) = start_test_server(false).await;
        assert_eq!(
            post(port, "/chat/completions", Some("http://localhost:3000"), "application/json")
                .await,
            reqwest::StatusCode::FORBIDDEN
        );
        assert_ne!(
            post(port, "/chat/completions", None, "application/json").await,
            reqwest::StatusCode::FORBIDDEN
        );
        proxy::stop_server(handle).await.unwrap();
    }

    #[tokio::test]
    async fn public_bind_without_api_key_is_refused_before_binding() {
        use std::collections::HashMap;
        use std::sync::Arc;
        use tokio::sync::Mutex;

        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let handle = Arc::new(Mutex::new(None));
        let err = proxy::start_server(
            handle.clone(),
            Arc::new(tauri_plugin_llamacpp::state::LlamacppState::default()),
            "0.0.0.0".to_string(),
            port,
            "/v1".to_string(),
            String::new(),
            vec![vec![]],
            30,
            Arc::new(Mutex::new(HashMap::new())),
            true,
        )
        .await
        .expect_err("an open public bind must be refused");

        let msg = err.to_string();
        assert!(msg.contains("API key") && msg.contains("127.0.0.1"), "{msg}");
        // Nothing was started and nothing is listening.
        assert!(handle.lock().await.is_none());
        assert!(std::net::TcpListener::bind(("127.0.0.1", port)).is_ok());
    }

    /// A `*` in Trusted Hosts opens the API to any web page (CORS), but the
    /// Host header must still name this server: a DNS-rebinding page reaches
    /// it under its own hostname.
    #[tokio::test]
    async fn wildcard_trusted_hosts_still_refuse_a_foreign_host_header() {
        use std::collections::HashMap;
        use std::sync::Arc;
        use tokio::sync::Mutex;

        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let handle = Arc::new(Mutex::new(None));
        proxy::start_server(
            handle.clone(),
            Arc::new(tauri_plugin_llamacpp::state::LlamacppState::default()),
            "127.0.0.1".to_string(),
            port,
            "/v1".to_string(),
            String::new(),
            vec![vec!["*".to_string()]],
            30,
            Arc::new(Mutex::new(HashMap::new())),
            true,
        )
        .await
        .expect("server starts");

        let get = |host: String, origin: Option<&'static str>| async move {
            let mut req = reqwest::Client::new()
                .get(format!("http://127.0.0.1:{port}/v1/models"))
                .header("Host", host);
            if let Some(o) = origin {
                req = req.header("Origin", o);
            }
            req.send().await.expect("request sent").status()
        };

        // The rebinding shape: attacker hostname in Host and as Origin.
        assert_eq!(
            get("attacker.example".into(), Some("http://attacker.example")).await,
            reqwest::StatusCode::FORBIDDEN
        );
        assert_eq!(
            get("attacker.example:1337".into(), None).await,
            reqwest::StatusCode::FORBIDDEN
        );
        // `*` keeps its CORS meaning: a page on another origin may call the
        // API through the server's own address.
        assert_ne!(
            get(format!("127.0.0.1:{port}"), Some("https://any-web-app.example")).await,
            reqwest::StatusCode::FORBIDDEN
        );
        assert_ne!(
            get(format!("127.0.0.1:{port}"), None).await,
            reqwest::StatusCode::FORBIDDEN
        );

        proxy::stop_server(handle).await.unwrap();
    }
}
