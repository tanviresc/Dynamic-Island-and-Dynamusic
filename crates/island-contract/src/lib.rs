use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Claude,
    Chatgpt,
    Gemini,
    Antigravity,
    Gmail,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Surface {
    Web,
    Desktop,
    Ide,
    Background,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Done,
    NeedsInput,
    Error,
    NewMail,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Target {
    BrowserTab {
        #[serde(rename = "tabId")]
        tab_id: u32,
        #[serde(rename = "windowId")]
        window_id: u32,
        url: Option<String>,
    },
    Process {
        #[serde(rename = "processNames")]
        process_names: Vec<String>,
        #[serde(rename = "windowTitleContains")]
        window_title_contains: Option<String>,
    },
    Ide {
        #[serde(rename = "workspacePath")]
        workspace_path: String,
        #[serde(rename = "deepLink")]
        deep_link: Option<String>,
        #[serde(rename = "windowTitleContains")]
        window_title_contains: Option<String>,
    },
    Url {
        url: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Event {
    pub id: Uuid,
    pub source: Source,
    pub surface: Surface,
    pub kind: Kind,
    pub title: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
    pub target: Target,
    #[serde(rename = "createdAt")]
    pub created_at: DateTime<Utc>,
    #[serde(rename = "dedupeKey")]
    pub dedupe_key: String,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ValidationError {
    #[error("Source and surface mismatch: {0:?} cannot run on {1:?}")]
    InvalidSourceSurface(Source, Surface),
    #[error("Kind {0:?} is not permitted for source {1:?}")]
    InvalidKindForSource(Kind, Source),
    #[error("Target type does not match surface: {0:?}")]
    TargetSurfaceMismatch(Surface),
    #[error("Field '{0}' exceeded max length: {1}")]
    FieldTooLong(&'static str, usize),
    #[error("Field '{0}' cannot be empty")]
    FieldEmpty(&'static str),
    #[error("Invalid character in field '{0}'")]
    InvalidCharacters(&'static str),
    #[error("Timestamp is outside permitted window: {0}")]
    TimestampOutOfRange(String),
    #[error("URL host is not on allowlist: {0}")]
    DisallowedUrlHost(String),
    #[error("Deep link scheme is not on allowlist: {0}")]
    DisallowedDeepLinkScheme(String),
    #[error("Account alias is required for Gmail")]
    MissingAccount,
}

const ALLOWED_URL_HOSTS: &[&str] = &[
    "claude.ai",
    "chatgpt.com",
    "gemini.google.com",
    "mail.google.com",
];

const ALLOWED_DEEP_LINK_SCHEMES: &[&str] = &["antigravity-ide"];

impl Event {
    pub fn normalize_and_validate(&mut self, now: DateTime<Utc>) -> Result<(), ValidationError> {
        // 1. Source / Surface matrix validation
        match (self.source, self.surface) {
            (
                Source::Claude | Source::Chatgpt | Source::Gemini,
                Surface::Web | Surface::Desktop,
            ) => {}
            (Source::Antigravity, Surface::Ide) => {}
            (Source::Gmail, Surface::Background) => {}
            _ => {
                return Err(ValidationError::InvalidSourceSurface(
                    self.source,
                    self.surface,
                ))
            }
        }

        // 2. Kind validation
        if self.source == Source::Gmail {
            if self.kind != Kind::NewMail && self.kind != Kind::NeedsInput {
                return Err(ValidationError::InvalidKindForSource(
                    self.kind,
                    self.source,
                ));
            }
            if self.account.is_none() || self.account.as_deref().unwrap_or("").trim().is_empty() {
                return Err(ValidationError::MissingAccount);
            }
        } else if self.kind == Kind::NewMail {
            return Err(ValidationError::InvalidKindForSource(
                self.kind,
                self.source,
            ));
        }

        // 3. Target matching surface
        match (&self.target, self.surface) {
            (Target::BrowserTab { url, .. }, Surface::Web) => {
                if let Some(u) = url {
                    Self::validate_url(u)?;
                }
            }
            (Target::Process { process_names, .. }, Surface::Desktop) => {
                if process_names.is_empty() || process_names.len() > 4 {
                    return Err(ValidationError::InvalidCharacters("processNames"));
                }
                for name in process_names {
                    if !name.ends_with(".exe") || name.len() > 64 {
                        return Err(ValidationError::InvalidCharacters("processNames"));
                    }
                }
            }
            (Target::Ide { deep_link, .. }, Surface::Ide) => {
                if let Some(dl) = deep_link {
                    Self::validate_deep_link(dl)?;
                }
            }
            (Target::Url { url }, Surface::Background) => {
                Self::validate_url(url)?;
            }
            _ => return Err(ValidationError::TargetSurfaceMismatch(self.surface)),
        }

        // 4. Normalization & Length checks
        self.title = self.title.trim().to_string();
        if self.title.is_empty() {
            return Err(ValidationError::FieldEmpty("title"));
        }
        if self.title.chars().count() > 120 {
            return Err(ValidationError::FieldTooLong("title", 120));
        }

        self.text = self.text.trim().to_string();
        if self.text.chars().count() > 500 {
            return Err(ValidationError::FieldTooLong("text", 500));
        }

        if let Some(cat) = &self.category {
            let cat_trim = cat.trim();
            if cat_trim.is_empty() {
                self.category = None;
            } else if cat_trim.chars().count() > 32 {
                return Err(ValidationError::FieldTooLong("category", 32));
            } else {
                self.category = Some(cat_trim.to_string());
            }
        }

        if let Some(acc) = &self.account {
            let acc_trim = acc.trim();
            if acc_trim.chars().count() > 64 {
                return Err(ValidationError::FieldTooLong("account", 64));
            }
            self.account = Some(acc_trim.to_string());
        }

        // Dedupe key checks
        let dedupe = self.dedupe_key.trim();
        if dedupe.is_empty() {
            return Err(ValidationError::FieldEmpty("dedupeKey"));
        }
        if dedupe.len() > 200 || !dedupe.is_ascii() {
            return Err(ValidationError::InvalidCharacters("dedupeKey"));
        }
        self.dedupe_key = dedupe.to_string();

        // 5. Timestamp window check (-24 hours, +5 minutes)
        let past_limit = now - Duration::hours(24);
        let future_limit = now + Duration::minutes(5);
        if self.created_at < past_limit || self.created_at > future_limit {
            return Err(ValidationError::TimestampOutOfRange(
                self.created_at.to_rfc3339(),
            ));
        }

        Ok(())
    }

    fn validate_url(url_str: &str) -> Result<(), ValidationError> {
        let trimmed = url_str.trim();
        if !trimmed.starts_with("https://") {
            return Err(ValidationError::DisallowedUrlHost(url_str.to_string()));
        }
        let after_scheme = &trimmed["https://".len()..];
        let host = after_scheme
            .split(&['/', '?', '#'][..])
            .next()
            .unwrap_or("");
        if !ALLOWED_URL_HOSTS.contains(&host) {
            return Err(ValidationError::DisallowedUrlHost(host.to_string()));
        }
        Ok(())
    }

    fn validate_deep_link(link_str: &str) -> Result<(), ValidationError> {
        let trimmed = link_str.trim();
        let scheme = trimmed.split(':').next().unwrap_or("");
        if !ALLOWED_DEEP_LINK_SCHEMES.contains(&scheme) {
            return Err(ValidationError::DisallowedDeepLinkScheme(
                scheme.to_string(),
            ));
        }
        Ok(())
    }
}

// WebSocket Envelope Types (v1)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum WsClientMessage {
    Hello {
        token: String,
        client: String,
        #[serde(rename = "clientVersion")]
        client_version: String,
        browser: Option<String>,
    },
    Event {
        event: Event,
    },
    Focus {
        #[serde(rename = "windowFocused")]
        window_focused: bool,
        #[serde(rename = "windowId")]
        window_id: Option<u32>,
        #[serde(rename = "tabId")]
        tab_id: Option<u32>,
        site: Option<String>,
    },
    CommandResult {
        #[serde(rename = "requestId")]
        request_id: String,
        ok: bool,
        error: Option<String>,
    },
    Ping {
        t: u64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum WsServerMessage {
    Welcome {
        #[serde(rename = "serverVersion")]
        server_version: String,
        #[serde(rename = "appName")]
        app_name: String,
    },
    Ack {
        id: Uuid,
        status: String, // accepted | duplicate | skipped | rejected
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    Command {
        #[serde(rename = "requestId")]
        request_id: String,
        command: String,
        #[serde(rename = "tabId")]
        tab_id: u32,
        #[serde(rename = "windowId")]
        window_id: u32,
    },
    Pong {
        t: u64,
    },
    Error {
        code: u16,
        reason: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_example_1_claude_web() {
        let json = r#"{
            "id": "6f1c2a9e-3b7d-4e21-9a55-0c8f4d2b7e10",
            "source": "claude",
            "surface": "web",
            "kind": "done",
            "title": "Claude finished",
            "text": "Refactor plan for auth module",
            "target": { "type": "browserTab", "tabId": 1834, "windowId": 1790, "url": "https://claude.ai/chat/00000000-0000-0000-0000-000000000000" },
            "createdAt": "2026-11-13T11:42:06Z",
            "dedupeKey": "claude:web:tab1834-gen7:done"
        }"#;

        let mut ev: Event = serde_json::from_str(json).expect("deserialize example 1");
        let now = DateTime::parse_from_rfc3339("2026-11-13T11:43:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert!(ev.normalize_and_validate(now).is_ok());
    }

    #[test]
    fn test_example_2_antigravity_ide() {
        let json = r#"{
            "id": "0b9e4c3d-8f6a-4a1b-b2c7-5d6e7f8a9b0c",
            "source": "antigravity",
            "surface": "ide",
            "kind": "needs_input",
            "title": "dynamic island · Build the settings page",
            "text": "Waiting for approval: npm run build",
            "category": "Needs input",
            "target": { "type": "ide", "workspacePath": "E:\\dynamic island", "deepLink": "antigravity-ide://file/E:/dynamic%20island", "windowTitleContains": "dynamic island" },
            "createdAt": "2026-11-13T11:45:30Z",
            "dedupeKey": "antigravity:ide:conv-3f2a:step-41:needs_input"
        }"#;

        let mut ev: Event = serde_json::from_str(json).expect("deserialize example 2");
        let now = DateTime::parse_from_rfc3339("2026-11-13T11:46:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert!(ev.normalize_and_validate(now).is_ok());
    }

    #[test]
    fn test_example_3_gmail_security() {
        let json = r#"{
            "id": "c4d5e6f7-a8b9-4c0d-9e1f-2a3b4c5d6e7f",
            "source": "gmail",
            "surface": "background",
            "kind": "new_mail",
            "title": "security-noreply@example.com",
            "text": "New sign-in to your account",
            "category": "Security",
            "account": "personal",
            "target": { "type": "url", "url": "https://mail.google.com/mail/u/?authuser=me%40example.com#all/18c2f0a1b2c3d4e5" },
            "createdAt": "2026-11-13T11:50:02Z",
            "dedupeKey": "gmail:personal:18c2f0a1b2c3d4e5"
        }"#;

        let mut ev: Event = serde_json::from_str(json).expect("deserialize example 3");
        let now = DateTime::parse_from_rfc3339("2026-11-13T11:51:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert!(ev.normalize_and_validate(now).is_ok());
    }

    #[test]
    fn test_invalid_source_surface() {
        let json = r#"{
            "id": "c4d5e6f7-a8b9-4c0d-9e1f-2a3b4c5d6e7f",
            "source": "gmail",
            "surface": "web",
            "kind": "new_mail",
            "title": "test",
            "text": "test",
            "account": "personal",
            "target": { "type": "browserTab", "tabId": 1, "windowId": 1 },
            "createdAt": "2026-11-13T11:50:02Z",
            "dedupeKey": "test"
        }"#;

        let mut ev: Event = serde_json::from_str(json).expect("deserialize");
        let now = DateTime::parse_from_rfc3339("2026-11-13T11:51:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert!(matches!(
            ev.normalize_and_validate(now),
            Err(ValidationError::InvalidSourceSurface(..))
        ));
    }

    #[test]
    fn test_disallowed_url_host() {
        let json = r#"{
            "id": "c4d5e6f7-a8b9-4c0d-9e1f-2a3b4c5d6e7f",
            "source": "claude",
            "surface": "web",
            "kind": "done",
            "title": "test",
            "text": "test",
            "target": { "type": "browserTab", "tabId": 1, "windowId": 1, "url": "https://malicious-site.com" },
            "createdAt": "2026-11-13T11:50:02Z",
            "dedupeKey": "test"
        }"#;

        let mut ev: Event = serde_json::from_str(json).expect("deserialize");
        let now = DateTime::parse_from_rfc3339("2026-11-13T11:51:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert!(matches!(
            ev.normalize_and_validate(now),
            Err(ValidationError::DisallowedUrlHost(..))
        ));
    }
}
