use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use thiserror::Error;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[derive(Debug, Error)]
pub enum OAuthError {
    #[error("Failed to generate random bytes")]
    CryptoError,
    #[error("OAuth state mismatch")]
    StateMismatch,
    #[error("Missing authorization code")]
    MissingCode,
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Token error: {0}")]
    TokenError(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PkcePair {
    pub verifier: String,
    pub challenge: String,
}

pub fn generate_pkce_pair() -> PkcePair {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let verifier = URL_SAFE_NO_PAD.encode(bytes);

    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let hash = hasher.finalize();
    let challenge = URL_SAFE_NO_PAD.encode(hash);

    PkcePair {
        verifier,
        challenge,
    }
}

pub fn generate_state() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn build_authorization_url(
    client_id: &str,
    redirect_uri: &str,
    state: &str,
    challenge: &str,
) -> String {
    format!(
        "https://accounts.google.com/o/oauth2/v2/auth?\
        client_id={}&\
        redirect_uri={}&\
        response_type=code&\
        scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.metadata&\
        state={}&\
        code_challenge={}&\
        code_challenge_method=S256&\
        access_type=offline&\
        prompt=consent",
        urlencoding(client_id),
        urlencoding(redirect_uri),
        urlencoding(state),
        urlencoding(challenge)
    )
}

fn urlencoding(input: &str) -> String {
    input
        .chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            _ => format!("%{:02X}", c as u8),
        })
        .collect()
}

#[derive(Debug, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub token_type: String,
    pub expires_in: u64,
    pub refresh_token: Option<String>,
    pub scope: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenErrorResponse {
    error: String,
    error_description: Option<String>,
}

pub async fn exchange_code_for_tokens(
    client: &reqwest::Client,
    client_id: &str,
    client_secret: &str,
    code: &str,
    code_verifier: &str,
    redirect_uri: &str,
) -> Result<TokenResponse, OAuthError> {
    let params = [
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("code", code),
        ("code_verifier", code_verifier),
        ("redirect_uri", redirect_uri),
        ("grant_type", "authorization_code"),
    ];

    let body =
        serde_urlencoded::to_string(params).map_err(|e| OAuthError::TokenError(e.to_string()))?;

    let res = client
        .post("https://oauth2.googleapis.com/token")
        .header("content-type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await?;

    if res.status().is_success() {
        let tokens: TokenResponse = res.json().await?;
        Ok(tokens)
    } else {
        let err_body = res.text().await.unwrap_or_default();
        if let Ok(parsed) = serde_json::from_str::<TokenErrorResponse>(&err_body) {
            Err(OAuthError::TokenError(format!(
                "{}: {}",
                parsed.error,
                parsed.error_description.unwrap_or_default()
            )))
        } else {
            Err(OAuthError::TokenError(err_body))
        }
    }
}

pub async fn refresh_access_token(
    client: &reqwest::Client,
    client_id: &str,
    client_secret: &str,
    refresh_token: &str,
) -> Result<TokenResponse, OAuthError> {
    let params = [
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
    ];

    let body =
        serde_urlencoded::to_string(params).map_err(|e| OAuthError::TokenError(e.to_string()))?;

    let res = client
        .post("https://oauth2.googleapis.com/token")
        .header("content-type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await?;

    if res.status().is_success() {
        let tokens: TokenResponse = res.json().await?;
        Ok(tokens)
    } else {
        let err_body = res.text().await.unwrap_or_default();
        Err(OAuthError::TokenError(err_body))
    }
}

pub async fn listen_for_oauth_callback(
    listener: tokio::net::TcpListener,
    expected_state: &str,
) -> Result<String, OAuthError> {
    let (mut socket, _) = listener.accept().await.map_err(OAuthError::Io)?;
    let mut buf = [0u8; 4096];
    let n = socket.read(&mut buf).await.map_err(OAuthError::Io)?;
    let req = String::from_utf8_lossy(&buf[..n]);

    let first_line = req.lines().next().unwrap_or("");
    let path = first_line.split_whitespace().nth(1).unwrap_or("");

    let query = path.split('?').nth(1).unwrap_or("");
    let mut code = None;
    let mut state = None;
    for pair in query.split('&') {
        let mut parts = pair.split('=');
        if let (Some(k), Some(v)) = (parts.next(), parts.next()) {
            if k == "code" {
                code = Some(v.to_string());
            } else if k == "state" {
                state = Some(v.to_string());
            }
        }
    }

    let html = "<!DOCTYPE html><html><body style=\"font-family:sans-serif;text-align:center;padding:50px;\"><h2>Authentication complete!</h2><p>You can close this tab and return to Island.</p></body></html>";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        html.len(),
        html
    );
    let _ = socket.write_all(response.as_bytes()).await;
    let _ = socket.flush().await;

    if state.as_deref() != Some(expected_state) {
        return Err(OAuthError::StateMismatch);
    }
    code.ok_or(OAuthError::MissingCode)
}
