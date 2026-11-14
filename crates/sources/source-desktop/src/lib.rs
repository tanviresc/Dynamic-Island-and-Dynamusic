use chrono::{DateTime, Utc};
use island_contract::{Event, Kind, Source, Surface, Target};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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
            process_names: vec!["claude.exe".to_string(), "claude-desktop.exe".to_string()],
            enabled: true,
            detection: DetectionMode::Uia,
            window_title_contains: None,
        },
        DesktopAppConfig {
            id: "chatgpt-desktop".to_string(),
            display_name: "ChatGPT".to_string(),
            source: Source::Chatgpt,
            process_names: vec!["chatgpt.exe".to_string(), "openai.exe".to_string()],
            enabled: true,
            detection: DetectionMode::Uia,
            window_title_contains: None,
        },
        DesktopAppConfig {
            id: "gemini-desktop".to_string(),
            display_name: "Gemini".to_string(),
            source: Source::Gemini,
            process_names: vec!["gemini.exe".to_string(), "google-gemini.exe".to_string()],
            enabled: true,
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
            settling_debounce_ms: 400,
            min_generation_duration_ms: 300,
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

#[cfg(windows)]
fn find_process_window(target_process: &str) -> Option<(isize, String)> {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
    use windows::Win32::System::ProcessStatus::GetProcessImageFileNameW;
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowRect, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
        IsWindowVisible,
    };

    struct Candidate {
        hwnd: isize,
        title: String,
        area: i64,
        has_title: bool,
    }

    struct SearchCtx {
        proc_name: String,
        best: Option<Candidate>,
    }

    unsafe extern "system" fn enum_cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = &mut *(lparam.0 as *mut SearchCtx);
        if !IsWindowVisible(hwnd).as_bool() {
            return BOOL(1);
        }

        let mut rect = RECT::default();
        let _ = GetWindowRect(hwnd, &mut rect);
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        if width < 150 || height < 150 {
            return BOOL(1);
        }

        let mut pid: u32 = 0;
        let _ = GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return BOOL(1);
        }
        if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            let mut buf = [0u16; 512];
            let len = GetProcessImageFileNameW(handle, &mut buf);
            let _ = windows::Win32::Foundation::CloseHandle(handle);
            if len > 0 {
                let full = String::from_utf16_lossy(&buf[..len as usize]);
                if let Some(file_name) = full.rsplit('\\').next() {
                    if file_name.eq_ignore_ascii_case(&ctx.proc_name) {
                        let text_len = GetWindowTextLengthW(hwnd);
                        let mut title = String::new();
                        if text_len > 0 {
                            let mut title_buf = vec![0u16; text_len as usize + 1];
                            let read_len = GetWindowTextW(hwnd, &mut title_buf);
                            if read_len > 0 {
                                title = String::from_utf16_lossy(&title_buf[..read_len as usize]);
                            }
                        }
                        let has_title = !title.trim().is_empty();
                        let area = width as i64 * height as i64;
                        let cand = Candidate {
                            hwnd: hwnd.0 as isize,
                            title,
                            area,
                            has_title,
                        };

                        let replace = match &ctx.best {
                            None => true,
                            Some(current) => {
                                if cand.has_title && !current.has_title {
                                    true
                                } else if cand.has_title == current.has_title {
                                    cand.area > current.area
                                } else {
                                    false
                                }
                            }
                        };
                        if replace {
                            ctx.best = Some(cand);
                        }
                    }
                }
            }
        }
        BOOL(1)
    }

    let mut ctx = SearchCtx {
        proc_name: target_process.to_string(),
        best: None,
    };
    unsafe {
        let _ = EnumWindows(Some(enum_cb), LPARAM(&mut ctx as *mut _ as _));
    }
    ctx.best.map(|c| (c.hwnd, c.title))
}

