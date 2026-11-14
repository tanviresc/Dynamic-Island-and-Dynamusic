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
            Source::Claude | Source::Chatgpt | Source::Gemini | Source::Desktop => {}
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
            process_names: vec![
                "claude.exe".to_string(),
                "claude-desktop.exe".to_string(),
                "anthropicclaude.exe".to_string(),
            ],
            enabled: true,
            detection: DetectionMode::Uia,
            window_title_contains: None,
        },
        DesktopAppConfig {
            id: "chatgpt-desktop".to_string(),
            display_name: "ChatGPT".to_string(),
            source: Source::Chatgpt,
            process_names: vec![
                "chatgpt.exe".to_string(),
                "openai.exe".to_string(),
                "chatgpt-desktop.exe".to_string(),
                "openai.chatgpt.exe".to_string(),
            ],
            enabled: true,
            detection: DetectionMode::Uia,
            window_title_contains: None,
        },
        DesktopAppConfig {
            id: "gemini-desktop".to_string(),
            display_name: "Gemini".to_string(),
            source: Source::Gemini,
            process_names: vec![
                "gemini.exe".to_string(),
                "google-gemini.exe".to_string(),
                "gemini-desktop.exe".to_string(),
            ],
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

fn clamp_chars(s: &str, max: usize) -> String {
    let trimmed = s.trim();
    if trimmed.chars().count() <= max {
        trimmed.to_string()
    } else {
        trimmed
            .chars()
            .take(max.saturating_sub(1))
            .collect::<String>()
            + "…"
    }
}

fn sanitize_ascii_key(s: &str, max: usize) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' || c == ':' {
                c
            } else {
                '_'
            }
        })
        .take(max)
        .collect()
}

fn infer_desktop_target(app_id: &str, app_display: &str) -> (String, Vec<String>) {
    let id_lower = app_id.to_lowercase();
    let disp_lower = app_display.to_lowercase();
    let combined = format!("{} {}", id_lower, disp_lower);

    let known: &[(&str, &str, &[&str])] = &[
        ("discord", "Discord", &["Discord.exe", "Update.exe"]),
        ("whatsapp", "WhatsApp", &["WhatsApp.exe"]),
        ("visual studio code", "VS Code", &["Code.exe"]),
        ("vscode", "VS Code", &["Code.exe"]),
        ("slack", "Slack", &["slack.exe"]),
        ("telegram", "Telegram", &["Telegram.exe"]),
        ("teams", "Microsoft Teams", &["ms-teams.exe", "Teams.exe"]),
        ("outlook", "Outlook", &["olk.exe", "OUTLOOK.EXE"]),
        ("spotify", "Spotify", &["Spotify.exe"]),
        ("signal", "Signal", &["Signal.exe"]),
        ("cursor", "Cursor", &["Cursor.exe"]),
    ];

    for (needle, label, procs) in known {
        if combined.contains(needle) {
            return (
                (*label).to_string(),
                procs.iter().map(|p| (*p).to_string()).collect(),
            );
        }
    }

    let friendly = if !app_display.trim().is_empty() {
        app_display.trim().to_string()
    } else {
        app_id
            .split(&['.', '!', '\\', '/'][..])
            .rfind(|part| !part.trim().is_empty())
            .unwrap_or("Desktop App")
            .trim()
            .to_string()
    };

    let exe_stem: String = friendly
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(40)
        .collect();
    let proc_name = if exe_stem.is_empty() {
        "explorer.exe".to_string()
    } else {
        format!("{}.exe", exe_stem)
    };
    (friendly, vec![proc_name])
}

pub struct ToastProcessor {
    apps: Vec<DesktopAppConfig>,
}

impl ToastProcessor {
    pub fn new(apps: Vec<DesktopAppConfig>) -> Self {
        Self { apps }
    }

    pub fn process_toast(&self, toast: &ToastMetadata) -> Option<Event> {
        self.process_toast_with_id(toast, None)
    }

