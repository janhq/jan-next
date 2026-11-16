//! The loopback OpenAI-compatible surface in front of the in-process engine.
//!
//! A port keeps the worker a drop-in for `llama-server`'s router mode: callers
//! speak OpenAI-compatible HTTP to `http://127.0.0.1:<port>/v1<path>` with a
//! bearer token, so OpenAI-SDK clients work unchanged.
//!
//! The engine's chunk generator is blocking C++, so streaming runs on a
//! blocking task feeding an async channel rather than being polled from the
//! reactor.

use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use http_body_util::{combinators::BoxBody, BodyExt, Full, StreamBody};
use hyper::body::{Frame, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response as HttpResponse, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;
use tokio::sync::{broadcast, mpsc, watch, Mutex};

use super::events::ModelEvent;
use super::registry::{Registry, RegistryError};
use super::slots::{Claim, Identity, SlotOccupancy, StateStore, MIN_TOKENS_TO_SAVE};
use super::Route;

type Body = BoxBody<Bytes, Infallible>;

pub struct EngineServer {
    pub port: u16,
    pub api_key: String,
    registry: Arc<Mutex<Registry>>,
    /// Cross-session KV persistence, `None` only when the preset named no
    /// `slot-save-path` -- in which case llama.cpp answers the slot routes with
    /// 501 anyway. A store with a zero budget is still `Some`: the feature is
    /// off, but the directory has to stay prunable and erasable.
    slots: Option<SlotState>,
}

/// The saved-state directory plus who is sitting in which slot.
struct SlotState {
    store: StateStore,
    occupancy: Mutex<SlotOccupancy>,
}

/// A chat request that names the thread it belongs to, so its KV cache can be
/// parked and picked back up. Absent on requests that do not (embeddings, or
/// any caller that has not opted in), which then behave exactly as before.
#[derive(Debug, Clone, PartialEq, Eq)]
struct SlotHint {
    thread: String,
    slot: i32,
}

/// The request field naming the thread, which keys per-thread KV-cache
/// persistence. It is not llama.cpp's, so it is stripped before the body is
/// forwarded.
const THREAD_FIELD: &str = "thread_id";

impl SlotHint {
    /// llama.cpp's own `id_slot` doubles as the slot to persist: the frontend
    /// already pins chat to slot 0 so a thread reuses its cached prefix across
    /// turns, which is the same slot whose contents are worth keeping.
    /// Without it there is no way to know which slot ran the request, so the
    /// hint is dropped rather than guessed at.
    fn from_body(body: &str) -> Option<Self> {
        let v: serde_json::Value = serde_json::from_str(body).ok()?;
        let thread = v.get(THREAD_FIELD)?.as_str()?.trim().to_string();
        if thread.is_empty() {
            return None;
        }
        let slot = v.get("id_slot")?.as_i64()?;
        if slot < 0 {
            return None;
        }
        Some(Self {
            thread,
            slot: slot as i32,
        })
    }
}

/// Removes Jan's own field so llama.cpp only ever sees its own schema.
fn strip_thread_field(body: &str) -> String {
    let Ok(mut v) = serde_json::from_str::<serde_json::Value>(body) else {
        return body.to_string();
    };
    let Some(o) = v.as_object_mut() else {
        return body.to_string();
    };
    if o.remove(THREAD_FIELD).is_none() {
        // Re-serializing a body that did not carry the field would reorder its
        // keys for nothing.
        return body.to_string();
    }
    v.to_string()
}

/// Chunks the streaming task hands to the response body. Bounded so a slow
/// client applies backpressure instead of letting the generator run ahead into
/// unbounded memory.
const STREAM_BUFFER: usize = 32;

/// One request's claim on a model's in-flight count, taken by
/// `Registry::acquire` and given back exactly once when this is dropped.
///
/// A streamed response outlives `dispatch`, so the claim travels with the
/// generator and ends only when generation does: until then the model stays
/// busy, `unload` refuses it, and eviction skips it. Dropping also covers a
/// cancelled request future and a panicking engine task.
struct InflightGuard {
    registry: Arc<Mutex<Registry>>,
    model: String,
}

impl InflightGuard {
    /// Wraps a claim the caller has already taken with `Registry::acquire`.
    fn new(registry: Arc<Mutex<Registry>>, model: String) -> Self {
        Self { registry, model }
    }
}

impl Drop for InflightGuard {
    fn drop(&mut self) {
        if let Ok(mut reg) = self.registry.try_lock() {
            reg.release(&self.model);
            return;
        }
        // Drop can run on the reactor, where blocking on the lock would stall
        // it, so a contended release finishes on a task instead.
        let registry = Arc::clone(&self.registry);
        let model = std::mem::take(&mut self.model);
        match tokio::runtime::Handle::try_current() {
            Ok(rt) => {
                rt.spawn(async move { registry.lock().await.release(&model) });
            }
            Err(_) => registry.blocking_lock().release(&model),
        }
    }
}

impl EngineServer {
    /// Binds `127.0.0.1:port`. Pass 0 to let the OS choose, then read `port`
    /// back -- unlike the old `49152 + random` guess, this cannot collide.
    pub async fn bind(
        registry: Arc<Mutex<Registry>>,
        port: u16,
        api_key: String,
    ) -> std::io::Result<(Self, TcpListener)> {
        let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port))).await?;
        let port = listener.local_addr()?.port();
        Ok((
            Self {
                port,
                api_key,
                registry,
                slots: None,
            },
            listener,
        ))
    }

    /// Serves forever. Callers that need to stop use `serve_until`.
    pub async fn serve(self, listener: TcpListener) {
        Arc::new(self)
            .serve_until(listener, std::future::pending::<()>(), Duration::ZERO)
            .await
    }

    /// Serves until `shutdown` resolves, then stops accepting and waits up to
    /// `drain` for in-flight requests to finish.
    ///
    /// The shutdown trigger is deliberately a parameter rather than an HTTP
    /// route: process lifetime is the caller's concern, not the transport's, and
    /// a request handler that tears down its own server has to be careful about
    /// ordering that simply does not arise this way.
    ///
    /// Draining matters because a connection task holds an `Arc<Engine>` while
    /// it generates. Returning the moment the listener stops would abandon
    /// those tasks and leave the engine referenced, so the teardown that frees
    /// the model could not run.
    /// Takes `Arc<Self>` rather than `self` so the caller keeps a handle: the
    /// worker has to call `save_resident_slots` once draining is done, and that
    /// needs the server after it has stopped serving.
    pub async fn serve_until(
        self: Arc<Self>,
        listener: TcpListener,
        shutdown: impl std::future::Future<Output = ()>,
        drain: Duration,
    ) {
        let state = self;
        let mut connections = tokio::task::JoinSet::new();
        let shutdown = std::pin::pin!(shutdown);
        // Pooled clients hold idle keep-alive connections open indefinitely;
        // without this they would hold every shutdown for the whole drain.
        let (stop_tx, stop_rx) = watch::channel(());

        {
            let mut shutdown = shutdown;
            loop {
                tokio::select! {
                    // Biased so a pending shutdown wins over a connection that
                    // arrived in the same poll.
                    biased;
                    _ = &mut shutdown => break,
                    accepted = listener.accept() => {
                        let Ok((stream, _)) = accepted else { continue };
                        let state = Arc::clone(&state);
                        let mut stop = stop_rx.clone();
                        connections.spawn(async move {
                            let io = TokioIo::new(stream);
                            let svc = service_fn(move |req| {
                                let state = Arc::clone(&state);
                                async move { Ok::<_, Infallible>(state.route(req).await) }
                            });
                            let conn = http1::Builder::new().serve_connection(io, svc);
                            let mut conn = std::pin::pin!(conn);
                            // A dropped connection is the normal way a client
                            // cancels, so neither outcome is worth logging.
                            tokio::select! {
                                _ = conn.as_mut() => {}
                                _ = stop.changed() => {
                                    // Closes an idle connection now and lets an
                                    // in-flight response finish first.
                                    conn.as_mut().graceful_shutdown();
                                    let _ = conn.await;
                                }
                            }
                        });
                    }
                    // Reap finished connections so the set does not grow for the
                    // lifetime of the process.
                    Some(_) = connections.join_next(), if !connections.is_empty() => {}
                }
            }
        }

        if connections.is_empty() {
            return;
        }
        stop_tx.send_replace(());
        log::info!(
            "draining {} in-flight connection(s) before exit",
            connections.len()
        );
        if tokio::time::timeout(drain, async {
            while connections.join_next().await.is_some() {}
        })
        .await
        .is_err()
        {
            log::warn!(
                "{} connection(s) still open after {}s; abandoning them",
                connections.len(),
                drain.as_secs()
            );
        }
    }

    /// Turns on cross-session KV persistence. Separate from `bind` because the
    /// directory comes from the preset, which the caller has already read, and
    /// because every existing caller (including the tests) wants it off.
    pub fn with_slot_state(mut self, store: StateStore) -> Self {
        self.slots = Some(SlotState {
            store,
            occupancy: Mutex::new(SlotOccupancy::default()),
        });
        self
    }

    /// Parks the thread that was in this slot and picks up the incoming one.
    ///
    /// Ordering is load-bearing: the outgoing state has to reach disk before
    /// the restore overwrites the slot, and both have to finish before the
    /// completion task is posted. llama.cpp defers a slot action while that
    /// slot is generating, so each of these calls also serves as the barrier
    /// that keeps them from interleaving with a request already in flight.
    async fn hand_over_slot(&self, engine: &Arc<super::Engine>, model: &str, hint: &SlotHint) {
        let Some(state) = &self.slots else { return };
        let identity = {
            let mut reg = self.registry.lock().await;
            // A model the registry dropped took its slots' KV cache with it, so
            // the occupancy it left behind names a thread whose state is no
            // longer in any slot. Claiming against that returns `Evicted(prev)`
            // and would save this slot -- empty, or another thread's -- over
            // prev's file. Every drop path records itself; this is where the
            // record is spent, because it is the only place a claim is made.
            let dropped = reg.take_dropped();
            let identity = reg.state_identity(model);
            drop(reg);
            if !dropped.is_empty() {
                let mut occ = state.occupancy.lock().await;
                for model in dropped {
                    occ.release_model(&model);
                }
            }
            identity
        };
        let Some(identity) = identity else {
            return;
        };

        let claim = state
            .occupancy
            .lock()
            .await
            .claim(model, hint.slot, &hint.thread);

        match claim {
            // Turn 2 and later of the same thread. The slot already holds this
            // conversation's cache, and it is newer than the file on disk --
            // restoring here would discard the previous turn's prefill.
            Claim::Unchanged => return,
            Claim::Evicted(prev) => {
                state.save(engine, model, hint.slot, &prev, &identity).await;
            }
            Claim::Empty => {}
        }
        state
            .restore(engine, model, hint.slot, &hint.thread, &identity)
            .await;
    }

    /// Writes every resident slot to disk. The shutdown counterpart of
    /// `hand_over_slot`: without it, closing Jan while a thread is loaded
    /// discards exactly the cache the feature exists to keep, since nothing
    /// else evicts that slot.
    pub async fn save_resident_slots(&self) {
        self.save_slots(None).await
    }

    /// The same pass for one model, before it stops being resident.
    async fn save_model_slots(&self, model: &str) {
        self.save_slots(Some(model)).await
    }

    async fn save_slots(&self, only: Option<&str>) {
        let Some(state) = &self.slots else { return };
        let resident: Vec<_> = state
            .occupancy
            .lock()
            .await
            .all()
            .into_iter()
            .filter(|(m, _, _)| only.is_none_or(|want| m == want))
            .collect();
        for (model, slot, thread) in resident {
            // One lock for the residency check, the identity and the acquire:
            // taking three would let the model be evicted between them, and
            // `acquire` on an evicted model *loads* it -- a cold model load on
            // the shutdown path, to save a cache that no longer exists.
            let acquired = {
                let mut reg = self.registry.lock().await;
                if !reg.is_loaded(&model) {
                    continue;
                }
                let identity = reg.state_identity(&model);
                let engine = tokio::task::block_in_place(|| reg.acquire(&model));
                match (engine, identity) {
                    (Ok(e), Some(i)) => Some((e, i)),
                    (Ok(_), None) => {
                        reg.release(&model);
                        None
                    }
                    (Err(_), _) => None,
                }
            };
            let Some((engine, identity)) = acquired else {
                continue;
            };
            state.save(&engine, &model, slot, &thread, &identity).await;
            self.registry.lock().await.release(&model);
        }
    }

    /// Drops saved state for one thread, or for every thread of a model.
    async fn erase_slot_state(&self, body: &str) -> HttpResponse<Body> {
        let Some(state) = &self.slots else {
            return json_error(
                StatusCode::NOT_IMPLEMENTED,
                "this engine was started without a slot save path",
            );
        };
        let parsed: serde_json::Value = match serde_json::from_str(body) {
            Ok(v) => v,
            Err(e) => return json_error(StatusCode::BAD_REQUEST, &format!("bad json: {e}")),
        };
        // Either identifies what to drop. A deleted thread is the common case
        // and the UI knows only its id, so `thread` alone has to work; `model`
        // alone is for a model whose settings changed under it.
        let model = parsed.get("model").and_then(|v| v.as_str());
        let thread = parsed.get("thread").and_then(|v| v.as_str());
        let erased = match (model, thread) {
            (_, Some(thread)) => {
                let n = state.store.forget_thread(thread);
                state.occupancy.lock().await.release_thread(thread);
                n
            }
            (Some(model), None) => {
                let model = self.registry.lock().await.resolve(model);
                let n = state.store.forget_model(&model);
                state.occupancy.lock().await.release_model(&model);
                n
            }
            (None, None) => {
                return json_error(
                    StatusCode::BAD_REQUEST,
                    "one of model or thread is required",
                )
            }
        };
        json_ok(&serde_json::json!({ "erased": erased }))
    }

    async fn route(&self, req: Request<Incoming>) -> HttpResponse<Body> {
        let path = req.uri().path().to_string();
        let method = req.method().clone();
        // Taken before `req` is consumed for its body.
        let query = req.uri().query().map(str::to_string);

        if !authorized(&self.api_key, req.headers()) {
            return json_error(StatusCode::UNAUTHORIZED, "invalid api key");
        }

        // Listing is registry-wide: a model that is registered but not resident
        // must still appear, or the UI would lose it after an eviction.
        if method == Method::GET && matches!(path.as_str(), "/v1/models" | "/models") {
            return self.list_models().await;
        }

        // The lifecycle feed. Subscribed for the length of a load, so a failed
        // one is reported the moment it happens instead of waiting out the
        // caller's poll timeout.
        if method == Method::GET && path == "/models/sse" {
            return self.models_sse().await;
        }

        // Applying a regenerated preset. The router spelled this
        // `GET /models?reload=1`; a POST is used here because it mutates, and
        // because it carries the resized `models_max` the router could not
        // change without a restart.
        if method == Method::POST && path == "/models/reload" {
            let body = match req.into_body().collect().await {
                Ok(b) => b.to_bytes(),
                Err(_) => return json_error(StatusCode::BAD_REQUEST, "could not read the body"),
            };
            return self.reload_models(&String::from_utf8_lossy(&body)).await;
        }

        // Explicit lifecycle, at the router endpoints' paths so router-mode
        // clients need no rewrite.
        if method == Method::POST && matches!(path.as_str(), "/models/load" | "/models/unload") {
            let load = path.ends_with("/load");
            let body = match req.into_body().collect().await {
                Ok(b) => b.to_bytes(),
                Err(_) => return json_error(StatusCode::BAD_REQUEST, "could not read the body"),
            };
            let body = String::from_utf8_lossy(&body).into_owned();
            let Some(model) = extract_model(&body) else {
                return json_error(StatusCode::BAD_REQUEST, "model is required");
            };
            let model = self.registry.lock().await.resolve(&model);
            return if load {
                self.load_model(&model).await
            } else {
                self.unload_model(&model).await
            };
        }

        // Dropping a thread's saved KV cache, for a thread the user deleted.
        if method == Method::POST && path == "/slots/state/erase" {
            let body = match req.into_body().collect().await {
                Ok(b) => b.to_bytes(),
                Err(_) => return json_error(StatusCode::BAD_REQUEST, "could not read the body"),
            };
            return self.erase_slot_state(&String::from_utf8_lossy(&body)).await;
        }

        let Some(route) = Route::from_http_path(&path) else {
            return json_error(StatusCode::NOT_FOUND, &format!("no such route: {path}"));
        };

        let body = match req.into_body().collect().await {
            Ok(b) => b.to_bytes(),
            Err(_) => return json_error(StatusCode::BAD_REQUEST, "could not read the body"),
        };
        let body = String::from_utf8_lossy(&body).into_owned();

        // Routes that name no model, in the body or the query, are answered by
        // any resident engine; health has to work even when nothing is loaded.
        let model = match request_model(&body, query.as_deref()) {
            Some(name) => Some(self.registry.lock().await.resolve(&name)),
            None => None,
        };
        self.dispatch(route, model, body).await
    }

    /// Re-reads the preset named in the request and diffs it against the
    /// running set. `models_max` is optional; omitting it keeps the current
    /// value.
    async fn reload_models(&self, body: &str) -> HttpResponse<Body> {
        let parsed: serde_json::Value = match serde_json::from_str(body) {
            Ok(v) => v,
            Err(e) => return json_error(StatusCode::BAD_REQUEST, &format!("bad json: {e}")),
        };
        let Some(preset_path) = parsed.get("preset_path").and_then(|v| v.as_str()) else {
            return json_error(StatusCode::BAD_REQUEST, "preset_path is required");
        };
        let ini = match std::fs::read_to_string(preset_path) {
            Ok(s) => s,
            Err(e) => {
                return json_error(
                    StatusCode::BAD_REQUEST,
                    &format!("could not read {preset_path}: {e}"),
                )
            }
        };

        let preset = match super::preset::parse(preset_path, &ini) {
            Ok(p) => p,
            Err(e) => return json_error(StatusCode::BAD_REQUEST, &format!("{preset_path}: {e}")),
        };
        let mut reg = self.registry.lock().await;
        let models_max = parsed
            .get("models_max")
            .and_then(|v| v.as_u64())
            .map(|v| v as usize)
            .unwrap_or_else(|| reg.models_max());
        let outcome = reg.reload(preset.specs, models_max);
        reg.set_aliases(preset.aliases);
        drop(reg);

        // Applied here too, for the same reason models_max is: the value comes
        // from a setting the user can change while the worker runs, and the
        // alternative is a limit that does nothing until the app is restarted.
        let mut pruned = Vec::new();
        if let (Some(state), Some(mib)) = (
            &self.slots,
            parsed.get("slot_cache_mib").and_then(|v| v.as_u64()),
        ) {
            pruned = state.store.set_budget_mib(mib);
        }
        json_ok(&serde_json::json!({
            "added": outcome.added,
            "changed": outcome.changed,
            "removed": outcome.removed,
            "kept": outcome.kept,
            "models_max": models_max,
            "cache_pruned": pruned.len(),
        }))
    }

    async fn list_models(&self) -> HttpResponse<Body> {
        let reg = self.registry.lock().await;
        let busy = reg.busy_models();
        let data: Vec<serde_json::Value> = reg
            .known_models()
            .into_iter()
            .map(|id| {
                let failure = reg.failure_of(&id);
                serde_json::json!({
                    "id": id,
                    "object": "model",
                    "owned_by": "llamacpp",
                    // `status` mirrors llama.cpp's router shape, so router-mode
                    // load pollers parse it unchanged.
                    "status": {
                        "value": reg.status_of(&id).as_str(),
                        "failed": failure.is_some(),
                        "error": failure,
                    },
                    // Not part of the router's shape; the shutdown gate reads
                    // it to tell a generating model from a merely resident one.
                    "busy": busy.contains(&id),
                    // Not part of the router's shape: names that select this model too.
                    "aliases": reg.aliases_of(&id),
                })
            })
            .collect();
        json_ok(&serde_json::json!({ "object": "list", "data": data }))
    }

    /// Streams model lifecycle transitions until the client goes away.
    ///
    /// Subscribing before the response is returned is what makes this usable
    /// as a load watcher: a caller that opens the stream and only then posts
    /// `/models/load` cannot miss the `loading` event. A comment frame every
    /// [`SSE_KEEPALIVE`] keeps an idle subscription inside client idle timeouts.
    async fn models_sse(&self) -> HttpResponse<Body> {
        let rx = self.registry.lock().await.events().subscribe();
        HttpResponse::builder()
            .status(StatusCode::OK)
            .header(hyper::header::CONTENT_TYPE, "text/event-stream")
            .header(hyper::header::CACHE_CONTROL, "no-cache")
            .body(sse_body(rx, SSE_KEEPALIVE))
            .unwrap_or_else(|_| json_error(StatusCode::INTERNAL_SERVER_ERROR, "bad response"))
    }

    /// Loads a model and leaves it resident. Synchronous, unlike the router's
    /// fire-and-forget endpoint, so a failure is reported on this response
    /// instead of only showing up in a later poll.
    async fn load_model(&self, model: &str) -> HttpResponse<Body> {
        {
            let reg = self.registry.lock().await;
            if reg.is_loaded(model) {
                return json_ok(&serde_json::json!({
                    "status": "already loaded", "model": model
                }));
            }
        }
        // Serializing loads behind the lock is deliberate -- two concurrent
        // loads would race on models_max -- but starting a llama_context is
        // blocking, so it needs block_in_place to move other tasks off this
        // worker instead of stalling the reactor. `block_on` inside
        // `spawn_blocking` would risk deadlocking the runtime.
        let mut reg = self.registry.lock().await;
        let outcome = tokio::task::block_in_place(|| {
            let r = reg.acquire(model).map(|_| ());
            if r.is_ok() {
                // Resident but idle, so it stays evictable under models_max.
                reg.release(model);
            }
            r
        });
        drop(reg);

        match outcome {
            Ok(()) => json_ok(&serde_json::json!({ "status": "loaded", "model": model })),
            Err(RegistryError::Full { models_max }) => json_error(
                StatusCode::SERVICE_UNAVAILABLE,
                &format!("all {models_max} model slots are busy; retry shortly"),
            ),
            Err(RegistryError::Engine(e)) => json_error(StatusCode::BAD_REQUEST, &e.to_string()),
        }
    }

    /// Refuses while requests are in flight rather than cancelling them, which
    /// is what upstream's router does.
    async fn unload_model(&self, model: &str) -> HttpResponse<Body> {
        if !self.registry.lock().await.is_loaded(model) {
            return json_ok(&serde_json::json!({
                "status": "already unloaded", "model": model
            }));
        }
        // Before the drop, not after: `unload` takes the engine and the slot's
        // KV cache with it. With `models_max` at 1 a caller switching models
        // unloads the outgoing model before loading the next, so without this the thread being left behind
        // loses exactly the cache this feature exists to keep.
        self.save_model_slots(model).await;
        let mut reg = self.registry.lock().await;
        if reg.unload(model) {
            json_ok(&serde_json::json!({ "status": "unloaded", "model": model }))
        } else {
            json_error(
                StatusCode::CONFLICT,
                "the model has requests in flight; retry once they finish",
            )
        }
    }

    async fn dispatch(
        &self,
        route: Route,
        model: Option<String>,
        body: String,
    ) -> HttpResponse<Body> {
        // No model named: fall back to whatever is resident, which is what
        // single-model callers (and /health) expect.
        let Some(model) = model else {
            return self.dispatch_any(route, body).await;
        };

        let (engine, claim) = {
            let mut reg = self.registry.lock().await;
            // acquire may start an engine, which blocks; see load_model.
            match tokio::task::block_in_place(|| reg.acquire(&model)) {
                Ok(e) => (
                    e,
                    InflightGuard::new(Arc::clone(&self.registry), model.clone()),
                ),
                Err(RegistryError::Full { models_max }) => {
                    return json_error(
                        StatusCode::SERVICE_UNAVAILABLE,
                        &format!("all {models_max} model slots are busy; retry shortly"),
                    )
                }
                Err(RegistryError::Engine(e)) => {
                    return json_error(StatusCode::BAD_REQUEST, &e.to_string())
                }
            }
        };

        // Only a generating route has a KV cache worth keeping; an embedding or
        // a tokenize call leaves nothing behind.
        let body = if route.caches_prompt() {
            if let Some(hint) = SlotHint::from_body(&body) {
                self.hand_over_slot(&engine, &model, &hint).await;
            }
            strip_thread_field(&body)
        } else {
            body
        };

        run(engine, claim, route, body, STREAM_BUFFER).await
    }

    /// For routes with no model in the body: use the first resident engine.
    async fn dispatch_any(&self, route: Route, body: String) -> HttpResponse<Body> {
        let (engine, claim) = {
            let mut reg = self.registry.lock().await;
            let Some(first) = reg.loaded_models().into_iter().next() else {
                return json_error(StatusCode::SERVICE_UNAVAILABLE, "no model is loaded");
            };
            match tokio::task::block_in_place(|| reg.acquire(&first)) {
                Ok(e) => (e, InflightGuard::new(Arc::clone(&self.registry), first)),
                Err(e) => return json_error(StatusCode::SERVICE_UNAVAILABLE, &format!("{e:?}")),
            }
        };
        run(engine, claim, route, body, STREAM_BUFFER).await
    }
}