#[cfg(windows)]
fn probe_window_state(hwnd: isize) -> (bool, Option<String>) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
    };
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, TreeScope_Descendants, UIA_ButtonControlTypeId,
        UIA_ControlTypePropertyId,
    };
    use windows::Win32::UI::WindowsAndMessaging::FindWindowExW;

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let uia: Result<IUIAutomation, _> =
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER);
        let uia = match uia {
            Ok(u) => u,
            Err(_) => return (false, None),
        };

        // If this is an Electron/Chromium app, search for the Chrome_RenderWidgetHostHWND child window
        let target_hwnd = match FindWindowExW(
            HWND(hwnd as _),
            HWND(std::ptr::null_mut()),
            windows::core::w!("Chrome_RenderWidgetHostHWND"),
            None,
        ) {
            Ok(child) if !child.0.is_null() => child,
            _ => HWND(hwnd as _),
        };

        let root_el = match uia.ElementFromHandle(target_hwnd) {
            Ok(el) => el,
            Err(_) => match uia.ElementFromHandle(HWND(hwnd as _)) {
                Ok(el) => el,
                Err(_) => return (false, None),
            },
        };

        let val = windows::core::VARIANT::from(UIA_ButtonControlTypeId.0);
        let condition = match uia.CreatePropertyCondition(UIA_ControlTypePropertyId, &val) {
            Ok(c) => c,
            Err(_) => return (false, None),
        };

        let mut is_generating = false;
        let mut needs_input = None;

        if let Ok(elements) = root_el.FindAll(TreeScope_Descendants, &condition) {
            if let Ok(count) = elements.Length() {
                for i in 0..count {
                    if let Ok(btn) = elements.GetElement(i) {
                        let name_str = btn.CurrentName().map(|n| n.to_string()).unwrap_or_default();
                        let auto_id = btn
                            .CurrentAutomationId()
                            .map(|n| n.to_string())
                            .unwrap_or_default();
                        let help_text = btn
                            .CurrentHelpText()
                            .map(|n| n.to_string())
                            .unwrap_or_default();

                        let lower =
                            format!("{} {} {}", name_str, auto_id, help_text).to_lowercase();
                        if lower.contains("stop") || lower.contains("cancel") {
                            is_generating = true;
                        } else if lower.contains("allow")
                            || lower.contains("approve")
                            || lower.contains("confirm")
                            || lower.contains("permission")
                        {
                            needs_input = Some(if !name_str.is_empty() {
                                name_str
                            } else {
                                "Action requires confirmation".to_string()
                            });
                        }
                    }
                }
            }
        }

        (is_generating, needs_input)
    }
}

pub fn start_desktop_watcher(
    event_tx: tokio::sync::mpsc::Sender<Event>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let apps = default_desktop_apps();
        let mut detectors: HashMap<String, UiaSignalDetector> = HashMap::new();
        for app in apps {
            if app.enabled {
                detectors.insert(app.id.clone(), UiaSignalDetector::new(app));
            }
        }

        let mut ticker = tokio::time::interval(std::time::Duration::from_millis(400));
        loop {
            ticker.tick().await;
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;

            #[cfg(windows)]
            {
                for detector in detectors.values_mut() {
                    let mut found_window = None;
                    for proc_name in &detector.app.process_names {
                        if let Some((hwnd, title)) = find_process_window(proc_name) {
                            found_window = Some((hwnd, title));
                            break;
                        }
                    }

                    if let Some((hwnd, title)) = found_window {
                        let (is_gen, needs_input) = probe_window_state(hwnd);
                        if let Some(mut ev) = detector.tick(is_gen, needs_input, now) {
                            let clean_title = title.trim();
                            if !clean_title.is_empty()
                                && clean_title.to_lowercase() != "claude"
                                && clean_title.to_lowercase() != "chatgpt"
                            {
                                ev.text = clean_title.to_string();
                            }
                            let _ = event_tx.send(ev).await;
                        }
                    }
                }
            }
        }
    })
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

        // Advance 200ms (debounce 400ms not yet reached)
        assert!(detector.tick(false, None, 3200).is_none());

        // Debounce reached at t=3400 (3000 + 400)
        let ev = detector.tick(false, None, 3400).expect("done emitted");
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

        // Resumes at t=2200 (before 400ms debounce)
        detector.tick(true, None, 2200);
        assert_eq!(detector.state(), UiaState::Generating);

        // No event should be emitted at t=2800
        assert!(detector.tick(true, None, 2800).is_none());
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
