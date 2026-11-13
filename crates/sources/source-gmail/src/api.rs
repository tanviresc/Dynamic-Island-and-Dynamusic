use crate::types::{GmailLabel, GmailProfile, HistoryResponse, MessageMetadata};
use async_trait::async_trait;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::RwLock;

#[derive(Debug, Error)]
pub enum GmailApiError {
    #[error("History expired (404)")]
    HistoryExpired,
    #[error("Unauthorized (401)")]
    Unauthorized,
    #[error("Rate limited (429)")]
    RateLimited,
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("API error: {status} - {message}")]
    Api { status: u16, message: String },
}

#[async_trait]
pub trait GmailApi: Send + Sync {
    async fn get_profile(&self, access_token: &str) -> Result<GmailProfile, GmailApiError>;
    async fn list_labels(&self, access_token: &str) -> Result<Vec<GmailLabel>, GmailApiError>;
    async fn list_history(
        &self,
        access_token: &str,
        start_history_id: &str,
    ) -> Result<HistoryResponse, GmailApiError>;
    async fn get_message_metadata(
        &self,
        access_token: &str,
        msg_id: &str,
    ) -> Result<MessageMetadata, GmailApiError>;
}

// Mock Implementation for Tests (§7.1)
#[derive(Default, Clone)]
pub struct MockGmailApi {
    pub profile: Arc<RwLock<Option<GmailProfile>>>,
    pub labels: Arc<RwLock<Vec<GmailLabel>>>,
    pub history: Arc<RwLock<HashMap<String, Result<HistoryResponse, u16>>>>,
    pub messages: Arc<RwLock<HashMap<String, MessageMetadata>>>,
}

impl MockGmailApi {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn set_profile(&self, profile: GmailProfile) {
        let mut p = self.profile.write().await;
        *p = Some(profile);
    }

    pub async fn set_labels(&self, labels: Vec<GmailLabel>) {
        let mut l = self.labels.write().await;
        *l = labels;
    }

    pub async fn add_message(&self, msg: MessageMetadata) {
        let mut m = self.messages.write().await;
        m.insert(msg.id.clone(), msg);
    }

    pub async fn set_history_response(
        &self,
        start_id: &str,
        response: Result<HistoryResponse, u16>,
    ) {
        let mut h = self.history.write().await;
        h.insert(start_id.to_string(), response);
    }
}

#[async_trait]
impl GmailApi for MockGmailApi {
    async fn get_profile(&self, _access_token: &str) -> Result<GmailProfile, GmailApiError> {
        let p = self.profile.read().await;
        p.clone().ok_or(GmailApiError::Api {
            status: 404,
            message: "Profile not found".into(),
        })
    }

    async fn list_labels(&self, _access_token: &str) -> Result<Vec<GmailLabel>, GmailApiError> {
        let l = self.labels.read().await;
        Ok(l.clone())
    }

    async fn list_history(
        &self,
        _access_token: &str,
        start_history_id: &str,
    ) -> Result<HistoryResponse, GmailApiError> {
        let h = self.history.read().await;
        if let Some(res) = h.get(start_history_id) {
            match res {
                Ok(resp) => Ok(resp.clone()),
                Err(404) => Err(GmailApiError::HistoryExpired),
                Err(status) => Err(GmailApiError::Api {
                    status: *status,
                    message: "Mock error".into(),
                }),
            }
        } else {
            Err(GmailApiError::HistoryExpired)
        }
    }

    async fn get_message_metadata(
        &self,
        _access_token: &str,
        msg_id: &str,
    ) -> Result<MessageMetadata, GmailApiError> {
        let m = self.messages.read().await;
        m.get(msg_id).cloned().ok_or(GmailApiError::Api {
            status: 404,
            message: "Message not found".into(),
        })
    }
}

// Live Reqwest Implementation
pub struct ReqwestGmailApi {
    client: reqwest::Client,
    base_url: String,
}

impl Default for ReqwestGmailApi {
    fn default() -> Self {
        Self::new()
    }
}

impl ReqwestGmailApi {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url: "https://gmail.googleapis.com/gmail/v1/users/me".to_string(),
        }
    }
}

