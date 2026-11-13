use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use island_contract::{Event, WsClientMessage, WsServerMessage};
use island_store::Store;
use serde_json::json;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use subtle::ConstantTimeEq;
use tokio::sync::{mpsc, RwLock};
use tracing::{debug, info, warn};

pub const DEFAULT_PORT: u16 = 47821;
pub const MAX_WS_CONNECTIONS: usize = 8;
pub const MAX_BODY_BYTES: usize = 16 * 1024; // 16 KiB

#[derive(Clone)]
pub struct ServerState {
    pub pairing_token: Arc<RwLock<String>>,
    pub store: Store,
    pub event_tx: mpsc::Sender<Event>,
    pub active_ws_count: Arc<AtomicUsize>,
}

impl ServerState {
    pub fn new(token: String, store: Store, event_tx: mpsc::Sender<Event>) -> Self {
        Self {
            pairing_token: Arc::new(RwLock::new(token)),
            store,
            event_tx,
            active_ws_count: Arc::new(AtomicUsize::new(0)),
        }
    }

    pub async fn verify_token(&self, token_candidate: &str) -> bool {
        let guard = self.pairing_token.read().await;
        if guard.len() != token_candidate.len() {
            return false;
        }
        guard.as_bytes().ct_eq(token_candidate.as_bytes()).into()
    }
}

pub fn create_router(state: ServerState) -> Router {
    Router::new()
        .route("/v1/health", get(health_handler))
        .route("/v1/events", post(events_handler))
        .route("/v1/ws", get(ws_handler))
        .with_state(state)
}

async fn health_handler() -> impl IntoResponse {
    Json(json!({ "ok": true }))
}

async fn events_handler(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Json(mut event): Json<Event>,
) -> Response {
    // 1. Host header check
    if !is_host_valid(&headers) {
        return (StatusCode::FORBIDDEN, "Invalid Host header").into_response();
    }

    // 2. Authorization Bearer Token check
    let auth_header = headers.get("authorization").and_then(|h| h.to_str().ok());
    let token = match auth_header {
        Some(h) if h.starts_with("Bearer ") => &h["Bearer ".len()..],
        _ => return (StatusCode::UNAUTHORIZED, "Missing or invalid Bearer token").into_response(),
    };

    if !state.verify_token(token).await {
        return (StatusCode::UNAUTHORIZED, "Invalid pairing token").into_response();
    }

    // 3. Normalize & validate event
    if let Err(err) = event.normalize_and_validate(Utc::now()) {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({ "error": err.to_string() })),
        )
            .into_response();
    }

    // 4. Send to ingest channel
    let id = event.id;
    if state.event_tx.send(event).await.is_err() {
        return (StatusCode::INTERNAL_SERVER_ERROR, "Ingest channel closed").into_response();
    }

    (
        StatusCode::ACCEPTED,
        Json(json!({ "id": id, "status": "accepted" })),
    )
        .into_response()
}

async fn ws_handler(
    State(state): State<ServerState>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    // 1. Host check
    if !is_host_valid(&headers) {
        return (StatusCode::FORBIDDEN, "Invalid Host header").into_response();
    }

    // 2. Origin check: strictly block web pages (http/https). Allow extension / localhost
    if let Some(origin) = headers.get("origin").and_then(|h| h.to_str().ok()) {
        if origin.starts_with("http://") || origin.starts_with("https://") {
            return (StatusCode::FORBIDDEN, "Webpage origins rejected").into_response();
        }
    }

    // 3. Check connection cap
    if state.active_ws_count.load(Ordering::SeqCst) >= MAX_WS_CONNECTIONS {
        return (StatusCode::SERVICE_UNAVAILABLE, "Max connections reached").into_response();
    }

    let origin = headers
        .get("origin")
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_string());

    ws.on_upgrade(move |socket| handle_ws_socket(socket, state, origin))
}

