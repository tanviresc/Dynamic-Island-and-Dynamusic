use chrono::Utc;
pub use island_contract::WebFocusReport;
use island_contract::{Event, Kind, Source, Surface, Target};
use island_platform::{MonitorInfo, PlatformState, Rect};
use island_store::{NotificationState, StoredNotification};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use uuid::Uuid;

pub type Millis = u64;

pub const DEFAULT_DISPLAY_MS: Millis = 3000;
pub const DEFAULT_HOVER_RESUME_MIN_MS: Millis = 1000;
pub const DEFAULT_INTER_ITEM_GAP_MS: Millis = 300;
pub const DEFAULT_GROUP_WINDOW_MS: Millis = 5000;
pub const DEFAULT_QUEUE_CAP: usize = 200;
pub const DEFAULT_DONE_AGE_OUT_HOURS: u32 = 24;
pub const MONITOR_DEBOUNCE_MS: Millis = 500;

pub const COLOR_GREEN: &str = "#30D158";
pub const COLOR_BLUE: &str = "#0A84FF";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationView {
    pub id: Uuid,
    pub source: Source,
    pub kind: Kind,
    pub title: String,
    pub text: String,
    pub category: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueItemView {
    pub id: Uuid,
    pub source: Source,
    pub kind: Kind,
    pub title: String,
    pub text: String,
    pub category: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum ViewModel {
    Hidden,
    Dot { color: String },
    Pill { notification: NotificationView },
    Queue { items: Vec<QueueItemView> },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WindowTransition {
    Immediate,
    DotMove,
    Fade,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Input {
    EventAccepted(Box<Event>),
    Tick,
    HoverEnter,
    HoverLeave,
    PillClicked,
    DotClicked,
    QueueItemClicked(Uuid),
    QueueClear,
    QueueClose,
    PlatformContext(Box<PlatformState>),
    WebFocus(WebFocusReport),
    SettingsChanged {
        follow_active_monitor: bool,
        fixed_monitor_id: Option<String>,
        idle_threshold_min: u32,
    },
    DisplaySettingsChanged {
        display_ms: Millis,
    },
    PauseToggled(bool),
    DndToggled(bool),
    ExternalRead(String),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Effect {
    Render(ViewModel),
    PlaceWindow {
        monitor_id: String,
        transition: WindowTransition,
    },
    SetHitRect(Option<Rect>),
    Jump(Target),
    PersistSave(StoredNotification),
    PersistUpdateState(Uuid, NotificationState),
    PersistRemove(Uuid, &'static str),
    PersistClearAll(&'static str),
}

#[derive(Debug, Clone)]
struct DisplayingItem {
    item: StoredNotification,
    started_at: Millis,
    deadline: Millis,
    is_hovered: bool,
    hover_remaining_ms: Option<Millis>,
}

#[derive(Debug, Clone)]
pub struct IslandCore {
    display_queue: VecDeque<StoredNotification>,
    current_display: Option<DisplayingItem>,
    unread_queue: Vec<StoredNotification>,
    is_queue_panel_open: bool,

    // Multi-monitor & Window State
    pub active_monitor_id: Option<String>,
    pending_candidate_id: Option<String>,
    candidate_first_seen_at: Option<Millis>,
    deferred_monitor_move: Option<String>,
    current_monitors: Vec<MonitorInfo>,
    last_platform_state: Option<PlatformState>,
    last_web_focus: Option<WebFocusReport>,
    pub follow_active_monitor: bool,
    pub fixed_monitor_id: Option<String>,
    pub idle_threshold_min: u32,

    // Modes
    is_paused: bool,
    is_dnd: bool,
    is_game_mode: bool,
    game_dot_until: Option<Millis>,
    game_next_dot_at: Option<Millis>,

    // Configurable parameters
    pub display_ms: Millis,
    pub hover_resume_min_ms: Millis,
    pub group_window_ms: Millis,
    pub queue_cap: usize,
    pub email_dot_color: String,
    pub smart_skip_enabled: bool,
}

impl Default for IslandCore {
    fn default() -> Self {
        Self {
            display_queue: VecDeque::new(),
            current_display: None,
            unread_queue: Vec::new(),
            is_queue_panel_open: false,
            active_monitor_id: None,
            pending_candidate_id: None,
            candidate_first_seen_at: None,
            deferred_monitor_move: None,
            current_monitors: Vec::new(),
            last_platform_state: None,
            last_web_focus: None,
            follow_active_monitor: true,
            fixed_monitor_id: None,
            idle_threshold_min: 3,
            is_paused: false,
            is_dnd: false,
            is_game_mode: false,
            game_dot_until: None,
            game_next_dot_at: None,
            display_ms: DEFAULT_DISPLAY_MS,
            hover_resume_min_ms: DEFAULT_HOVER_RESUME_MIN_MS,
            group_window_ms: DEFAULT_GROUP_WINDOW_MS,
            queue_cap: DEFAULT_QUEUE_CAP,
            email_dot_color: COLOR_GREEN.to_string(),
            smart_skip_enabled: true,
        }
    }
}

impl IslandCore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn load_initial_unread(&mut self, items: Vec<StoredNotification>) {
        self.unread_queue = items;
    }

    pub fn unread_count(&self) -> usize {
        self.unread_queue.len()
    }

    pub fn has_unread(&self) -> bool {
        !self.unread_queue.is_empty()
    }

    pub fn is_displaying(&self) -> bool {
        self.current_display.is_some()
    }

    pub fn compute_dot_color(&self) -> String {
        let has_needs_input = self
            .unread_queue
            .iter()
            .any(|item| item.kind == Kind::NeedsInput || item.kind == Kind::Error);

        if has_needs_input {
            return COLOR_BLUE.to_string();
        }

        let all_email = !self.unread_queue.is_empty()
            && self
                .unread_queue
                .iter()
                .all(|item| item.source == Source::Gmail);

        if all_email {
            self.email_dot_color.clone()
        } else {
            COLOR_GREEN.to_string()
        }
    }

    pub fn current_view_model(&self, _now: Millis) -> ViewModel {
        if self.is_paused {
            return ViewModel::Hidden;
        }

        if let Some(ref disp) = self.current_display {
            return ViewModel::Pill {
                notification: NotificationView {
                    id: disp.item.id,
                    source: disp.item.source,
                    kind: disp.item.kind,
                    title: disp.item.title.clone(),
                    text: disp.item.text.clone(),
                    category: disp.item.category.clone(),
                },
            };
        }

        if self.is_queue_panel_open {
            let items: Vec<QueueItemView> = self
                .unread_queue
                .iter()
                .map(|item| QueueItemView {
                    id: item.id,
                    source: item.source,
                    kind: item.kind,
                    title: item.title.clone(),
                    text: item.text.clone(),
                    category: item.category.clone(),
                    created_at: format_relative_time(item.created_at),
                })
                .collect();
            return ViewModel::Queue { items };
        }

        if self.is_game_mode {
            if self.unread_queue.is_empty() {
                return ViewModel::Hidden;
            }
            if self.game_dot_until.is_some() {
                return ViewModel::Dot {
                    color: self.compute_dot_color(),
                };
            }
            return ViewModel::Hidden;
        }

        if self.is_dnd {
            if self.has_unread() {
                return ViewModel::Dot {
                    color: self.compute_dot_color(),
                };
            }
            return ViewModel::Hidden;
        }

        if let Some(ref disp) = self.current_display {
            return ViewModel::Pill {
                notification: NotificationView {
                    id: disp.item.id,
                    source: disp.item.source,
                    kind: disp.item.kind,
                    title: disp.item.title.clone(),
                    text: disp.item.text.clone(),
                    category: disp.item.category.clone(),
                },
            };
        }

        if self.has_unread() {
            return ViewModel::Dot {
                color: self.compute_dot_color(),
            };
        }

        ViewModel::Hidden
    }

    pub fn next_deadline(&self, now: Millis) -> Option<Millis> {
        let mut deadlines = Vec::new();

        if let Some(ref disp) = self.current_display {
            if !disp.is_hovered {
                deadlines.push(disp.deadline);
            }
        }

        if let Some(seen_at) = self.candidate_first_seen_at {
            deadlines.push(seen_at + MONITOR_DEBOUNCE_MS);
        }

        if self.is_game_mode {
            if let Some(until) = self.game_dot_until {
                if until > now {
                    deadlines.push(until);
                }
            }
            if let Some(next_dot) = self.game_next_dot_at {
                if next_dot > now {
                    deadlines.push(next_dot);
                }
            }
        }

        deadlines.into_iter().min()
    }

    fn check_is_looking_raw(
        &self,
        source: Source,
        surface: Surface,
        target: &Target,
        ignore_idle: bool,
    ) -> bool {
        let state = match &self.last_platform_state {
            Some(s) => s,
            None => return false,
        };

        if !ignore_idle && state.is_idle {
            return false;
        }

        let fg = match &state.foreground_window {
            Some(f) if f.is_valid => f,
            _ => return false,
        };

        match surface {
            Surface::Desktop => {
                let proc = fg.process_name.to_lowercase();
                match source {
                    Source::Claude => proc.contains("claude"),
                    Source::Chatgpt => proc.contains("chatgpt") || proc.contains("openai"),
                    Source::Gemini => proc.contains("gemini"),
                    Source::Desktop => {
                        if let Target::Process { process_names, .. } = target {
                            process_names.iter().any(|p| {
                                let stem = p.trim_end_matches(".exe").to_lowercase();
                                !stem.is_empty() && stem != "explorer" && proc.contains(&stem)
                            })
                        } else {
                            false
                        }
                    }
                    _ => false,
                }
            }
            Surface::Ide => {
                let proc = fg.process_name.to_lowercase();
                if !proc.contains("antigravity") {
                    return false;
                }
                if let Target::Ide {
                    ref workspace_path,
                    ref window_title_contains,
                    ..
                } = target
                {
                    if let Some(ref title_contains) = window_title_contains {
                        if !fg
                            .title
                            .to_lowercase()
                            .contains(&title_contains.to_lowercase())
                        {
                            return false;
                        }
                    }
                    let folder_name = std::path::Path::new(workspace_path)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or(workspace_path);
                    fg.title
                        .to_lowercase()
                        .contains(&folder_name.to_lowercase())
                } else {
                    true
                }
            }
            Surface::Web => {
                let proc = fg.process_name.to_lowercase();
                let is_browser = proc.contains("chrome")
                    || proc.contains("brave")
                    || proc.contains("msedge")
                    || proc.contains("edge")
                    || proc.contains("vivaldi")
                    || proc.contains("opera")
                    || proc.contains("arc");
                if !is_browser {
                    return false;
                }
                if let Some(ref report) = self.last_web_focus {
                    if !report.is_browser_focused {
                        return false;
                    }
                    if let Target::BrowserTab { tab_id, .. } = target {
                        *tab_id == report.active_tab_id
                    } else {
                        false
                    }
                } else {
                    false
                }
            }
            _ => false,
        }
    }

    pub fn handle_input(&mut self, input: Input, now: Millis) -> Vec<Effect> {
        let mut effects = Vec::new();

        match input {
            Input::EventAccepted(event) => {
                let event = *event;

                // Smart skip check (§1.8)
                if self.smart_skip_enabled
                    && self.check_is_looking_raw(event.source, event.surface, &event.target, false)
                {
                    tracing::info!(
                        event_id = %event.id,
                        source = ?event.source,
                        "Smart skip: user is already looking at source"
                    );
                    return effects;
                }

                let stored = StoredNotification {
                    id: event.id,
                    source: event.source,
                    surface: event.surface,
                    kind: event.kind,
                    title: event.title,
                    text: event.text,
                    category: event.category,
                    account: event.account,
                    target: event.target,
                    group_key: Some(event.dedupe_key.clone()),
                    group_count: 1,
                    state: NotificationState::Pending,
                    external_ref: match event.source {
                        Source::Gmail => Some(event.dedupe_key),
                        _ => None,
                    },
                    created_at: event.created_at.timestamp_millis(),
                    received_at: now as i64,
                    expires_at: None,
                };

                // Grouping burst check (done and new_mail merge)
                let mut merged = false;
                if stored.kind == Kind::Done || stored.kind == Kind::NewMail {
                    if let Some(ref mut disp) = self.current_display {
                        if disp.item.source == stored.source
                            && disp.item.surface == stored.surface
                            && disp.item.kind == stored.kind
                            && disp.item.account == stored.account
                            && (now - disp.started_at) <= self.group_window_ms
                        {
                            disp.item.group_count += 1;
                            disp.item.target = stored.target.clone();
                            disp.item.title = if stored.kind == Kind::Done {
                                format!("{} tasks done", disp.item.group_count)
                            } else {
                                format!("{} new emails", disp.item.group_count)
                            };
                            merged = true;
                        }
                    }
                }

                if !merged {
                    effects.push(Effect::PersistSave(stored.clone()));

                    if self.is_paused || self.is_dnd || self.is_game_mode {
                        let mut item = stored;
                        item.state = NotificationState::Unread;
                        effects.push(Effect::PersistUpdateState(
                            item.id,
                            NotificationState::Unread,
                        ));
                        self.push_unread(item, &mut effects);

                        if self.is_game_mode {
                            self.game_dot_until = Some(now + 10000);
                            self.game_next_dot_at = Some(now + 10000 + 60000);
                        }
                    } else if self.current_display.is_none() {
                        let mut item = stored;
                        item.state = NotificationState::Displaying;
                        self.current_display = Some(DisplayingItem {
                            item: item.clone(),
                            started_at: now,
                            deadline: now + self.display_ms,
                            is_hovered: false,
                            hover_remaining_ms: None,
                        });
                        effects.push(Effect::PersistUpdateState(
                            item.id,
                            NotificationState::Displaying,
                        ));
                    } else {
                        if stored.kind == Kind::NeedsInput || stored.kind == Kind::Error {
                            let first_non_urgent = self.display_queue.iter().position(|it| {
                                it.kind != Kind::NeedsInput && it.kind != Kind::Error
                            });
                            match first_non_urgent {
                                Some(idx) => self.display_queue.insert(idx, stored),
                                None => self.display_queue.push_back(stored),
                            }
                        } else {
                            self.display_queue.push_back(stored);
                        }
                    }
                }
            }

            Input::Tick => {
                // Check displaying expiration
                if let Some(ref disp) = self.current_display {
                    if !disp.is_hovered && now >= disp.deadline {
                        let finished = self.current_display.take().unwrap();
                        let mut item = finished.item;
                        item.state = NotificationState::Unread;
                        effects.push(Effect::PersistUpdateState(
                            item.id,
                            NotificationState::Unread,
                        ));
                        self.push_unread(item, &mut effects);

                        // If monitor move was deferred due to display, move now!
                        if let Some(target) = self.deferred_monitor_move.take() {
                            self.active_monitor_id = Some(target.clone());
                            effects.push(Effect::PlaceWindow {
                                monitor_id: target,
                                transition: WindowTransition::DotMove,
                            });
                        }

                        // Next item in display queue
                        if let Some(next_item) = self.display_queue.pop_front() {
                            let mut next = next_item;
                            next.state = NotificationState::Displaying;
                            self.current_display = Some(DisplayingItem {
                                item: next.clone(),
                                started_at: now,
                                deadline: now + self.display_ms,
                                is_hovered: false,
                                hover_remaining_ms: None,
                            });
                            effects.push(Effect::PersistUpdateState(
                                next.id,
                                NotificationState::Displaying,
                            ));
                        }
                    }
                }

                // Check monitor debounce
                if let (Some(cand), Some(seen_at)) =
                    (&self.pending_candidate_id, self.candidate_first_seen_at)
                {
                    if now.saturating_sub(seen_at) >= MONITOR_DEBOUNCE_MS {
                        let target = cand.clone();
                        self.pending_candidate_id = None;
                        self.candidate_first_seen_at = None;

                        if self.current_display.is_some() || self.is_queue_panel_open {
                            // Defer move until pill finishes or panel closes
                            self.deferred_monitor_move = Some(target);
                        } else {
                            self.active_monitor_id = Some(target.clone());
                            let transition = if self.has_unread() {
                                WindowTransition::DotMove
                            } else {
                                WindowTransition::Immediate
                            };
                            effects.push(Effect::PlaceWindow {
                                monitor_id: target,
                                transition,
                            });
                        }
                    }
                }

                // Game mode dot interval scheduling
                if self.is_game_mode {
                    if let Some(until) = self.game_dot_until {
                        if now >= until {
                            self.game_dot_until = None;
                            self.game_next_dot_at = Some(now + 60000);
                        }
                    } else if let Some(next_at) = self.game_next_dot_at {
                        if now >= next_at && !self.unread_queue.is_empty() {
                            self.game_dot_until = Some(now + 3000);
                            self.game_next_dot_at = Some(now + 3000 + 60000);
                        }
                    }
                }
            }

            Input::PlatformContext(boxed_state) => {
                let state = *boxed_state;
                self.current_monitors = state.monitors.clone();

                // 1. Hot-unplug check: current monitor disconnected
                if let Some(ref current_id) = self.active_monitor_id {
                    let still_exists = state.monitors.iter().any(|m| &m.id == current_id);
                    if !still_exists {
                        let fallback = state
                            .active_monitor_id
                            .clone()
                            .or_else(|| state.monitors.first().map(|m| m.id.clone()));
                        if let Some(target) = fallback {
                            self.active_monitor_id = Some(target.clone());
                            self.deferred_monitor_move = None;
                            effects.push(Effect::PlaceWindow {
                                monitor_id: target,
                                transition: WindowTransition::Immediate,
                            });
                        }
                    }
                }

                // 2. Debounce evaluation for active monitor candidate
                if let Some(target) = state.active_monitor_id.clone() {
                    if Some(&target) != self.active_monitor_id.as_ref() {
                        if self.pending_candidate_id.as_deref() == Some(&target) {
                            if let Some(seen_at) = self.candidate_first_seen_at {
                                if now.saturating_sub(seen_at) >= MONITOR_DEBOUNCE_MS {
                                    self.pending_candidate_id = None;
                                    self.candidate_first_seen_at = None;

                                    if self.current_display.is_some() || self.is_queue_panel_open {
                                        self.deferred_monitor_move = Some(target);
                                    } else {
                                        self.active_monitor_id = Some(target.clone());
                                        let transition = if self.has_unread() {
                                            WindowTransition::DotMove
                                        } else {
                                            WindowTransition::Immediate
                                        };
                                        effects.push(Effect::PlaceWindow {
                                            monitor_id: target,
                                            transition,
                                        });
                                    }
                                }
                            }
                        } else {
                            self.pending_candidate_id = Some(target);
                            self.candidate_first_seen_at = Some(now);
                        }
                    } else {
                        self.pending_candidate_id = None;
                        self.candidate_first_seen_at = None;
                    }
                }

                // 3. Game mode transitions
                if !self.is_game_mode && state.is_game_mode {
                    self.is_game_mode = true;
                    if let Some(disp) = self.current_display.take() {
                        let mut item = disp.item;
                        item.state = NotificationState::Unread;
                        effects.push(Effect::PersistUpdateState(
                            item.id,
                            NotificationState::Unread,
                        ));
                        self.push_unread(item, &mut effects);
                    }
                    if self.has_unread() {
                        self.game_dot_until = Some(now + 10000);
                        self.game_next_dot_at = Some(now + 10000 + 60000);
                    }
                } else if self.is_game_mode && !state.is_game_mode {
                    self.is_game_mode = false;
                    self.game_dot_until = None;
                    self.game_next_dot_at = None;
                }

                self.last_platform_state = Some(state);

                // 4. Auto-read check (§1.8)
                self.run_auto_read(&mut effects);
            }

            Input::WebFocus(report) => {
                self.last_web_focus = Some(report);
                self.run_auto_read(&mut effects);
            }

            Input::SettingsChanged {
                follow_active_monitor,
                fixed_monitor_id,
                idle_threshold_min,
            } => {
                self.follow_active_monitor = follow_active_monitor;
                self.fixed_monitor_id = fixed_monitor_id;
                self.idle_threshold_min = idle_threshold_min;
            }

            Input::DisplaySettingsChanged { display_ms } => {
                let clamped = display_ms.clamp(1000, 15000);
                self.display_ms = clamped;
                if let Some(ref mut disp) = self.current_display {
                    disp.deadline = disp.started_at + clamped;
                }
            }

            Input::HoverEnter => {
                if let Some(ref mut disp) = self.current_display {
                    if !disp.is_hovered {
                        disp.is_hovered = true;
                        let remaining = disp.deadline.saturating_sub(now);
                        disp.hover_remaining_ms = Some(remaining);
                    }
                }
            }

            Input::HoverLeave => {
                if let Some(ref mut disp) = self.current_display {
                    if disp.is_hovered {
                        disp.is_hovered = false;
                        let remaining = disp
                            .hover_remaining_ms
                            .unwrap_or(self.display_ms)
                            .max(self.hover_resume_min_ms);
                        disp.deadline = now + remaining;
                    }
                }
            }

            Input::PillClicked => {
                if let Some(disp) = self.current_display.take() {
                    effects.push(Effect::Jump(disp.item.target));
                    effects.push(Effect::PersistRemove(disp.item.id, "clicked"));
                    self.unread_queue.retain(|it| it.id != disp.item.id);

                    // Next item in display queue
                    if let Some(next_item) = self.display_queue.pop_front() {
                        let mut item = next_item;
                        item.state = NotificationState::Displaying;
                        self.current_display = Some(DisplayingItem {
                            item: item.clone(),
                            started_at: now,
                            deadline: now + self.display_ms,
                            is_hovered: false,
                            hover_remaining_ms: None,
                        });
                        effects.push(Effect::PersistUpdateState(
                            item.id,
                            NotificationState::Displaying,
                        ));
                    }
                }
            }

            Input::DotClicked => {
                self.is_queue_panel_open = !self.is_queue_panel_open;
                if self.is_queue_panel_open {
                    self.current_display = None;
                }
            }

            Input::QueueItemClicked(id) => {
                if let Some(idx) = self.unread_queue.iter().position(|it| it.id == id) {
                    let item = self.unread_queue.remove(idx);
                    effects.push(Effect::Jump(item.target));
                    effects.push(Effect::PersistRemove(item.id, "clicked"));
                    if self.unread_queue.is_empty() {
                        self.is_queue_panel_open = false;
                        if let Some(target) = self.deferred_monitor_move.take() {
                            self.active_monitor_id = Some(target.clone());
                            effects.push(Effect::PlaceWindow {
                                monitor_id: target,
                                transition: WindowTransition::Immediate,
                            });
                        }
                    }
                }
            }

            Input::QueueClear => {
                self.unread_queue.clear();
                self.current_display = None;
                self.is_queue_panel_open = false;
                effects.push(Effect::PersistClearAll("cleared"));
                if let Some(target) = self.deferred_monitor_move.take() {
                    self.active_monitor_id = Some(target.clone());
                    effects.push(Effect::PlaceWindow {
                        monitor_id: target,
                        transition: WindowTransition::Immediate,
                    });
                }
            }

            Input::QueueClose => {
                self.is_queue_panel_open = false;
                if let Some(target) = self.deferred_monitor_move.take() {
                    self.active_monitor_id = Some(target.clone());
                    effects.push(Effect::PlaceWindow {
                        monitor_id: target,
                        transition: WindowTransition::DotMove,
                    });
                }
            }

            Input::PauseToggled(paused) => {
                self.is_paused = paused;
            }

            Input::DndToggled(dnd) => {
                self.is_dnd = dnd;
            }

            Input::ExternalRead(ext_ref) => {
                let mut i = 0;
                while i < self.unread_queue.len() {
                    let item = &self.unread_queue[i];
                    let matches = item.external_ref.as_deref() == Some(&ext_ref)
                        || item.group_key.as_deref() == Some(&ext_ref);
                    if matches {
                        let removed = self.unread_queue.remove(i);
                        effects.push(Effect::PersistRemove(removed.id, "external_read"));
                    } else {
                        i += 1;
                    }
                }
            }
        }

        effects.push(Effect::Render(self.current_view_model(now)));
        effects
    }

    fn run_auto_read(&mut self, effects: &mut Vec<Effect>) {
        // Auto-read checks unread queue only (idle ignored per §1.8).
        // Actively displaying popups (current_display) must hold for their full configured
        // display_ms duration and never be prematurely dismissed or purged on focus switches.
        let mut i = 0;
        while i < self.unread_queue.len() {
            let item = &self.unread_queue[i];
            if self.check_is_looking_raw(item.source, item.surface, &item.target, true) {
                let removed = self.unread_queue.remove(i);
                effects.push(Effect::PersistRemove(removed.id, "auto_read"));
            } else {
                i += 1;
            }
        }
    }

    fn push_unread(&mut self, item: StoredNotification, effects: &mut Vec<Effect>) {
        self.unread_queue.insert(0, item);

        if self.unread_queue.len() > self.queue_cap {
            if let Some(drop_idx) = self
                .unread_queue
                .iter()
                .rposition(|it| it.kind != Kind::NeedsInput && it.kind != Kind::Error)
            {
                let dropped = self.unread_queue.remove(drop_idx);
                effects.push(Effect::PersistRemove(dropped.id, "capped"));
            }
        }
    }
}

fn format_relative_time(timestamp_ms: i64) -> String {
    let now = Utc::now().timestamp_millis();
    let diff = (now - timestamp_ms).max(0);
    let seconds = diff / 1000;
    let minutes = seconds / 60;
    let hours = minutes / 60;

    if minutes < 1 {
        "now".to_string()
    } else if hours < 1 {
        format!("{}m", minutes)
    } else if hours < 24 {
        format!("{}h", hours)
    } else {
        format!("{}d", hours / 24)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use island_platform::WindowSummary;

    fn make_test_event(id: Uuid, kind: Kind) -> Event {
        Event {
            id,
            source: Source::Claude,
            surface: Surface::Web,
            kind,
            title: "Test Title".to_string(),
            text: "Test Text".to_string(),
            category: None,
            account: None,
            target: Target::BrowserTab {
                tab_id: 1,
                window_id: 1,
                url: None,
            },
            created_at: Utc::now(),
            dedupe_key: format!("test:{}", id),
        }
    }

    #[test]
    fn test_display_and_hover_pause() {
        let mut core = IslandCore::new();
        let ev = make_test_event(Uuid::new_v4(), Kind::Done);

        let _fx = core.handle_input(Input::EventAccepted(Box::new(ev)), 1000);
        assert!(matches!(
            core.current_view_model(1000),
            ViewModel::Pill { .. }
        ));

        core.handle_input(Input::HoverEnter, 2000);
        core.handle_input(Input::Tick, 5000);
        assert!(matches!(
            core.current_view_model(5000),
            ViewModel::Pill { .. }
        ));

        core.handle_input(Input::HoverLeave, 5000);
        core.handle_input(Input::Tick, 6000);
        assert!(matches!(
            core.current_view_model(6000),
            ViewModel::Pill { .. }
        ));

        core.handle_input(Input::Tick, 7001);
        assert!(matches!(
            core.current_view_model(7001),
            ViewModel::Dot { .. }
        ));
        assert_eq!(core.unread_count(), 1);
    }

    #[test]
    fn test_dot_color_priority() {
        let mut core = IslandCore::new();
        assert_eq!(core.compute_dot_color(), COLOR_GREEN);

        let done_ev = make_test_event(Uuid::new_v4(), Kind::Done);
        core.handle_input(Input::EventAccepted(Box::new(done_ev)), 1000);
        core.handle_input(Input::Tick, 4001);
        assert_eq!(core.compute_dot_color(), COLOR_GREEN);

        let input_ev = make_test_event(Uuid::new_v4(), Kind::NeedsInput);
        core.handle_input(Input::EventAccepted(Box::new(input_ev)), 5000);
        core.handle_input(Input::Tick, 8001);
        assert_eq!(core.compute_dot_color(), COLOR_BLUE);
    }

    #[test]
    fn test_queue_clear() {
        let mut core = IslandCore::new();
        let ev = make_test_event(Uuid::new_v4(), Kind::Done);
        core.handle_input(Input::EventAccepted(Box::new(ev)), 1000);
        core.handle_input(Input::Tick, 4001);
        assert_eq!(core.unread_count(), 1);

        core.handle_input(Input::DotClicked, 5000);
        assert!(matches!(
            core.current_view_model(5000),
            ViewModel::Queue { .. }
        ));

        core.handle_input(Input::QueueClear, 5001);
        assert_eq!(core.unread_count(), 0);
        assert!(matches!(core.current_view_model(5001), ViewModel::Hidden));
    }

    #[test]
    fn test_monitor_selection_and_debounce() {
        let mut core = IslandCore::new();
        let mon1 = MonitorInfo {
            id: "MON1".to_string(),
            name: "Primary".to_string(),
            is_primary: true,
            rect: Rect::new(0, 0, 1920, 1080),
            work_area: Rect::new(0, 0, 1920, 1040),
            scale_factor: 1.0,
        };
        let mon2 = MonitorInfo {
            id: "MON2".to_string(),
            name: "Secondary".to_string(),
            is_primary: false,
            rect: Rect::new(1920, 0, 3840, 1080),
            work_area: Rect::new(1920, 0, 3840, 1040),
            scale_factor: 1.0,
        };

        // Initial setup on MON1
        core.active_monitor_id = Some("MON1".to_string());

        // Context state indicates user moved to MON2 at t=1000
        let state = PlatformState {
            monitors: vec![mon1.clone(), mon2.clone()],
            foreground_window: None,
            cursor_pos: Some((2500, 500)),
            active_monitor_id: Some("MON2".to_string()),
            is_idle: false,
            idle_ms: 0,
            is_game_mode: false,
            quns_state: 5,
        };

        let fx1 = core.handle_input(Input::PlatformContext(Box::new(state.clone())), 1000);
        // Should not move immediately because of 500ms debounce
        assert!(!fx1.iter().any(|f| matches!(f, Effect::PlaceWindow { .. })));
        assert_eq!(core.active_monitor_id, Some("MON1".to_string()));

        // Check at t=1400 (400ms): still not moved
        let fx2 = core.handle_input(Input::Tick, 1400);
        assert!(!fx2.iter().any(|f| matches!(f, Effect::PlaceWindow { .. })));
        assert_eq!(core.active_monitor_id, Some("MON1".to_string()));

        // Check at t=1501 (>500ms debounce passed): now it places window on MON2!
        let fx3 = core.handle_input(Input::Tick, 1501);
        assert!(fx3.iter().any(|f| match f {
            Effect::PlaceWindow { monitor_id, .. } => monitor_id == "MON2",
            _ => false,
        }));
        assert_eq!(core.active_monitor_id, Some("MON2".to_string()));
    }

    #[test]
    fn test_moving_rule_displaying_stays() {
        let mut core = IslandCore::new();
        core.active_monitor_id = Some("MON1".to_string());

        let mon1 = MonitorInfo {
            id: "MON1".to_string(),
            name: "Primary".to_string(),
            is_primary: true,
            rect: Rect::new(0, 0, 1920, 1080),
            work_area: Rect::new(0, 0, 1920, 1040),
            scale_factor: 1.0,
        };
        let mon2 = MonitorInfo {
            id: "MON2".to_string(),
            name: "Secondary".to_string(),
            is_primary: false,
            rect: Rect::new(1920, 0, 3840, 1080),
            work_area: Rect::new(1920, 0, 3840, 1040),
            scale_factor: 1.0,
        };

        // Event accepted at t=1000, displaying pill until t=4000
        let ev = make_test_event(Uuid::new_v4(), Kind::Done);
        core.handle_input(Input::EventAccepted(Box::new(ev)), 1000);

        // Active monitor moves to MON2 at t=1100
        let state = PlatformState {
            monitors: vec![mon1.clone(), mon2.clone()],
            foreground_window: None,
            cursor_pos: Some((2500, 500)),
            active_monitor_id: Some("MON2".to_string()),
            is_idle: false,
            idle_ms: 0,
            is_game_mode: false,
            quns_state: 5,
        };
        core.handle_input(Input::PlatformContext(Box::new(state)), 1100);

        // Tick past 500ms debounce at t=1700: pill is STILL displaying, so window stays on MON1!
        let fx = core.handle_input(Input::Tick, 1700);
        assert!(!fx.iter().any(|f| matches!(f, Effect::PlaceWindow { .. })));
        assert_eq!(core.active_monitor_id, Some("MON1".to_string()));

        // Display expires at t=4001: shrinks to dot and moves to MON2!
        let fx_expire = core.handle_input(Input::Tick, 4001);
        assert!(fx_expire.iter().any(|f| match f {
            Effect::PlaceWindow { monitor_id, .. } => monitor_id == "MON2",
            _ => false,
        }));
        assert_eq!(core.active_monitor_id, Some("MON2".to_string()));
    }

    #[test]
    fn test_moving_rule_hot_unplug() {
        let mut core = IslandCore::new();
        core.active_monitor_id = Some("MON_UNPLUGGED".to_string());

        let mon1 = MonitorInfo {
            id: "MON1".to_string(),
            name: "Primary".to_string(),
            is_primary: true,
            rect: Rect::new(0, 0, 1920, 1080),
            work_area: Rect::new(0, 0, 1920, 1040),
            scale_factor: 1.0,
        };

        // Active monitor disconnected: only MON1 remains
        let state = PlatformState {
            monitors: vec![mon1.clone()],
            foreground_window: None,
            cursor_pos: None,
            active_monitor_id: Some("MON1".to_string()),
            is_idle: false,
            idle_ms: 0,
            is_game_mode: false,
            quns_state: 5,
        };

        // Should IMMEDIATELY place window on MON1 (no debounce wait on hot-unplug)
        let fx = core.handle_input(Input::PlatformContext(Box::new(state)), 1000);
        assert!(fx.iter().any(|f| match f {
            Effect::PlaceWindow { monitor_id, .. } => monitor_id == "MON1",
            _ => false,
        }));
        assert_eq!(core.active_monitor_id, Some("MON1".to_string()));
    }

    #[test]
    fn test_smart_skip_not_queued() {
        let mut core = IslandCore::new();
        core.smart_skip_enabled = true;

        // User is currently looking at Claude Desktop
        let state = PlatformState {
            monitors: vec![],
            foreground_window: Some(WindowSummary {
                hwnd: 100,
                title: "Claude".to_string(),
                process_name: "claude.exe".to_string(),
                rect: Rect::new(0, 0, 1000, 800),
                is_valid: true,
            }),
            cursor_pos: None,
            active_monitor_id: None,
            is_idle: false,
            idle_ms: 1000,
            is_game_mode: false,
            quns_state: 5,
        };
        core.handle_input(Input::PlatformContext(Box::new(state)), 1000);

        let mut ev = make_test_event(Uuid::new_v4(), Kind::Done);
        ev.source = Source::Claude;
        ev.surface = Surface::Desktop;

        // Ingest event: user is looking and not idle -> dropped!
        core.handle_input(Input::EventAccepted(Box::new(ev)), 1050);
        assert_eq!(core.unread_count(), 0);
        assert!(!core.is_displaying());
    }

    #[test]
    fn test_auto_read() {
        let mut core = IslandCore::new();

        let mut ev = make_test_event(Uuid::new_v4(), Kind::Done);
        ev.source = Source::Claude;
        ev.surface = Surface::Desktop;

        // Event queued when not looking
        core.handle_input(Input::EventAccepted(Box::new(ev.clone())), 1000);
        core.handle_input(Input::Tick, 4001); // expires to unread
        assert_eq!(core.unread_count(), 1);

        // User now focuses Claude window -> auto-read triggers!
        let state = PlatformState {
            monitors: vec![],
            foreground_window: Some(WindowSummary {
                hwnd: 100,
                title: "Claude".to_string(),
                process_name: "claude.exe".to_string(),
                rect: Rect::new(0, 0, 1000, 800),
                is_valid: true,
            }),
            cursor_pos: None,
            active_monitor_id: None,
            is_idle: false,
            idle_ms: 0,
            is_game_mode: false,
            quns_state: 5,
        };
        let fx = core.handle_input(Input::PlatformContext(Box::new(state)), 5000);
        assert!(fx.iter().any(|f| match f {
            Effect::PersistRemove(id, res) => *id == ev.id && *res == "auto_read",
            _ => false,
        }));
        assert_eq!(core.unread_count(), 0);
    }

    #[test]
    fn test_game_mode_schedule() {
        let mut core = IslandCore::new();
        let ev = make_test_event(Uuid::new_v4(), Kind::Done);
        core.handle_input(Input::EventAccepted(Box::new(ev)), 1000);
        core.handle_input(Input::Tick, 4001);
        assert_eq!(core.unread_count(), 1);

        // Enter game mode at t=5000
        let state = PlatformState {
            monitors: vec![],
            foreground_window: None,
            cursor_pos: None,
            active_monitor_id: None,
            is_idle: false,
            idle_ms: 0,
            is_game_mode: true,
            quns_state: 3,
        };
        core.handle_input(Input::PlatformContext(Box::new(state.clone())), 5000);

        // Dot should be visible for 10s (until t=15000)
        assert!(matches!(
            core.current_view_model(6000),
            ViewModel::Dot { .. }
        ));

        // After 10s (t=15001), dot hides
        core.handle_input(Input::Tick, 15001);
        assert!(matches!(core.current_view_model(15001), ViewModel::Hidden));

        // After 60s (t=75001), dot reappears for 3s
        core.handle_input(Input::Tick, 75001);
        assert!(matches!(
            core.current_view_model(75001),
            ViewModel::Dot { .. }
        ));

        // Leaves game mode -> dot visible immediately
        let mut normal_state = state;
        normal_state.is_game_mode = false;
        core.handle_input(Input::PlatformContext(Box::new(normal_state)), 76000);
        assert!(matches!(
            core.current_view_model(76000),
            ViewModel::Dot { .. }
        ));
    }

    #[test]
    fn test_popup_persists_across_focus_changes_and_desktop_switch() {
        for duration_ms in [2000_u64, 4000_u64, 8000_u64] {
            let mut core = IslandCore::new();
            core.handle_input(
                Input::DisplaySettingsChanged {
                    display_ms: duration_ms,
                },
                0,
            );

            let mut ev = make_test_event(Uuid::new_v4(), Kind::Done);
            ev.source = Source::Claude;
            ev.surface = Surface::Desktop;
            ev.target = Target::Process {
                process_names: vec!["claude.exe".to_string()],
                window_title_contains: None,
            };

            // Show popup at t=1000
            core.handle_input(Input::EventAccepted(Box::new(ev.clone())), 1000);
            assert!(matches!(
                core.current_view_model(1000),
                ViewModel::Pill { .. }
            ));

            // User switches focus to Claude desktop app at t=1500
            let desktop_focus_state = PlatformState {
                monitors: vec![],
                foreground_window: Some(WindowSummary {
                    hwnd: 100,
                    title: "Claude".to_string(),
                    process_name: "claude.exe".to_string(),
                    rect: Rect::new(0, 0, 1200, 800),
                    is_valid: true,
                }),
                cursor_pos: None,
                active_monitor_id: None,
                is_idle: false,
                idle_ms: 0,
                is_game_mode: false,
                quns_state: 5,
            };
            let fx_focus = core.handle_input(
                Input::PlatformContext(Box::new(desktop_focus_state.clone())),
                1500,
            );
            assert!(!fx_focus
                .iter()
                .any(|f| matches!(f, Effect::PersistRemove(_, _))));
            assert!(matches!(
                core.current_view_model(1500),
                ViewModel::Pill { .. }
            ));

            // Also test web focus report mid-display
            core.handle_input(
                Input::WebFocus(WebFocusReport {
                    active_tab_id: 1,
                    active_window_id: 1,
                    active_url: None,
                    is_browser_focused: true,
                }),
                1800,
            );
            assert!(matches!(
                core.current_view_model(1800),
                ViewModel::Pill { .. }
            ));

            // Still showing right before configured duration expires
            let just_before = 1000 + duration_ms - 50;
            core.handle_input(Input::Tick, just_before);
            assert!(matches!(
                core.current_view_model(just_before),
                ViewModel::Pill { .. }
            ));

            // Dismisses to dot (unread) only after configured duration elapses
            let expired_at = 1000 + duration_ms;
            core.handle_input(Input::Tick, expired_at);
            assert!(matches!(
                core.current_view_model(expired_at),
                ViewModel::Dot { .. }
            ));
            assert_eq!(core.unread_count(), 1);
        }
    }

    #[test]
    fn test_smart_skip_default_enabled_and_web_outside_vs_inside() {
        let mut core = IslandCore::new();
        assert!(core.smart_skip_enabled);

        // User is inside Chrome looking at tab 42
        let chrome_fg = PlatformState {
            monitors: vec![],
            foreground_window: Some(WindowSummary {
                hwnd: 100,
                title: "Claude - Google Chrome".to_string(),
                process_name: "chrome.exe".to_string(),
                rect: Rect::new(0, 0, 1200, 800),
                is_valid: true,
            }),
            cursor_pos: None,
            active_monitor_id: None,
            is_idle: false,
            idle_ms: 0,
            is_game_mode: false,
            quns_state: 5,
        };
        core.handle_input(Input::PlatformContext(Box::new(chrome_fg)), 1000);
        core.handle_input(
            Input::WebFocus(WebFocusReport {
                active_tab_id: 42,
                active_window_id: 1,
                active_url: None,
                is_browser_focused: true,
            }),
            1000,
        );

        let mut ev_inside = make_test_event(Uuid::new_v4(), Kind::Done);
        ev_inside.target = Target::BrowserTab {
            tab_id: 42,
            window_id: 1,
            url: None,
        };
        core.handle_input(Input::EventAccepted(Box::new(ev_inside)), 1100);
        assert!(!core.is_displaying());
        assert_eq!(core.unread_count(), 0);

        // User switches to another desktop app (outside Chrome) -> tab 42 event notifies!
        let vscode_fg = PlatformState {
            monitors: vec![],
            foreground_window: Some(WindowSummary {
                hwnd: 200,
                title: "VS Code".to_string(),
                process_name: "Code.exe".to_string(),
                rect: Rect::new(0, 0, 1200, 800),
                is_valid: true,
            }),
            cursor_pos: None,
            active_monitor_id: None,
            is_idle: false,
            idle_ms: 0,
            is_game_mode: false,
            quns_state: 5,
        };
        core.handle_input(Input::PlatformContext(Box::new(vscode_fg)), 2000);

        let mut ev_outside = make_test_event(Uuid::new_v4(), Kind::Done);
        ev_outside.target = Target::BrowserTab {
            tab_id: 42,
            window_id: 1,
            url: None,
        };
        core.handle_input(Input::EventAccepted(Box::new(ev_outside)), 2100);
        assert!(core.is_displaying());
        assert!(matches!(
            core.current_view_model(2100),
            ViewModel::Pill { .. }
        ));
    }
}