    pub fn process_toast_with_id(
        &self,
        toast: &ToastMetadata,
        toast_id: Option<u32>,
    ) -> Option<Event> {
        let self_check = format!("{} {}", toast.app_id, toast.title).to_lowercase();
        if self_check.contains("island-app")
            || self_check.contains("com.island")
            || self_check.trim() == "island"
        {
            return None;
        }

        let body_lower = toast.body.to_lowercase();
        let title_lower = toast.title.to_lowercase();
        let is_needs_input = body_lower.contains("approval")
            || body_lower.contains("permission")
            || body_lower.contains("confirm")
            || body_lower.contains("question")
            || body_lower.contains("incoming call")
            || title_lower.contains("incoming call");

        let kind = if is_needs_input {
            Kind::NeedsInput
        } else {
            Kind::Done
        };

        // 1. Check explicitly configured AI desktop apps first
        if let Some(app) = self.apps.iter().find(|a| {
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
        }) {
            let title = clamp_chars(
                &format!(
                    "{} · {}",
                    app.display_name,
                    if is_needs_input {
                        "Needs input"
                    } else {
                        "Task completed"
                    }
                ),
                120,
            );
            let id_part = toast_id
                .map(|id| id.to_string())
                .unwrap_or_else(|| toast.timestamp.timestamp_millis().to_string());
            let dedupe_key =
                sanitize_ascii_key(&format!("desktop:{}:{}:{}", app.source, kind, id_part), 200);

            return Some(Event {
                id: Uuid::new_v4(),
                source: app.source,
                surface: Surface::Desktop,
                kind,
                title,
                text: clamp_chars(
                    if toast.body.trim().is_empty() {
                        "Response ready"
                    } else {
                        &toast.body
                    },
                    500,
                ),
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
            });
        }

        // 2. Generic desktop app notifications (Discord, WhatsApp, VS Code, Slack, etc.)
        if toast.app_id.trim().is_empty()
            && toast.title.trim().is_empty()
            && toast.body.trim().is_empty()
        {
            return None;
        }

        let (app_name, process_names) = infer_desktop_target(&toast.app_id, &toast.app_id);
        let title_str = if !toast.title.trim().is_empty() {
            clamp_chars(&format!("{} · {}", app_name, toast.title.trim()), 120)
        } else {
            clamp_chars(&app_name, 120)
        };
        let text_str = clamp_chars(
            if !toast.body.trim().is_empty() {
                toast.body.trim()
            } else if !toast.title.trim().is_empty() {
                toast.title.trim()
            } else {
                "New notification"
            },
            500,
        );
        let id_part = toast_id
            .map(|id| id.to_string())
            .unwrap_or_else(|| toast.timestamp.timestamp_millis().to_string());
        let app_slug = sanitize_ascii_key(&app_name.to_lowercase(), 48);
        let dedupe_key = sanitize_ascii_key(
            &format!("desktop:app:{}:{}:{}", app_slug, kind, id_part),
            200,
        );

        Some(Event {
            id: Uuid::new_v4(),
            source: Source::Desktop,
            surface: Surface::Desktop,
            kind,
            title: title_str,
            text: text_str,
            category: Some(clamp_chars(&app_name, 32)),
            account: None,
            target: Target::Process {
                process_names,
                window_title_contains: None,
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
        IsIconic, IsWindowVisible,
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
        let is_minimized = IsIconic(hwnd).as_bool();
        if !is_minimized && (width < 150 || height < 150) {
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
                    let target_base = ctx.proc_name.trim_end_matches(".exe");
                    if file_name.eq_ignore_ascii_case(&ctx.proc_name)
                        || file_name
                            .to_lowercase()
                            .starts_with(&target_base.to_lowercase())
                    {
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
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
    };
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, TreeScope_Descendants, UIA_ButtonControlTypeId,
        UIA_ControlTypePropertyId,
    };
    use windows::Win32::UI::WindowsAndMessaging::{EnumChildWindows, GetClassNameW};

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let uia: Result<IUIAutomation, _> =
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER);
        let uia = match uia {
            Ok(u) => u,
            Err(_) => return (false, None),
        };

        // Recursively find all Chrome_RenderWidgetHostHWND for Chromium/Electron apps (Claude, ChatGPT)
        struct ChildSearchCtx {
            render_hwnds: Vec<HWND>,
        }

        unsafe extern "system" fn child_enum_cb(child: HWND, lparam: LPARAM) -> BOOL {
            let ctx = &mut *(lparam.0 as *mut ChildSearchCtx);
            let mut class_buf = [0u16; 256];
            let len = GetClassNameW(child, &mut class_buf);
            if len > 0 {
                let class_str = String::from_utf16_lossy(&class_buf[..len as usize]);
                if class_str.contains("RenderWidgetHost") {
                    ctx.render_hwnds.push(child);
                }
            }
            BOOL(1)
        }

        let mut child_ctx = ChildSearchCtx {
            render_hwnds: Vec::new(),
        };
        let _ = EnumChildWindows(
            HWND(hwnd as _),
            Some(child_enum_cb),
            LPARAM(&mut child_ctx as *mut _ as _),
        );

        let mut targets = child_ctx.render_hwnds;
        targets.push(HWND(hwnd as _));

        let val = windows::core::VARIANT::from(UIA_ButtonControlTypeId.0);
        let condition = match uia.CreatePropertyCondition(UIA_ControlTypePropertyId, &val) {
            Ok(c) => c,
            Err(_) => return (false, None),
        };

        let mut is_generating = false;
        let mut needs_input = None;

        use windows::Win32::UI::WindowsAndMessaging::{
            SendMessageTimeoutW, SMTO_ABORTIFHUNG, WM_GETOBJECT,
        };

        for target_hwnd in targets {
            let mut res: usize = 0;
            let _ = SendMessageTimeoutW(
                target_hwnd,
                WM_GETOBJECT,
                windows::Win32::Foundation::WPARAM(0),
                windows::Win32::Foundation::LPARAM(-4),
                SMTO_ABORTIFHUNG,
                100,
                Some(&mut res),
            );

            let Ok(root_el) = uia.ElementFromHandle(target_hwnd) else {
                continue;
            };

            if let Ok(elements) = root_el.FindAll(TreeScope_Descendants, &condition) {
                if let Ok(count) = elements.Length() {
                    for i in 0..count {
                        if let Ok(btn) = elements.GetElement(i) {
                            let name_str =
                                btn.CurrentName().map(|n| n.to_string()).unwrap_or_default();
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

            if is_generating && needs_input.is_some() {
                break;
            }
        }

        (is_generating, needs_input)
    }
}

#[cfg(windows)]
fn extract_winrt_toast(
    notif: &windows::UI::Notifications::UserNotification,
) -> Option<(u32, ToastMetadata)> {
    use windows::UI::Notifications::KnownNotificationBindings;

    let id = notif.Id().ok()?;
    let app_display = notif
        .AppInfo()
        .ok()
        .and_then(|info| {
            info.DisplayInfo()
                .ok()
                .and_then(|d| d.DisplayName().ok())
                .map(|s| s.to_string())
                .filter(|s| !s.trim().is_empty())
                .or_else(|| info.AppUserModelId().ok().map(|s| s.to_string()))
        })
        .unwrap_or_default();

    let binding_name = KnownNotificationBindings::ToastGeneric().ok()?;
    let visual = notif.Notification().ok()?.Visual().ok()?;
    let binding = visual.GetBinding(&binding_name).ok()?;
    let text_elements = binding.GetTextElements().ok()?;
    let count = text_elements.Size().ok().unwrap_or(0);

    let mut lines: Vec<String> = Vec::new();
    for i in 0..count {
        if let Ok(elem) = text_elements.GetAt(i) {
            if let Ok(txt) = elem.Text() {
                let s = txt.to_string().trim().to_string();
                if !s.is_empty() {
                    lines.push(s);
                }
            }
        }
    }

    let title = lines.first().cloned().unwrap_or_default();
    let body = if lines.len() > 1 {
        lines[1..].join(" · ")
    } else {
        String::new()
    };

    if app_display.is_empty() && title.is_empty() && body.is_empty() {
        return None;
    }

    Some((
        id,
        ToastMetadata {
            app_id: app_display,
            title,
            body,
            timestamp: Utc::now(),
        },
    ))
}

#[cfg(windows)]
fn poll_visible_toast_banner() -> Vec<ToastMetadata> {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, TreeScope_Descendants, UIA_ControlTypePropertyId,
        UIA_TextControlTypeId,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetWindowTextW, IsWindowVisible,
    };

    let mut results = Vec::new();
    unsafe {
        struct ToastWindowCtx {
            hwnds: Vec<HWND>,
        }
        unsafe extern "system" fn enum_toast_cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
            if IsWindowVisible(hwnd).as_bool() {
                let mut class_buf = [0u16; 128];
                let class_len = GetClassNameW(hwnd, &mut class_buf);
                let class_str = String::from_utf16_lossy(&class_buf[..class_len.max(0) as usize]);
                if class_str == "Windows.UI.Core.CoreWindow" {
                    let mut title_buf = [0u16; 256];
                    let title_len = GetWindowTextW(hwnd, &mut title_buf);
                    let title_str =
                        String::from_utf16_lossy(&title_buf[..title_len.max(0) as usize]);
                    let tl = title_str.to_lowercase();
                    if tl.contains("notification") {
                        let ctx = &mut *(lparam.0 as *mut ToastWindowCtx);
                        ctx.hwnds.push(hwnd);
                    }
                }
            }
            BOOL(1)
        }

        let mut ctx = ToastWindowCtx { hwnds: Vec::new() };
        let _ = EnumWindows(Some(enum_toast_cb), LPARAM(&mut ctx as *mut _ as isize));
        if ctx.hwnds.is_empty() {
            return results;
        }

        let Ok(uia): Result<IUIAutomation, _> =
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
        else {
            return results;
        };
        let val = windows::core::VARIANT::from(UIA_TextControlTypeId.0);
        let Ok(cond) = uia.CreatePropertyCondition(UIA_ControlTypePropertyId, &val) else {
            return results;
        };

        for hwnd in ctx.hwnds {
            if let Ok(root) = uia.ElementFromHandle(hwnd) {
                if let Ok(els) = root.FindAll(TreeScope_Descendants, &cond) {
                    let count = els.Length().unwrap_or(0);
                    let mut lines = Vec::new();
                    for i in 0..count {
                        if let Ok(el) = els.GetElement(i) {
                            if let Ok(name) = el.CurrentName() {
                                let s = name.to_string().trim().to_string();
                                if !s.is_empty() && !lines.contains(&s) {
                                    lines.push(s);
                                }
                            }
                        }
                    }
                    if !lines.is_empty() {
                        let app_id = lines.first().cloned().unwrap_or_default();
                        let title = lines.get(1).cloned().unwrap_or_default();
                        let body = if lines.len() > 2 {
                            lines[2..].join(" · ")
                        } else {
                            String::new()
                        };
                        results.push(ToastMetadata {
                            app_id,
                            title,
                            body,
                            timestamp: Utc::now(),
                        });
                    }
                }
            }
        }
    }
    results
}

#[cfg(windows)]
fn start_os_toast_watcher_thread(thread_tx: tokio::sync::mpsc::Sender<Event>) {
    let _ = std::thread::Builder::new()
        .name("island-os-toast-watcher".to_string())
        .spawn(move || {
            use std::collections::HashSet;
            use windows::UI::Notifications::Management::{
                UserNotificationListener, UserNotificationListenerAccessStatus,
            };
            use windows::UI::Notifications::NotificationKinds;
            use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

            unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            }

            let processor = ToastProcessor::new(default_desktop_apps());
            let mut seen_ids: HashSet<u32> = HashSet::new();
            let mut listener_opt: Option<UserNotificationListener> = None;

            if let Ok(listener) = UserNotificationListener::Current() {
                if let Ok(op) = listener.RequestAccessAsync() {
                    if let Ok(status) = op.get() {
                        if status == UserNotificationListenerAccessStatus::Allowed {
                            if let Ok(existing_op) =
                                listener.GetNotificationsAsync(NotificationKinds::Toast)
                            {
                                if let Ok(existing) = existing_op.get() {
                                    let size = existing.Size().unwrap_or(0);
                                    for i in 0..size {
                                        if let Ok(n) = existing.GetAt(i) {
                                            if let Ok(id) = n.Id() {
                                                seen_ids.insert(id);
                                            }
                                        }
                                    }
                                }
                            }
                            listener_opt = Some(listener);
                            tracing::info!("Windows UserNotificationListener active");
                        } else {
                            tracing::warn!(
                                "UserNotificationListener access {:?}; using toast UIA banner fallback",
                                status
                            );
                        }
                    }
                }
            }

            let mut seen_banner_keys: HashMap<String, i64> = HashMap::new();

            loop {
                std::thread::sleep(std::time::Duration::from_millis(550));
                let now_ms = Utc::now().timestamp_millis();

                if let Some(ref listener) = listener_opt {
                    if let Ok(op) = listener.GetNotificationsAsync(NotificationKinds::Toast) {
                        if let Ok(list) = op.get() {
                            let size = list.Size().unwrap_or(0);
                            for i in 0..size {
                                if let Ok(notif) = list.GetAt(i) {
                                    if let Some((nid, toast)) = extract_winrt_toast(&notif) {
                                        if seen_ids.insert(nid) {
                                            if let Some(ev) =
                                                processor.process_toast_with_id(&toast, Some(nid))
                                            {
                                                if thread_tx.blocking_send(ev).is_err() {
                                                    return;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            if seen_ids.len() > 2000 {
                                seen_ids.clear();
                            }
                        }
                    }
                } else {
                    seen_banner_keys.retain(|_, ts| now_ms - *ts < 15_000);
                    for toast in poll_visible_toast_banner() {
                        let sig = format!("{}|{}|{}", toast.app_id, toast.title, toast.body);
                        if seen_banner_keys.contains_key(&sig) {
                            continue;
                        }
                        seen_banner_keys.insert(sig, now_ms);
                        if let Some(ev) = processor.process_toast(&toast) {
                            if thread_tx.blocking_send(ev).is_err() {
                                return;
                            }
                        }
                    }
                }
            }
        });
}

pub fn start_desktop_watcher(
    event_tx: tokio::sync::mpsc::Sender<Event>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let (thread_tx, mut thread_rx) = tokio::sync::mpsc::channel::<Event>(32);

        #[cfg(windows)]
        start_os_toast_watcher_thread(thread_tx.clone());

        // Spawn dedicated OS thread for COM UIAutomation polling
        let _ = std::thread::Builder::new()
            .name("island-desktop-watcher".to_string())
            .spawn(move || {
                let apps = default_desktop_apps();
                let mut detectors: HashMap<String, UiaSignalDetector> = HashMap::new();
                for app in apps {
                    if app.enabled {
                        detectors.insert(app.id.clone(), UiaSignalDetector::new(app));
                    }
                }

                loop {
                    std::thread::sleep(std::time::Duration::from_millis(400));
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
                                    if thread_tx.blocking_send(ev).is_err() {
                                        return;
                                    }
                                }
                            }
                        }
                    }
                }
            });

        while let Some(ev) = thread_rx.recv().await {
            let _ = event_tx.send(ev).await;
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

        // Generic desktop app (Discord)
        let discord_toast = ToastMetadata {
            app_id: "Discord".into(),
            title: "Direct Message".into(),
            body: "New message waiting".into(),
            timestamp: Utc::now(),
        };
        let mut generic_ev = processor
            .process_toast_with_id(&discord_toast, Some(42))
            .expect("generic desktop event created");
        assert_eq!(generic_ev.source, Source::Desktop);
        assert_eq!(generic_ev.surface, Surface::Desktop);
        assert!(generic_ev.normalize_and_validate(Utc::now()).is_ok());
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