impl SlotState {
    /// Saves a slot under `thread`'s key, if there is enough in it to be worth
    /// the write.
    ///
    /// The token count is read from `/slots` *first* rather than from the save
    /// response, because a state file is hundreds of MiB for a long
    /// conversation and writing one only to delete it again is the expensive
    /// way to learn it was too short.
    async fn save(
        &self,
        engine: &Arc<super::Engine>,
        model: &str,
        slot: i32,
        thread: &str,
        identity: &Identity,
    ) {
        // A zero budget keeps the store (so the directory can be pruned and a
        // deleted thread erased) but writes nothing new.
        if !self.store.saves_enabled() {
            return;
        }
        let n_tokens = slot_tokens(engine, slot).await;
        if n_tokens < MIN_TOKENS_TO_SAVE {
            return;
        }
        let key = super::slots::state_key(model, thread);
        let file = StateStore::state_file_name(&key);
        let body = serde_json::json!({ "filename": file }).to_string();
        let query = format!("id_slot={slot}&action=save");

        let engine = Arc::clone(engine);
        let res = tokio::task::block_in_place(move || {
            let r = engine.request_with_query(Route::SlotsAction.as_shim_name(), &query, &body);
            (r.status(), r.body())
        });
        if res.0 >= 400 {
            log::warn!(
                "could not save the KV cache of {model} slot {slot}: {}",
                res.1
            );
            // A half-written file with no sidecar would be refused later
            // anyway; dropping it now keeps the directory honest.
            self.store.forget(&key);
            return;
        }
        if let Err(e) = self.store.commit(&key, identity.clone(), thread, n_tokens) {
            log::warn!("saved the KV cache of {model} but could not record it: {e}");
            self.store.forget(&key);
            return;
        }
        log::info!("parked {n_tokens} cached tokens for thread {thread} ({model})");
    }

