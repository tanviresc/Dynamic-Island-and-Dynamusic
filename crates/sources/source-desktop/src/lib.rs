use chrono::{DateTime, Utc};
use island_contract::{Event, Kind, Source, Surface, Target};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum DesktopSourceError {
    #[error("Invalid app config: {0}")]
    InvalidConfig(String),
    #[error("Process names must end with .exe: {0}")]
    InvalidProcessName(String),
    #[error("Too many process names for app (max 4): {0}")]
    TooManyProcesses(usize),
    #[error("Source not supported for desktop: {0:?}")]
    UnsupportedSource(Source),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DetectionMode {
    Toast,
    Uia,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAppConfig {
    pub id: String,
    pub display_name: String,
    pub source: Source,
    pub process_names: Vec<String>,
    pub enabled: bool,
    pub detection: DetectionMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_title_contains: Option<String>,
}

impl DesktopAppConfig {
    pub fn validate(&self) -> Result<(), DesktopSourceError> {
        let id_trimmed = self.id.trim();
        if id_trimmed.is_empty() {
            return Err(DesktopSourceError::InvalidConfig(
                "App ID cannot be empty".into(),
            ));
        }

        match self.source {
            Source::Claude | Source::Chatgpt | Source::Gemini => {}
            _ => return Err(DesktopSourceError::UnsupportedSource(self.source)),
        }

        if self.process_names.is_empty() {
            return Err(DesktopSourceError::InvalidConfig(
                "Must have at least one process name".into(),
            ));
        }

        if self.process_names.len() > 4 {
            return Err(DesktopSourceError::TooManyProcesses(
                self.process_names.len(),
            ));
        }

        for proc in &self.process_names {
            let p_lower = proc.to_lowercase();
            if !p_lower.ends_with(".exe") || p_lower.len() > 64 {
                return Err(DesktopSourceError::InvalidProcessName(proc.clone()));
            }
        }

        Ok(())
    }

    pub fn matches_process(&self, process_name: &str) -> bool {
        let name_lower = process_name.to_lowercase();
        self.process_names
            .iter()
            .any(|p| p.to_lowercase() == name_lower || name_lower.starts_with(&p.to_lowercase()))
    }
}

pub fn default_desktop_apps() -> Vec<DesktopAppConfig> {
    vec![
        DesktopAppConfig {
            id: "claude-desktop".to_string(),
            display_name: "Claude".to_string(),
            source: Source::Claude,
            process_names: vec!["claude.exe".to_string()],
            enabled: true,
            detection: DetectionMode::Uia,
            window_title_contains: None,
        },
        DesktopAppConfig {
            id: "chatgpt-desktop".to_string(),
            display_name: "ChatGPT".to_string(),
            source: Source::Chatgpt,
            process_names: vec!["chatgpt.exe".to_string(), "openai.exe".to_string()],
            enabled: false,
            detection: DetectionMode::Uia,
            window_title_contains: None,
        },
        DesktopAppConfig {
            id: "gemini-desktop".to_string(),
            display_name: "Gemini".to_string(),
            source: Source::Gemini,
            process_names: vec!["gemini.exe".to_string()],
            enabled: false,
            detection: DetectionMode::Uia,
            window_title_contains: None,
        },
    ]
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToastMetadata {
    pub app_id: String,
    pub title: String,
    pub body: String,
    pub timestamp: DateTime<Utc>,
}

pub struct ToastProcessor {
    apps: Vec<DesktopAppConfig>,
}

impl ToastProcessor {
    pub fn new(apps: Vec<DesktopAppConfig>) -> Self {
        Self { apps }
    }

    pub fn process_toast(&self, toast: &ToastMetadata) -> Option<Event> {
        let app = self.apps.iter().find(|a| {
            if !a.enabled {
                return false;
            }
            let id_match = toast
                .app_id
                .to_lowercase()
                .contains(&a.source.to_string().to_lowercase())
                || toast.app_id.to_lowercase().contains(&a.id.to_lowercase());
            let title_match = toast
                .title
                .to_lowercase()
                .contains(&a.display_name.to_lowercase());
            id_match || title_match
        })?;

        let body_lower = toast.body.to_lowercase();
        let is_needs_input = body_lower.contains("approval")
            || body_lower.contains("permission")
            || body_lower.contains("confirm")
            || body_lower.contains("question");

        let kind = if is_needs_input {
            Kind::NeedsInput
        } else {
            Kind::Done
        };

        let title = format!(
            "{} · {}",
            app.display_name,
            if is_needs_input {
                "Needs input"
            } else {
                "Task completed"
            }
        );

        let dedupe_key = format!(
            "desktop:{}:{}:{}",
            app.source,
            kind,
            toast.timestamp.timestamp_millis()
        );

        Some(Event {
            id: Uuid::new_v4(),
            source: app.source,
            surface: Surface::Desktop,
            kind,
            title,
            text: if toast.body.is_empty() {
                "Response ready".to_string()
            } else {
                toast.body.clone()
            },
            category: if is_needs_input {
                Some("Needs input".to_string())
            } else {
                None
            },
            account: None,
            target: Target::Process {
                process_names: app.process_names.clone(),
                window_title_contains: app.window_title_contains.clone(),
            },
            created_at: toast.timestamp,
            dedupe_key,
        })
    }
}

// UIA Signal State Machine for desktop UI observation
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UiaState {
    Idle,
    Generating,
    Settling { started_at: u64 },
}

pub struct UiaSignalDetector {
    app: DesktopAppConfig,
    state: UiaState,
    generation_start_time: Option<u64>,
    settling_debounce_ms: u64,
    min_generation_duration_ms: u64,
    gen_counter: u64,
    seen_prompt_instances: Vec<String>,
}

impl UiaSignalDetector {
    pub fn new(app: DesktopAppConfig) -> Self {
        Self {
            app,
            state: UiaState::Idle,
            generation_start_time: None,
            settling_debounce_ms: 1500,
            min_generation_duration_ms: 800,
            gen_counter: 0,
            seen_prompt_instances: Vec::new(),
        }
    }

    pub fn state(&self) -> UiaState {
        self.state
    }

    pub fn tick(
        &mut self,
        is_generating: bool,
        needs_input_prompt: Option<String>,
        now: u64,
    ) -> Option<Event> {
        // 1. Check needs_input prompt
        if let Some(prompt_id) = needs_input_prompt {
            if !self.seen_prompt_instances.contains(&prompt_id) {
                self.seen_prompt_instances.push(prompt_id.clone());

                let ev = Event {
                    id: Uuid::new_v4(),
                    source: self.app.source,
                    surface: Surface::Desktop,
                    kind: Kind::NeedsInput,
                    title: format!("{} · Needs input", self.app.display_name),
                    text: "Action needs confirmation".to_string(),
                    category: Some("Needs input".to_string()),
                    account: None,
                    target: Target::Process {
                        process_names: self.app.process_names.clone(),
                        window_title_contains: self.app.window_title_contains.clone(),
                    },
                    created_at: Utc::now(),
                    dedupe_key: format!("desktop:{}:prompt:{}", self.app.source, prompt_id),
                };
                return Some(ev);
            }
        }

        // 2. State machine transitions for generation
        match self.state {
            UiaState::Idle => {
                if is_generating {
                    self.state = UiaState::Generating;
                    self.generation_start_time = Some(now);
                    self.gen_counter += 1;
                }
                None
            }
            UiaState::Generating => {
                if !is_generating {
                    self.state = UiaState::Settling { started_at: now };
                }
                None
            }
            UiaState::Settling { started_at } => {
                if is_generating {
                    // Resumed: cancel settling debounce
                    self.state = UiaState::Generating;
                    None
                } else if now.saturating_sub(started_at) >= self.settling_debounce_ms {
                    self.state = UiaState::Idle;
                    let gen_duration =
                        started_at.saturating_sub(self.generation_start_time.unwrap_or(started_at));

                    if gen_duration >= self.min_generation_duration_ms {
                        let ev = Event {
                            id: Uuid::new_v4(),
                            source: self.app.source,
                            surface: Surface::Desktop,
                            kind: Kind::Done,
                            title: format!("{} finished", self.app.display_name),
                            text: "Response ready".to_string(),
                            category: None,
                            account: None,
                            target: Target::Process {
                                process_names: self.app.process_names.clone(),
                                window_title_contains: self.app.window_title_contains.clone(),
                            },
                            created_at: Utc::now(),
                            dedupe_key: format!(
                                "desktop:{}:gen{}:done",
                                self.app.source, self.gen_counter
                            ),
                        };
                        Some(ev)
                    } else {
                        None
                    }
                } else {
                    None
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_desktop_app_config_validation() {
        let valid = DesktopAppConfig {
            id: "claude-app".into(),
            display_name: "Claude".into(),
            source: Source::Claude,
            process_names: vec!["claude.exe".into()],
            enabled: true,
            detection: DetectionMode::Uia,
            window_title_contains: None,
        };
        assert!(valid.validate().is_ok());

        let empty_id = DesktopAppConfig {
            id: "".into(),
            ..valid.clone()
        };
        assert!(empty_id.validate().is_err());

        let non_exe = DesktopAppConfig {
            process_names: vec!["claude".into()],
            ..valid.clone()
        };
        assert!(matches!(
            non_exe.validate(),
            Err(DesktopSourceError::InvalidProcessName(_))
        ));

        let too_many = DesktopAppConfig {
            process_names: vec![
                "p1.exe".into(),
                "p2.exe".into(),
                "p3.exe".into(),
                "p4.exe".into(),
                "p5.exe".into(),
            ],
            ..valid.clone()
        };
        assert!(matches!(
            too_many.validate(),
            Err(DesktopSourceError::TooManyProcesses(5))
        ));
    }

    #[test]
    fn test_toast_processor_mapping() {
        let apps = default_desktop_apps();
        let processor = ToastProcessor::new(apps);

        // Done toast
        let toast = ToastMetadata {
            app_id: "Anthropic.Claude".into(),
            title: "Claude".into(),
            body: "Finished code refactoring".into(),
            timestamp: Utc::now(),
        };

        let event = processor.process_toast(&toast).expect("event created");
        assert_eq!(event.source, Source::Claude);
        assert_eq!(event.surface, Surface::Desktop);
        assert_eq!(event.kind, Kind::Done);

        // Needs input toast
        let approval_toast = ToastMetadata {
            app_id: "Anthropic.Claude".into(),
            title: "Claude".into(),
            body: "Terminal execution needs permission".into(),
            timestamp: Utc::now(),
        };
        let app_event = processor
            .process_toast(&approval_toast)
            .expect("event created");
        assert_eq!(app_event.kind, Kind::NeedsInput);
    }

    #[test]
    fn test_uia_detector_state_machine() {
        let app = default_desktop_apps().into_iter().next().unwrap();
        let mut detector = UiaSignalDetector::new(app);

        assert_eq!(detector.state(), UiaState::Idle);

        // Start generating at t=1000
        assert!(detector.tick(true, None, 1000).is_none());
        assert_eq!(detector.state(), UiaState::Generating);

        // Ongoing generating at t=2000
        assert!(detector.tick(true, None, 2000).is_none());
        assert_eq!(detector.state(), UiaState::Generating);

        // Stop generating at t=3000 -> enters settling
        assert!(detector.tick(false, None, 3000).is_none());
        assert!(matches!(
            detector.state(),
            UiaState::Settling { started_at: 3000 }
        ));

        // Advance 1000ms (debounce not yet reached)
        assert!(detector.tick(false, None, 4000).is_none());

        // Debounce reached at t=4500 (3000 + 1500)
        let ev = detector.tick(false, None, 4500).expect("done emitted");
        assert_eq!(ev.kind, Kind::Done);
        assert_eq!(detector.state(), UiaState::Idle);
    }

    #[test]
    fn test_uia_detector_debounce_cancellation() {
        let app = default_desktop_apps().into_iter().next().unwrap();
        let mut detector = UiaSignalDetector::new(app);

        // Start generating at t=1000
        detector.tick(true, None, 1000);
        // Enters settling at t=2000
        detector.tick(false, None, 2000);
        assert!(matches!(detector.state(), UiaState::Settling { .. }));

        // Resumes at t=2500 (before 1500ms debounce)
        detector.tick(true, None, 2500);
        assert_eq!(detector.state(), UiaState::Generating);

        // No event should be emitted at t=3500
        assert!(detector.tick(true, None, 3500).is_none());
    }

    #[test]
    fn test_uia_detector_needs_input_dedupe() {
        let app = default_desktop_apps().into_iter().next().unwrap();
        let mut detector = UiaSignalDetector::new(app);

        // Prompt appears
        let ev1 = detector
            .tick(false, Some("prompt-101".into()), 1000)
            .expect("needs_input emitted");
        assert_eq!(ev1.kind, Kind::NeedsInput);

        // Same prompt on subsequent ticks -> None
        assert!(detector
            .tick(false, Some("prompt-101".into()), 1200)
            .is_none());
        assert!(detector
            .tick(false, Some("prompt-101".into()), 1400)
            .is_none());

        // New prompt -> emitted
        let ev2 = detector
            .tick(false, Some("prompt-102".into()), 2000)
            .expect("new needs_input emitted");
        assert_eq!(ev2.kind, Kind::NeedsInput);
    }
}
