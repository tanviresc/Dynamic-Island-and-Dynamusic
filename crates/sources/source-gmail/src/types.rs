use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum CategoryMode {
    #[default]
    Popup,
    QueueOnly,
    Off,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthClientConfig {
    pub client_id: String,
    pub client_secret: String,
}

impl OAuthClientConfig {
    pub fn parse(json_str: &str) -> Result<Self, String> {
        let val: serde_json::Value = serde_json::from_str(json_str).map_err(|e| e.to_string())?;

        let target = if let Some(installed) = val.get("installed") {
            installed
        } else if let Some(web) = val.get("web") {
            web
        } else {
            &val
        };

        let client_id = target
            .get("client_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Missing client_id in OAuth configuration".to_string())?
            .to_string();

        let client_secret = target
            .get("client_secret")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Missing client_secret in OAuth configuration".to_string())?
            .to_string();

        Ok(Self {
            client_id,
            client_secret,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountConfig {
    pub alias: String,
    pub email: String,
    pub history_id: Option<String>,
    pub last_poll_at: Option<i64>,
    pub dry_run: bool,
    pub privacy_mode: bool,
    pub fallback_enabled: bool,
    pub otp_popup_only: bool,
    pub category_modes: HashMap<String, CategoryMode>,
    pub label_map: HashMap<String, String>, // label_id -> label_name
}

impl AccountConfig {
    pub fn new(alias: String, email: String) -> Self {
        Self {
            alias,
            email,
            history_id: None,
            last_poll_at: None,
            dry_run: false,
            privacy_mode: false,
            fallback_enabled: true,
            otp_popup_only: true,
            category_modes: HashMap::new(),
            label_map: HashMap::new(),
        }
    }

    pub fn get_mode(&self, category: &str) -> CategoryMode {
        self.category_modes
            .get(category)
            .copied()
            .unwrap_or(CategoryMode::Popup)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailProfile {
    pub email_address: String,
    pub history_id: String,
    pub messages_total: Option<u64>,
    pub threads_total: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailLabel {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub label_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageHeader {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageMetadata {
    pub id: String,
    pub thread_id: String,
    pub label_ids: Vec<String>,
    pub snippet: Option<String>,
    pub internal_date: Option<String>,
    pub headers: HashMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryMessageAdded {
    pub message: MessageRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryLabelModified {
    pub message: MessageRef,
    pub label_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageRef {
    pub id: String,
    pub thread_id: Option<String>,
    pub label_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRecord {
    pub id: String,
    #[serde(default)]
    pub messages_added: Vec<HistoryMessageAdded>,
    #[serde(default)]
    pub labels_added: Vec<HistoryLabelModified>,
    #[serde(default)]
    pub labels_removed: Vec<HistoryLabelModified>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryResponse {
    pub history: Option<Vec<HistoryRecord>>,
    pub next_page_token: Option<String>,
    pub history_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadSyncOp {
    RemoveUnread { alias: String, message_id: String },
}
