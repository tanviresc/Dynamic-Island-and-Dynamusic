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

#[derive(Debug, Deserialize)]
struct TranscriptStep {
    #[serde(rename = "type")]
    step_type: Option<String>,
    status: Option<String>,
    tool_calls: Option<Vec<serde_json::Value>>,
}

pub fn parse_last_transcript_line(path: &std::path::Path) -> Option<AgentStatus> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    if len == 0 {
        return None;
    }
    let read_len = len.min(8192);
    file.seek(SeekFrom::End(-(read_len as i64))).ok()?;
    let mut buf = vec![0u8; read_len as usize];
    file.read_exact(&mut buf).ok()?;
    let content = String::from_utf8_lossy(&buf);
    let last_line = content.lines().rev().find(|l| !l.trim().is_empty())?;

    let step: TranscriptStep = serde_json::from_str(last_line).ok()?;
    match step.step_type.as_deref() {
        Some("USER_INPUT") => Some(AgentStatus::Running),
        Some("PLANNER_RESPONSE") => {
            let tools = step.tool_calls.unwrap_or_default();
            if tools
                .iter()
                .any(|t| t.get("name").and_then(|n| n.as_str()) == Some("ask_question"))
            {
                Some(AgentStatus::WaitingForApproval {
                    command: Some("Question asked".to_string()),
                })
            } else if !tools.is_empty() {
                Some(AgentStatus::Running)
            } else if step.status.as_deref() == Some("ERROR") {
                Some(AgentStatus::Error {
                    message: "Task error".to_string(),
                })
            } else {
                Some(AgentStatus::Stopped { reason: None })
            }
        }
        _ => None,
    }
}

pub fn start_antigravity_watcher(
    event_tx: tokio::sync::mpsc::Sender<Event>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut tracker = RunTracker::new();

        // Baseline suppression: detect existing transcripts at startup (§4B.1)
        if let Ok(home) = std::env::var("USERPROFILE") {
            let brain_dir = std::path::PathBuf::from(home)
                .join(".gemini")
                .join("antigravity")
                .join("brain");
            if let Ok(entries) = std::fs::read_dir(&brain_dir) {
                let baseline_ids: Vec<String> = entries
                    .filter_map(|e| e.ok())
                    .filter_map(|e| e.file_name().into_string().ok())
                    .collect();
                tracker.initialize_baseline(&baseline_ids);
            }
        }

        let mut ticker = tokio::time::interval(std::time::Duration::from_millis(1000));
        let mut last_modified_map: HashMap<String, std::time::SystemTime> = HashMap::new();

        loop {
            ticker.tick().await;
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;

            if let Ok(home) = std::env::var("USERPROFILE") {
                let brain_dir = std::path::PathBuf::from(home)
                    .join(".gemini")
                    .join("antigravity")
                    .join("brain");

                if let Ok(entries) = std::fs::read_dir(&brain_dir) {
                    for entry in entries.flatten() {
                        let conv_id = entry.file_name().to_string_lossy().to_string();
                        let transcript_path = entry
                            .path()
                            .join(".system_generated")
                            .join("logs")
                            .join("transcript.jsonl");

                        if let Ok(meta) = std::fs::metadata(&transcript_path) {
                            if let Ok(mtime) = meta.modified() {
                                let prev = last_modified_map.get(&conv_id);
                                if prev.is_none() || prev != Some(&mtime) {
                                    last_modified_map.insert(conv_id.clone(), mtime);

                                    if let Some(status) =
                                        parse_last_transcript_line(&transcript_path)
                                    {
                                        let update = AgentSessionUpdate {
                                            conversation_id: conv_id.clone(),
                                            is_subagent: false,
                                            workspace_path: "Antigravity".to_string(),
                                            task_title: None,
                                            status,
                                            timestamp_ms: now,
                                        };
                                        let immediate_events = tracker.handle_update(update, now);
                                        for ev in immediate_events {
                                            let _ = event_tx.send(ev).await;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Tick for 8-second debounce completion (§1.10.3)
            let ready_events = tracker.tick(now);
            for ev in ready_events {
                let _ = event_tx.send(ev).await;
            }
        }
    })
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

    #[test]
    fn test_parse_last_transcript_line() {
        use std::io::Write;
        let temp_dir = std::env::temp_dir().join(format!("test_ag_{}", uuid::Uuid::new_v4()));
        let _ = std::fs::create_dir_all(&temp_dir);
        let log_file = temp_dir.join("transcript.jsonl");

        // 1. User input
        let mut f = std::fs::File::create(&log_file).unwrap();
        writeln!(f, r#"{{"type":"USER_INPUT","status":"DONE"}}"#).unwrap();
        drop(f);
        assert_eq!(
            parse_last_transcript_line(&log_file),
            Some(AgentStatus::Running)
        );

        // 2. Planner response calling tools
        let mut f = std::fs::OpenOptions::new()
            .append(true)
            .open(&log_file)
            .unwrap();
        writeln!(
            f,
            r#"{{"type":"PLANNER_RESPONSE","status":"DONE","tool_calls":[{{"name":"run_command"}}]}}"#
        )
        .unwrap();
        drop(f);
        assert_eq!(
            parse_last_transcript_line(&log_file),
            Some(AgentStatus::Running)
        );

        // 3. Planner response calling ask_question
        let mut f = std::fs::OpenOptions::new()
            .append(true)
            .open(&log_file)
            .unwrap();
        writeln!(
            f,
            r#"{{"type":"PLANNER_RESPONSE","status":"DONE","tool_calls":[{{"name":"ask_question"}}]}}"#
        )
        .unwrap();
        drop(f);
        assert!(matches!(
            parse_last_transcript_line(&log_file),
            Some(AgentStatus::WaitingForApproval { .. })
        ));

        // 4. Planner response completing task with no tools
        let mut f = std::fs::OpenOptions::new()
            .append(true)
            .open(&log_file)
            .unwrap();
        writeln!(
            f,
            r#"{{"type":"PLANNER_RESPONSE","status":"DONE","tool_calls":[]}}"#
        )
        .unwrap();
        drop(f);
        assert_eq!(
            parse_last_transcript_line(&log_file),
            Some(AgentStatus::Stopped { reason: None })
        );

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