#[async_trait]
impl GmailApi for ReqwestGmailApi {
    async fn get_profile(&self, access_token: &str) -> Result<GmailProfile, GmailApiError> {
        let url = format!("{}/profile", self.base_url);
        let res = self
            .client
            .get(&url)
            .bearer_auth(access_token)
            .send()
            .await?;

        if res.status().is_success() {
            let p: GmailProfile = res.json().await?;
            Ok(p)
        } else if res.status() == reqwest::StatusCode::UNAUTHORIZED {
            Err(GmailApiError::Unauthorized)
        } else {
            Err(GmailApiError::Api {
                status: res.status().as_u16(),
                message: res.text().await.unwrap_or_default(),
            })
        }
    }

    async fn list_labels(&self, access_token: &str) -> Result<Vec<GmailLabel>, GmailApiError> {
        #[derive(Deserialize)]
        struct LabelsResponse {
            labels: Option<Vec<GmailLabel>>,
        }

        let url = format!("{}/labels", self.base_url);
        let res = self
            .client
            .get(&url)
            .bearer_auth(access_token)
            .send()
            .await?;

        if res.status().is_success() {
            let r: LabelsResponse = res.json().await?;
            Ok(r.labels.unwrap_or_default())
        } else {
            Err(GmailApiError::Api {
                status: res.status().as_u16(),
                message: res.text().await.unwrap_or_default(),
            })
        }
    }

    async fn list_history(
        &self,
        access_token: &str,
        start_history_id: &str,
    ) -> Result<HistoryResponse, GmailApiError> {
        let url = format!(
            "{}/history?startHistoryId={}&historyTypes=messageAdded&historyTypes=labelAdded&historyTypes=labelRemoved",
            self.base_url, start_history_id
        );
        let res = self
            .client
            .get(&url)
            .bearer_auth(access_token)
            .send()
            .await?;

        if res.status().is_success() {
            let h: HistoryResponse = res.json().await?;
            Ok(h)
        } else if res.status() == reqwest::StatusCode::NOT_FOUND {
            Err(GmailApiError::HistoryExpired)
        } else if res.status() == reqwest::StatusCode::UNAUTHORIZED {
            Err(GmailApiError::Unauthorized)
        } else {
            Err(GmailApiError::Api {
                status: res.status().as_u16(),
                message: res.text().await.unwrap_or_default(),
            })
        }
    }

    async fn get_message_metadata(
        &self,
        access_token: &str,
        msg_id: &str,
    ) -> Result<MessageMetadata, GmailApiError> {
        #[derive(Deserialize)]
        struct RawMessagePayload {
            headers: Option<Vec<crate::types::MessageHeader>>,
        }

        #[derive(Deserialize)]
        struct RawMessage {
            id: String,
            #[serde(rename = "threadId")]
            thread_id: String,
            #[serde(rename = "labelIds")]
            label_ids: Option<Vec<String>>,
            snippet: Option<String>,
            #[serde(rename = "internalDate")]
            internal_date: Option<String>,
            payload: Option<RawMessagePayload>,
        }

        let url = format!(
            "{}/messages/{}?format=metadata&metadataHeaders=From&metadataHeaders=Subject",
            self.base_url, msg_id
        );
        let res = self
            .client
            .get(&url)
            .bearer_auth(access_token)
            .send()
            .await?;

        if res.status().is_success() {
            let raw: RawMessage = res.json().await?;
            let mut headers = HashMap::new();
            if let Some(p) = raw.payload {
                if let Some(h_list) = p.headers {
                    for h in h_list {
                        headers.insert(h.name.to_lowercase(), h.value);
                    }
                }
            }

            Ok(MessageMetadata {
                id: raw.id,
                thread_id: raw.thread_id,
                label_ids: raw.label_ids.unwrap_or_default(),
                snippet: raw.snippet,
                internal_date: raw.internal_date,
                headers,
            })
        } else {
            Err(GmailApiError::Api {
                status: res.status().as_u16(),
                message: res.text().await.unwrap_or_default(),
            })
        }
    }
}