async fn handle_ws_socket(mut socket: WebSocket, state: ServerState, origin: Option<String>) {
    state.active_ws_count.fetch_add(1, Ordering::SeqCst);
    debug!(
        "WebSocket connection opened, total: {}",
        state.active_ws_count.load(Ordering::SeqCst)
    );

    let mut authenticated = false;

    // Timeout for hello auth is 5 seconds
    let auth_timeout = tokio::time::sleep(Duration::from_secs(5));
    tokio::pin!(auth_timeout);

    loop {
        tokio::select! {
            _ = &mut auth_timeout, if !authenticated => {
                warn!("WebSocket authentication timed out (5s)");
                let _ = socket.send(Message::Close(Some(axum::extract::ws::CloseFrame {
                    code: 4002,
                    reason: "Auth timeout".into(),
                }))).await;
                break;
            }
            msg = socket.recv() => {
                let msg = match msg {
                    Some(Ok(m)) => m,
                    _ => break,
                };

                match msg {
                    Message::Text(text) => {
                        if text.len() > MAX_BODY_BYTES {
                            let _ = socket.send(Message::Close(Some(axum::extract::ws::CloseFrame {
                                code: 4008,
                                reason: "Payload too large".into(),
                            }))).await;
                            break;
                        }

                        if !authenticated {
                            // First message must be hello
                            let parsed: Result<WsClientMessage, _> = serde_json::from_str(&text);
                            match parsed {
                                Ok(WsClientMessage::Hello { token, client, .. }) => {
                                    if state.verify_token(&token).await {
                                        // Origin pinning
                                        if let Some(ref orig) = origin {
                                            if orig.starts_with("chrome-extension://") {
                                                let _ = state.store.add_paired_origin(orig, &client);
                                            }
                                        }
                                        authenticated = true;
                                        let welcome = WsServerMessage::Welcome {
                                            server_version: "0.1.0".to_string(),
                                            app_name: "Island".to_string(),
                                        };
                                        let _ = socket.send(Message::Text(serde_json::to_string(&welcome).unwrap())).await;
                                    } else {
                                        let _ = socket.send(Message::Close(Some(axum::extract::ws::CloseFrame {
                                            code: 4001,
                                            reason: "Bad token".into(),
                                        }))).await;
                                        break;
                                    }
                                }
                                _ => {
                                    let _ = socket.send(Message::Close(Some(axum::extract::ws::CloseFrame {
                                        code: 4002,
                                        reason: "Hello expected".into(),
                                    }))).await;
                                    break;
                                }
                            }
                        } else {
                            // Authenticated messages
                            let parsed: Result<WsClientMessage, _> = serde_json::from_str(&text);
                            match parsed {
                                Ok(WsClientMessage::Event { mut event }) => {
                                    let id = event.id;
                                    if event.normalize_and_validate(Utc::now()).is_ok() && state.event_tx.send(event).await.is_ok() {
                                        let ack = WsServerMessage::Ack {
                                            id,
                                            status: "accepted".to_string(),
                                            reason: None,
                                        };
                                        let _ = socket.send(Message::Text(serde_json::to_string(&ack).unwrap())).await;
                                    } else {
                                        let ack = WsServerMessage::Ack {
                                            id,
                                            status: "rejected".to_string(),
                                            reason: Some("Validation failed".to_string()),
                                        };
                                        let _ = socket.send(Message::Text(serde_json::to_string(&ack).unwrap())).await;
                                    }
                                }
                                Ok(WsClientMessage::Ping { t }) => {
                                    let pong = WsServerMessage::Pong { t };
                                    let _ = socket.send(Message::Text(serde_json::to_string(&pong).unwrap())).await;
                                }
                                _ => {}
                            }
                        }
                    }
                    Message::Ping(p) => {
                        let _ = socket.send(Message::Pong(p)).await;
                    }
                    Message::Close(_) => break,
                    _ => {}
                }
            }
        }
    }

    state.active_ws_count.fetch_sub(1, Ordering::SeqCst);
    debug!("WebSocket connection closed");
}

fn is_host_valid(headers: &HeaderMap) -> bool {
    if let Some(host) = headers.get("host").and_then(|h| h.to_str().ok()) {
        host.starts_with("127.0.0.1:")
            || host.starts_with("localhost:")
            || host == "127.0.0.1"
            || host == "localhost"
    } else {
        true
    }
}

pub async fn start_server(
    port: u16,
    state: ServerState,
) -> Result<tokio::task::JoinHandle<()>, std::io::Error> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!("Island server bound to http://{}", addr);

    let app = create_router(state);
    let handle = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });

    Ok(handle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_server_health_and_token() {
        let store = Store::open_in_memory().unwrap();
        let (tx, _rx) = mpsc::channel(16);
        let state = ServerState::new("secret-token-123".to_string(), store, tx);

        assert!(state.verify_token("secret-token-123").await);
        assert!(!state.verify_token("wrong-token").await);
    }
}
