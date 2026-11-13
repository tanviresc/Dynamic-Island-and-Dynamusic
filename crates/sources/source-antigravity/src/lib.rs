use chrono::Utc;
use island_contract::{Event, Kind, Source, Surface, Target};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;
use uuid::Uuid;

pub const STOPPED_DEBOUNCE_MS: u64 = 8000; // 8 seconds debounce per §1.10.3 & §4B.1

#[derive(Debug, Error)]
pub enum AdapterError {
    #[error("Parse error: {0}")]
    Parse(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AgentStatus {
    Running,
    Stopped { reason: Option<String> },
    WaitingForApproval { command: Option<String> },
    Error { message: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentSessionUpdate {
    pub conversation_id: String,
    pub is_subagent: bool,
    pub workspace_path: String,
    pub task_title: Option<String>,
    pub status: AgentStatus,
    pub timestamp_ms: u64,
}

pub trait FormatAdapter: Send + Sync {
    fn parse_event(&self, raw: &str) -> Result<Option<AgentSessionUpdate>, AdapterError>;
}

#[derive(Debug, Clone)]
struct ConversationTrack {
    workspace_path: String,
    task_title: Option<String>,
    current_status: AgentStatus,
    stopped_since: Option<u64>,
    has_emitted_done: bool,
}

#[derive(Default)]
pub struct RunTracker {
    tracks: HashMap<String, ConversationTrack>,
    baseline_sessions: Vec<String>,
}

impl RunTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Mark initial sessions at startup so they don't produce notifications (§4B.1)
    pub fn initialize_baseline(&mut self, session_ids: &[String]) {
        self.baseline_sessions.extend_from_slice(session_ids);
    }

    pub fn handle_update(&mut self, update: AgentSessionUpdate, now: u64) -> Vec<Event> {
        let mut events = Vec::new();

        // Subtask / child agent conversations are ignored per spec §1.10.3 & §4B.1
        if update.is_subagent {
            return events;
        }

        let conv_id = update.conversation_id.clone();

        // Baseline suppression check
        if let Some(pos) = self.baseline_sessions.iter().position(|id| id == &conv_id) {
            self.baseline_sessions.remove(pos);
            // Record track without emitting events
            self.tracks.insert(
                conv_id,
                ConversationTrack {
                    workspace_path: update.workspace_path,
                    task_title: update.task_title,
                    current_status: update.status,
                    stopped_since: None,
                    has_emitted_done: true, // suppressed
                },
            );
            return events;
        }

        let track = self
            .tracks
            .entry(conv_id.clone())
            .or_insert_with(|| ConversationTrack {
                workspace_path: update.workspace_path.clone(),
                task_title: update.task_title.clone(),
                current_status: AgentStatus::Running,
                stopped_since: None,
                has_emitted_done: false,
            });

        track.workspace_path = update.workspace_path;
        if update.task_title.is_some() {
            track.task_title = update.task_title;
        }

        let status_clone = update.status.clone();
        track.current_status = status_clone;

        match update.status {
            AgentStatus::Running => {
                track.stopped_since = None;
                track.has_emitted_done = false;
            }

            AgentStatus::WaitingForApproval { command } => {
                track.stopped_since = None;

                let workspace_name = std::path::Path::new(&track.workspace_path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(&track.workspace_path);

                let text = command
                    .as_deref()
                    .unwrap_or("Action needs approval to proceed");

                let ev = Event {
                    id: Uuid::new_v4(),
                    source: Source::Antigravity,
                    surface: Surface::Ide,
                    kind: Kind::NeedsInput,
                    title: format!("{} · Needs input", workspace_name),
                    text: text.to_string(),
                    category: Some("Needs input".to_string()),
                    account: None,
                    target: Target::Ide {
                        workspace_path: track.workspace_path.clone(),
                        deep_link: Some(format!("antigravity-ide://conversation/{}", conv_id)),
                        window_title_contains: Some(workspace_name.to_string()),
                    },
                    created_at: Utc::now(),
                    dedupe_key: format!("antigravity:{}:approval:{}", conv_id, now),
                };
                events.push(ev);
            }

            AgentStatus::Error { message } => {
                track.stopped_since = None;

                let workspace_name = std::path::Path::new(&track.workspace_path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(&track.workspace_path);

                let ev = Event {
                    id: Uuid::new_v4(),
                    source: Source::Antigravity,
                    surface: Surface::Ide,
                    kind: Kind::Error,
                    title: format!("{} · Failed", workspace_name),
                    text: message,
                    category: Some("Failed".to_string()),
                    account: None,
                    target: Target::Ide {
                        workspace_path: track.workspace_path.clone(),
                        deep_link: Some(format!("antigravity-ide://conversation/{}", conv_id)),
                        window_title_contains: Some(workspace_name.to_string()),
                    },
                    created_at: Utc::now(),
                    dedupe_key: format!("antigravity:{}:error:{}", conv_id, now),
                };
                events.push(ev);
            }

            AgentStatus::Stopped { .. } => {
                if track.stopped_since.is_none() && !track.has_emitted_done {
                    // Start 8-second debounce window
                    track.stopped_since = Some(now);
                }
            }
        }

        events
    }

    pub fn tick(&mut self, now: u64) -> Vec<Event> {
        let mut events = Vec::new();

        for (conv_id, track) in self.tracks.iter_mut() {
            if let Some(since) = track.stopped_since {
                if now.saturating_sub(since) >= STOPPED_DEBOUNCE_MS && !track.has_emitted_done {
                    track.has_emitted_done = true;
                    track.stopped_since = None;

                    let workspace_name = std::path::Path::new(&track.workspace_path)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or(&track.workspace_path);

                    let title_suffix = track.task_title.as_deref().unwrap_or("Task completed");

                    let ev = Event {
                        id: Uuid::new_v4(),
                        source: Source::Antigravity,
                        surface: Surface::Ide,
                        kind: Kind::Done,
                        title: format!("{} · {}", workspace_name, title_suffix),
                        text: "Task completed".to_string(),
                        category: None,
                        account: None,
                        target: Target::Ide {
                            workspace_path: track.workspace_path.clone(),
                            deep_link: Some(format!("antigravity-ide://conversation/{}", conv_id)),
                            window_title_contains: Some(workspace_name.to_string()),
                        },
                        created_at: Utc::now(),
                        dedupe_key: format!("antigravity:{}:done:{}", conv_id, since),
                    };
                    events.push(ev);
                }
            }
        }

        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_subtask_flapping_and_8s_debounce() {
        let mut tracker = RunTracker::new();

        // t=1000: Task starts running
        let u1 = AgentSessionUpdate {
            conversation_id: "conv-main".to_string(),
            is_subagent: false,
            workspace_path: "E:/workspace/island".to_string(),
            task_title: Some("Build auth".to_string()),
            status: AgentStatus::Running,
            timestamp_ms: 1000,
        };
        let ev1 = tracker.handle_update(u1, 1000);
        assert!(ev1.is_empty());

        // t=3000: Subtask ends, status briefly Stopped
        let u2 = AgentSessionUpdate {
            conversation_id: "conv-main".to_string(),
            is_subagent: false,
            workspace_path: "E:/workspace/island".to_string(),
            task_title: Some("Build auth".to_string()),
            status: AgentStatus::Stopped { reason: None },
            timestamp_ms: 3000,
        };
        tracker.handle_update(u2, 3000);

        // t=5000: Flaps back to Running within 2s (<8s)
        let u3 = AgentSessionUpdate {
            conversation_id: "conv-main".to_string(),
            is_subagent: false,
            workspace_path: "E:/workspace/island".to_string(),
            task_title: Some("Build auth".to_string()),
            status: AgentStatus::Running,
            timestamp_ms: 5000,
        };
        tracker.handle_update(u3, 5000);

        // Advance to t=12000: flap cancelled debounce, NO event emitted!
        let tick1 = tracker.tick(12000);
        assert!(tick1.is_empty());

        // t=13000: Truly stops
        let u4 = AgentSessionUpdate {
            conversation_id: "conv-main".to_string(),
            is_subagent: false,
            workspace_path: "E:/workspace/island".to_string(),
            task_title: Some("Build auth".to_string()),
            status: AgentStatus::Stopped { reason: None },
            timestamp_ms: 13000,
        };
        tracker.handle_update(u4, 13000);

        // t=20000 (7s after stop): still debouncing, no event
        assert!(tracker.tick(20000).is_empty());

        // t=21001 (>8s after stop): exactly one Done event emitted!
        let tick2 = tracker.tick(21001);
        assert_eq!(tick2.len(), 1);
        assert_eq!(tick2[0].kind, Kind::Done);
        assert_eq!(tick2[0].title, "island · Build auth");

        // t=30000: further ticks do not emit duplicates
        assert!(tracker.tick(30000).is_empty());
    }

    #[test]
    fn test_child_conversations_ignored() {
        let mut tracker = RunTracker::new();

        // Subagent update (is_subagent = true)
        let subagent_update = AgentSessionUpdate {
            conversation_id: "conv-child-99".to_string(),
            is_subagent: true,
            workspace_path: "E:/workspace/island".to_string(),
            task_title: Some("Research docs".to_string()),
            status: AgentStatus::Stopped { reason: None },
            timestamp_ms: 1000,
        };
        let ev = tracker.handle_update(subagent_update, 1000);
        assert!(ev.is_empty());

        // Tick past 8s: still no event
        let tick = tracker.tick(10000);
        assert!(tick.is_empty());
    }

    #[test]
    fn test_approval_and_error_immediate() {
        let mut tracker = RunTracker::new();

        let app_update = AgentSessionUpdate {
            conversation_id: "conv-main".to_string(),
            is_subagent: false,
            workspace_path: "E:/workspace/island".to_string(),
            task_title: Some("Task 1".to_string()),
            status: AgentStatus::WaitingForApproval {
                command: Some("npm install".to_string()),
            },
            timestamp_ms: 1000,
        };
        let ev = tracker.handle_update(app_update, 1000);
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].kind, Kind::NeedsInput);
        assert_eq!(ev[0].text, "npm install");

        let err_update = AgentSessionUpdate {
            conversation_id: "conv-main".to_string(),
            is_subagent: false,
            workspace_path: "E:/workspace/island".to_string(),
            task_title: Some("Task 1".to_string()),
            status: AgentStatus::Error {
                message: "Build failed".to_string(),
            },
            timestamp_ms: 2000,
        };
        let ev_err = tracker.handle_update(err_update, 2000);
        assert_eq!(ev_err.len(), 1);
        assert_eq!(ev_err[0].kind, Kind::Error);
    }

    #[test]
    fn test_startup_baseline() {
        let mut tracker = RunTracker::new();
        tracker.initialize_baseline(&["conv-existing-1".to_string()]);

        let existing_update = AgentSessionUpdate {
            conversation_id: "conv-existing-1".to_string(),
            is_subagent: false,
            workspace_path: "E:/workspace/island".to_string(),
            task_title: Some("Old task".to_string()),
            status: AgentStatus::Stopped { reason: None },
            timestamp_ms: 1000,
        };
        // Baseline suppression -> no notification
        let ev = tracker.handle_update(existing_update, 1000);
        assert!(ev.is_empty());
        assert!(tracker.tick(10000).is_empty());
    }
}