    /// Restores `thread`'s state into the slot, if one was saved by the same
    /// model and the same llama.cpp.
    async fn restore(
        &self,
        engine: &Arc<super::Engine>,
        model: &str,
        slot: i32,
        thread: &str,
        identity: &Identity,
    ) {
        let key = super::slots::state_key(model, thread);
        let meta = match self.store.check(&key, identity) {
            Ok(m) => m,
            Err(super::slots::Reject::Absent) => return,
            Err(reason) => {
                log::info!("not restoring the KV cache of thread {thread}: {reason}");
                return;
            }
        };

        let file = StateStore::state_file_name(&key);
        let body = serde_json::json!({ "filename": file }).to_string();
        let query = format!("id_slot={slot}&action=restore");
        let engine = Arc::clone(engine);
        let res = tokio::task::block_in_place(move || {
            let r = engine.request_with_query(Route::SlotsAction.as_shim_name(), &query, &body);
            (r.status(), r.body())
        });
        if res.0 >= 400 {
            // llama.cpp rejects a state it cannot use (no room in the KV cache,
            // tokens outside the vocab). The guard passed, so this is not a
            // mismatch we can describe -- but the file is still unusable.
            log::warn!(
                "could not restore the KV cache of thread {thread}: {}",
                res.1
            );
            self.store.forget(&key);
            return;
        }
        log::info!(
            "restored {} cached tokens for thread {thread} ({model})",
            meta.n_tokens
        );
    }
}

