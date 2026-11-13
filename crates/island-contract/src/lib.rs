use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_event_serde() {
        let json = r#"{
            "id": "6f1c2a9e-3b7d-4e21-9a55-0c8f4d2b7e10",
            "source": "claude",
            "surface": "web",
            "kind": "done",
            "title": "Claude finished",
            "text": "Refactor plan for auth module",
            "target": { "type": "browserTab", "tabId": 1834, "windowId": 1790, "url": "https://claude.ai" },
            "createdAt": "2026-11-13T11:42:06Z",
            "dedupeKey": "claude:web:tab1834-gen7:done"
        }"#;

        let ev: Event = serde_json::from_str(json).expect("valid event");
        assert_eq!(ev.source, Source::Claude);
        assert_eq!(ev.kind, Kind::Done);
    }
}