/// Tokens currently cached in a slot, from `GET /slots`.
///
/// 0 when the slot has never run a task (upstream omits the count entirely in
/// that case) or when the listing cannot be read, both of which mean "nothing
/// worth saving".
async fn slot_tokens(engine: &Arc<super::Engine>, slot: i32) -> u64 {
    let engine = Arc::clone(engine);
    let body =
        tokio::task::block_in_place(move || engine.request(Route::Slots.as_shim_name(), "").body());
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&body) else {
        return 0;
    };
    v.as_array()
        .into_iter()
        .flatten()
        .find(|e| e.get("id").and_then(|i| i.as_i64()) == Some(slot as i64))
        .and_then(|e| e.get("n_prompt_tokens"))
        .and_then(|n| n.as_u64())
        .unwrap_or(0)
}

/// Issues one request and adapts the engine's response to an HTTP body.
///
/// `claim` is held until the engine is done with the request: past the
/// returned headers for a stream, and past this future's cancellation while
/// the engine call is still running.
async fn run(
    engine: Arc<super::Engine>,
    claim: InflightGuard,
    route: Route,
    body: String,
    buffer: usize,
) -> HttpResponse<Body> {
    let name = route.as_shim_name();

    // The engine call itself blocks: it takes the server queue and may wait on
    // a slot, so it must not run on the reactor.
    let engine2 = Arc::clone(&engine);
    let head = tokio::task::spawn_blocking(move || {
        let res = engine2.request(name, &body);
        let is_stream = res.is_stream();
        // Not read on a stream. Upstream prefills `res->data` with the first SSE
        // event and then has its own generator flush that same buffer as chunk
        // one (server-context.cpp: `if (!res_this->data.empty()) { output =
        // std::move(res_this->data); ... }`), so taking the body *and* draining
        // would put that event on the wire twice. Upstream's own HTTP layer
        // treats the two as strictly either/or; so does this. Jan sets
        // `return_progress` on every stream, which makes the prefilled event a
        // real 0% partial instead of an empty one, so the duplicate fired on
        // every streaming completion rather than being latent.
        let first = if is_stream { String::new() } else { res.body() };
        (
            res.status(),
            res.content_type(),
            first,
            is_stream,
            res,
            claim,
        )
    })
    .await;

    let Ok((status, content_type, first, is_stream, res, claim)) = head else {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "engine task panicked");
    };

    let status = StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);

    if !is_stream {
        return HttpResponse::builder()
            .status(status)
            .header(hyper::header::CONTENT_TYPE, content_type)
            .body(Full::new(Bytes::from(first)).boxed())
            .unwrap_or_else(|_| json_error(StatusCode::INTERNAL_SERVER_ERROR, "bad response"));
    }

    // Streaming: drain the blocking generator on its own thread into a bounded
    // channel. Dropping the receiver (client gone) makes the send fail, which
    // cancels generation instead of running it to completion for nobody.
    let (tx, rx) = mpsc::channel::<Result<Frame<Bytes>, Infallible>>(buffer);
    tokio::task::spawn_blocking(move || {
        // Bound in this order so they drop in reverse, on unwinding too: `res`
        // is a bare handle into the engine's server context, so it goes first,
        // and the model becomes idle only after nothing here can touch it.
        let _claim = claim;
        let _engine = engine;
        let mut res = res;
        loop {
            match res.next_chunk() {
                Ok(Some(chunk)) => {
                    if chunk.is_empty() {
                        continue;
                    }
                    if tx
                        .blocking_send(Ok(Frame::data(Bytes::from(chunk))))
                        .is_err()
                    {
                        res.cancel();
                        break;
                    }
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }
    });

    HttpResponse::builder()
        .status(status)
        .header(hyper::header::CONTENT_TYPE, content_type)
        .header(hyper::header::CACHE_CONTROL, "no-cache")
        .body(StreamBody::new(tokio_stream_wrapper(rx)).boxed())
        .unwrap_or_else(|_| json_error(StatusCode::INTERNAL_SERVER_ERROR, "bad response"))
}

/// Interval between `/models/sse` keepalive comments: well below the 300 s
/// body idle timeout of Node's fetch, the supervisor's client.
const SSE_KEEPALIVE: Duration = Duration::from_secs(15);

/// One SSE comment frame; parsers drop it without dispatching an event.
const SSE_KEEPALIVE_FRAME: &str = ": keepalive\n\n";

/// Streams `rx`'s transitions as SSE frames, plus a keepalive comment whenever
/// `keepalive` passes without a frame, until the client goes away or falls
/// behind the event channel.
fn sse_body(mut rx: broadcast::Receiver<ModelEvent>, keepalive: Duration) -> Body {
    let (tx, out) = mpsc::channel::<Result<Frame<Bytes>, Infallible>>(STREAM_BUFFER);
    tokio::spawn(async move {
        let mut idle = tokio::time::interval_at(tokio::time::Instant::now() + keepalive, keepalive);
        idle.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            let frame = tokio::select! {
                received = rx.recv() => match received {
                    Ok(event) => event.to_sse_frame(),
                    // A subscriber too slow for CHANNEL_CAPACITY has missed
                    // transitions; ending the feed makes the client resync from
                    // `GET /models` instead of mirroring a stale state.
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        log::warn!("a /models/sse subscriber lagged and missed {n} event(s); ending its feed");
                        return;
                    }
                    Err(broadcast::error::RecvError::Closed) => return,
                },
                _ = idle.tick() => SSE_KEEPALIVE_FRAME.to_string(),
            };
            idle.reset();
            if tx.send(Ok(Frame::data(Bytes::from(frame)))).await.is_err() {
                return; // client gone
            }
        }
    });
    StreamBody::new(tokio_stream_wrapper(out)).boxed()
}

fn tokio_stream_wrapper(
    rx: mpsc::Receiver<Result<Frame<Bytes>, Infallible>>,
) -> impl futures_util::Stream<Item = Result<Frame<Bytes>, Infallible>> {
    futures_util::stream::unfold(rx, |mut rx| async move {
        rx.recv().await.map(|item| (item, rx))
    })
}

/// An empty configured key means auth is off, which is how a caller that owns
/// the loopback port entirely (tests, a single-user desktop) opts out.
fn authorized(api_key: &str, headers: &hyper::HeaderMap) -> bool {
    if api_key.is_empty() {
        return true;
    }
    headers
        .get(hyper::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .is_some_and(|k| k == api_key)
}

/// The `model` field OpenAI requests carry, used to pick the engine. Absent for
/// `/health` and single-model callers; `/props` names its model in the query
/// string instead (see [`request_model`]).
fn extract_model(body: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()?
        .get("model")?
        .as_str()
        .map(str::to_string)
        .filter(|s| !s.is_empty())
}

/// The model a request addresses: the body's `model` field when it has one, else
/// the `model` query parameter.
///
/// The query is what lets a body-less `GET /props?model=<id>` reach the right
/// engine. Without it such a request has no model and `dispatch_any` answers it
/// from the first resident engine in id order, so the chat window, slot count
/// and modalities came from whichever model sorted first -- the embedding model
/// as soon as an attachment had loaded one.
fn request_model(body: &str, query: Option<&str>) -> Option<String> {
    extract_model(body).or_else(|| query_param(query?, "model"))
}

/// First non-empty value of `key` in a query string, percent-decoded.
///
/// `+` stays a plus: the caller writes ids with `encodeURIComponent`, which
/// spells a space `%20` and a literal plus `%2B`, and an imported model's id is
/// a file path where a plus is ordinary.
fn query_param(query: &str, key: &str) -> Option<String> {
    query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .filter(|(k, _)| *k == key)
        .find_map(|(_, v)| percent_decode(v).filter(|s| !s.is_empty()))
}

/// `None` for a malformed escape or a result that is not UTF-8, so a bad
/// request is treated as naming no model rather than naming a wrong one.
fn percent_decode(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = bytes.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(std::str::from_utf8(hex).ok()?, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn json_ok(v: &serde_json::Value) -> HttpResponse<Body> {
    HttpResponse::builder()
        .status(StatusCode::OK)
        .header(
            hyper::header::CONTENT_TYPE,
            "application/json; charset=utf-8",
        )
        .body(Full::new(Bytes::from(v.to_string())).boxed())
        .expect("a literal json response is always buildable")
}

fn json_error(status: StatusCode, message: &str) -> HttpResponse<Body> {
    let v = serde_json::json!({ "error": { "message": message, "code": status.as_u16() } });
    HttpResponse::builder()
        .status(status)
        .header(
            hyper::header::CONTENT_TYPE,
            "application/json; charset=utf-8",
        )
        .body(Full::new(Bytes::from(v.to_string())).boxed())
        .expect("a literal json response is always buildable")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_get_names_its_model_in_the_query_string() {
        // `getModelProps` asks `/props?model=<id>`; that request has no body.
        assert_eq!(
            request_model("", Some("model=qwen")).as_deref(),
            Some("qwen")
        );
    }

    #[test]
    fn a_query_model_is_percent_decoded_like_encodeuricomponent_writes_it() {
        // Imported models are ids like a Windows path: `\`, `:` and spaces.
        assert_eq!(
            request_model("", Some("model=E%3A%5CML%5Cembed%5Cbge-m3%20Q6_K.gguf")).as_deref(),
            Some(r"E:\ML\embed\bge-m3 Q6_K.gguf")
        );
        // `+` is a literal plus in encodeURIComponent output, spelled %2B.
        assert_eq!(
            request_model("", Some("model=a%2Bb")).as_deref(),
            Some("a+b")
        );
    }

    #[test]
    fn the_body_wins_over_the_query() {
        assert_eq!(
            request_model(r#"{"model":"from-body"}"#, Some("model=from-query")).as_deref(),
            Some("from-body")
        );
    }

    #[test]
    fn no_model_anywhere_stays_unaddressed() {
        assert_eq!(request_model("", None), None);
        assert_eq!(request_model("", Some("reload=1")), None);
        assert_eq!(request_model("", Some("model=")), None);
        assert_eq!(
            request_model("", Some("a=b&model=x&model=y")).as_deref(),
            Some("x")
        );
    }

    #[test]
    fn a_malformed_query_names_no_model_rather_than_a_wrong_one() {
        // Truncated escape, non-hex escape, and bytes that are not UTF-8.
        assert_eq!(request_model("", Some("model=ab%2")), None);
        assert_eq!(request_model("", Some("model=%zz")), None);
        assert_eq!(request_model("", Some("model=%E0%A4")), None);
    }

    #[test]
    fn extract_model_reads_the_openai_field() {
        assert_eq!(
            extract_model(r#"{"model":"qwen","messages":[]}"#).as_deref(),
            Some("qwen")
        );
    }

    #[test]
    fn extract_model_tolerates_absent_empty_and_non_json_bodies() {
        assert_eq!(extract_model(r#"{"messages":[]}"#), None);
        assert_eq!(extract_model(r#"{"model":""}"#), None);
        assert_eq!(extract_model(r#"{"model":123}"#), None);
        assert_eq!(extract_model("not json at all"), None);
        assert_eq!(extract_model(""), None);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn bind_with_port_zero_reports_the_port_the_os_chose() {
        let reg = Arc::new(Mutex::new(Registry::new(1)));
        let (server, listener) = EngineServer::bind(reg, 0, "k".into())
            .await
            .expect("loopback bind should succeed");
        assert_ne!(server.port, 0, "the OS-assigned port must be reported back");
        assert_eq!(listener.local_addr().unwrap().port(), server.port);
    }

    fn headers(auth: Option<&str>) -> hyper::HeaderMap {
        let mut h = hyper::HeaderMap::new();
        if let Some(a) = auth {
            h.insert(hyper::header::AUTHORIZATION, a.parse().unwrap());
        }
        h
    }

    #[test]
    fn a_thread_hint_needs_both_the_thread_and_the_slot() {
        let both = r#"{"model":"m","thread_id":"t1","id_slot":0}"#;
        assert_eq!(
            SlotHint::from_body(both),
            Some(SlotHint {
                thread: "t1".into(),
                slot: 0
            })
        );
        // Without id_slot there is no way to know which slot ran the request.
        assert_eq!(SlotHint::from_body(r#"{"thread_id":"t1"}"#), None);
        assert_eq!(SlotHint::from_body(r#"{"id_slot":0}"#), None);
        assert_eq!(SlotHint::from_body("{}"), None);
        assert_eq!(SlotHint::from_body("not json"), None);
    }

    // A blank thread id would key every unlabelled request to one state file.
    #[test]
    fn a_blank_or_negative_hint_is_ignored() {
        assert_eq!(
            SlotHint::from_body(r#"{"thread_id":"  ","id_slot":0}"#),
            None
        );
        assert_eq!(
            SlotHint::from_body(r#"{"thread_id":"t","id_slot":-1}"#),
            None
        );
    }

    #[test]
    fn the_thread_field_is_stripped_before_the_body_is_forwarded() {
        let out = strip_thread_field(r#"{"model":"m","thread_id":"t1","id_slot":0}"#);
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert!(v.get("thread_id").is_none(), "llama.cpp must not see it");
        assert_eq!(v["model"], "m");
        assert_eq!(v["id_slot"], 0);
    }

    #[test]
    fn a_body_without_the_field_is_forwarded_byte_for_byte() {
        let body = r#"{"model":"m","id_slot":0}"#;
        assert_eq!(strip_thread_field(body), body);
        assert_eq!(strip_thread_field("not json"), "not json");
        assert_eq!(strip_thread_field("[1,2]"), "[1,2]");
    }

    #[test]
    fn only_generating_routes_carry_a_cache_worth_saving() {
        assert!(Route::ChatCompletions.caches_prompt());
        assert!(Route::Completions.caches_prompt());
        assert!(!Route::Embeddings.caches_prompt());
        assert!(!Route::Tokenize.caches_prompt());
        assert!(!Route::Slots.caches_prompt());
    }

    #[tokio::test]
    async fn erasing_state_without_a_store_is_reported_not_silently_ignored() {
        let (server, _l) =
            EngineServer::bind(Arc::new(Mutex::new(Registry::new(1))), 0, String::new())
                .await
                .unwrap();
        let res = server.erase_slot_state(r#"{"model":"m"}"#).await;
        assert_eq!(res.status(), StatusCode::NOT_IMPLEMENTED);
    }

    #[cfg(not(feature = "engine"))]
    struct Claimed {
        server: EngineServer,
        reg: Arc<Mutex<Registry>>,
        engine: Arc<crate::Engine>,
        claim: InflightGuard,
    }

    /// A registry with one resident stub model, claimed once as `dispatch`
    /// claims it for a request.
    #[cfg(not(feature = "engine"))]
    async fn claimed(model: &str) -> Claimed {
        let reg = Arc::new(Mutex::new(Registry::new(1)));
        reg.lock().await.insert_resident_stub(model);
        let engine = reg
            .lock()
            .await
            .acquire(model)
            .expect("a resident model is acquirable");
        let (server, _l) = EngineServer::bind(Arc::clone(&reg), 0, String::new())
            .await
            .unwrap();
        let claim = InflightGuard::new(Arc::clone(&reg), model.to_string());
        Claimed {
            server,
            reg,
            engine,
            claim,
        }
    }

    #[cfg(not(feature = "engine"))]
    async fn wait_idle(reg: &Mutex<Registry>, model: &str) {
        tokio::time::timeout(Duration::from_secs(5), async {
            while reg.lock().await.busy_models().iter().any(|m| m == model) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("the claim was never released");
    }

    // The streaming generator owns the claim on a blocking thread after
    // `dispatch` has returned; unload has to keep refusing until it ends.
    #[cfg(not(feature = "engine"))]
    #[tokio::test(flavor = "multi_thread")]
    async fn a_claim_held_by_a_generator_keeps_the_model_busy_until_it_ends() {
        let Claimed {
            server, reg, claim, ..
        } = claimed("m").await;
        let (finish, finished) = std::sync::mpsc::channel::<()>();
        let generator = tokio::task::spawn_blocking(move || {
            let _claim = claim;
            finished.recv().ok();
        });

        assert_eq!(reg.lock().await.busy_models(), vec!["m".to_string()]);
        assert_eq!(
            server.unload_model("m").await.status(),
            StatusCode::CONFLICT
        );
        let listed = server.list_models().await.into_body().collect().await;
        let listed: serde_json::Value =
            serde_json::from_slice(&listed.unwrap().to_bytes()).unwrap();
        assert_eq!(listed["data"][0]["busy"], true);

        finish.send(()).unwrap();
        generator.await.unwrap();
        wait_idle(&reg, "m").await;
        assert_eq!(server.unload_model("m").await.status(), StatusCode::OK);
    }

    #[cfg(not(feature = "engine"))]
    #[tokio::test(flavor = "multi_thread")]
    async fn a_panicking_generator_still_releases_its_claim() {
        let Claimed { reg, claim, .. } = claimed("m").await;
        let generator = tokio::task::spawn_blocking(move || {
            let _claim = claim;
            panic!("generator failed");
        });
        assert!(generator.await.is_err());
        wait_idle(&reg, "m").await;
    }

    // Dropping on the reactor while the registry lock is held must neither
    // block nor lose the release.
    #[cfg(not(feature = "engine"))]
    #[tokio::test]
    async fn a_claim_dropped_under_a_held_lock_is_released_once_it_frees() {
        let Claimed { reg, claim, .. } = claimed("m").await;
        let held = reg.lock().await;
        drop(claim);
        assert_eq!(held.busy_models(), vec!["m".to_string()]);
        drop(held);
        wait_idle(&reg, "m").await;
    }

    // The non-streaming path hands the claim back when the response is built.
    #[cfg(not(feature = "engine"))]
    #[tokio::test(flavor = "multi_thread")]
    async fn a_buffered_response_releases_its_claim_when_run_returns() {
        let Claimed {
            reg, engine, claim, ..
        } = claimed("m").await;
        let res = run(engine, claim, Route::Health, String::new(), 1).await;
        assert_eq!(res.status(), StatusCode::SERVICE_UNAVAILABLE);
        wait_idle(&reg, "m").await;
        assert!(reg.lock().await.unload("m"));
    }

    #[test]
    fn an_empty_api_key_disables_auth() {
        assert!(authorized("", &headers(None)));
        assert!(authorized("", &headers(Some("Bearer anything"))));
    }

    #[test]
    fn a_set_api_key_is_enforced_and_the_scheme_must_match() {
        assert!(authorized("secret", &headers(Some("Bearer secret"))));
        assert!(!authorized("secret", &headers(None)));
        assert!(!authorized("secret", &headers(Some("Bearer wrong"))));
        // A bare token with no scheme must not pass.
        assert!(!authorized("secret", &headers(Some("secret"))));
        // Scheme comparison is case-sensitive, matching what the extension sends.
        assert!(!authorized("secret", &headers(Some("bearer secret"))));
    }

    async fn next_frame(body: &mut Body) -> String {
        let frame = tokio::time::timeout(Duration::from_secs(5), body.frame())
            .await
            .expect("the feed went quiet")
            .expect("the feed ended")
            .unwrap();
        String::from_utf8(frame.into_data().unwrap().to_vec()).unwrap()
    }

    // An idle subscription has to keep bytes flowing, or a client body idle
    // timeout drops it; events still arrive between the comments.
    #[tokio::test]
    async fn an_idle_model_feed_sends_keepalive_comments_between_events() {
        let bus = crate::events::EventBus::new();
        let mut body = sse_body(bus.subscribe(), Duration::from_millis(20));
        assert_eq!(next_frame(&mut body).await, ": keepalive\n\n");
        assert_eq!(next_frame(&mut body).await, ": keepalive\n\n");
        bus.emit("m", crate::events::Transition::Loaded);
        let mut frame = next_frame(&mut body).await;
        while frame == SSE_KEEPALIVE_FRAME {
            frame = next_frame(&mut body).await;
        }
        assert!(frame.starts_with("data: "), "{frame:?}");
        assert!(frame.contains(r#""status":"loaded""#), "{frame:?}");
        assert_eq!(next_frame(&mut body).await, ": keepalive\n\n");
    }

    #[tokio::test]
    async fn a_lagged_model_feed_ends() {
        let bus = crate::events::EventBus::new();
        let rx = bus.subscribe();
        for _ in 0..=crate::events::CHANNEL_CAPACITY {
            bus.emit("m", crate::events::Transition::Loaded);
        }
        let mut body = sse_body(rx, Duration::from_secs(3600));
        let end = tokio::time::timeout(Duration::from_secs(5), body.frame())
            .await
            .expect("the lagged feed stayed open");
        assert!(end.is_none(), "{end:?}");
    }
}
