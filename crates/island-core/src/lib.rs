use island_contract::{Event, Kind, Source, Target};
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

#[derive(Debug, Clone, PartialEq, Eq)]
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
    ContextChanged { is_game_mode: bool, is_idle: bool },
    PauseToggled(bool),
    DndToggled(bool),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Effect {
    Render(ViewModel),
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
}

impl Default for IslandCore {
    fn default() -> Self {
        Self {
            display_queue: VecDeque::new(),
            current_display: None,
            unread_queue: Vec::new(),
            is_queue_panel_open: false,
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

    pub fn current_view_model(&self, now: Millis) -> ViewModel {
        if self.is_paused {
            return ViewModel::Hidden;
        }

        if self.is_queue_panel_open {
            return ViewModel::Queue {
                items: self
                    .unread_queue
                    .iter()
                    .map(|it| QueueItemView {
                        id: it.id,
                        source: it.source,
                        kind: it.kind,
                        title: it.title.clone(),
                        text: it.text.clone(),
                        category: it.category.clone(),
                        created_at: it.created_at.to_string(),
                    })
                    .collect(),
            };
        }

        if self.is_game_mode {
            if let Some(until) = self.game_dot_until {
                if now < until && !self.unread_queue.is_empty() {
                    return ViewModel::Dot {
                        color: self.compute_dot_color(),
                    };
                }
            }
            return ViewModel::Hidden;
        }

        if self.is_dnd {
            if !self.unread_queue.is_empty() {
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

        if !self.unread_queue.is_empty() {
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

        if self.is_game_mode {
            if let Some(until) = self.game_dot_until {
                if until > now {
                    deadlines.push(until);
                }
            }
            if let Some(next_at) = self.game_next_dot_at {
                if next_at > now {
                    deadlines.push(next_at);
                }
            }
        }

        deadlines.into_iter().min()
    }

    pub fn handle_input(&mut self, input: Input, now: Millis) -> Vec<Effect> {
        let mut effects = Vec::new();

        match input {
            Input::EventAccepted(event) => {
                let event = *event;
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
                    group_key: Some(event.dedupe_key),
                    group_count: 1,
                    state: NotificationState::Pending,
                    external_ref: None,
                    created_at: event.created_at.timestamp_millis(),
                    received_at: now as i64,
                    expires_at: None,
                };

                // Check grouping burst (only done and new_mail merge)
                let mut merged = false;
                if stored.kind == Kind::Done || stored.kind == Kind::NewMail {
                    // Check if current displaying item can merge
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
                            effects.push(Effect::PersistSave(disp.item.clone()));
                        }
                    }
                }

                if !merged {
                    if self.is_paused || self.is_dnd || self.is_game_mode {
                        let mut item = stored;
                        item.state = NotificationState::Unread;
                        self.push_unread(item.clone(), &mut effects);
                        effects.push(Effect::PersistSave(item));
                    } else if self.current_display.is_none() {
                        // Start display immediately
                        let mut item = stored;
                        item.state = NotificationState::Displaying;
                        self.current_display = Some(DisplayingItem {
                            item: item.clone(),
                            started_at: now,
                            deadline: now + self.display_ms,
                            is_hovered: false,
                            hover_remaining_ms: None,
                        });
                        effects.push(Effect::PersistSave(item));
                    } else {
                        // Queue in display queue
                        // needs_input and error jump ahead of done and new_mail
                        let is_urgent =
                            stored.kind == Kind::NeedsInput || stored.kind == Kind::Error;
                        if is_urgent {
                            let insert_idx = self
                                .display_queue
                                .iter()
                                .position(|it| {
                                    it.kind != Kind::NeedsInput && it.kind != Kind::Error
                                })
                                .unwrap_or(self.display_queue.len());
                            self.display_queue.insert(insert_idx, stored.clone());
                        } else {
                            self.display_queue.push_back(stored.clone());
                        }
                        effects.push(Effect::PersistSave(stored));
                    }
                }
            }

            Input::Tick => {
                if let Some(ref disp) = self.current_display {
                    if !disp.is_hovered && now >= disp.deadline {
                        // Display timer expired, move item to unread
                        let mut item = disp.item.clone();
                        item.state = NotificationState::Unread;
                        self.current_display = None;
                        self.push_unread(item.clone(), &mut effects);
                        effects.push(Effect::PersistUpdateState(
                            item.id,
                            NotificationState::Unread,
                        ));

                        // Check next item in display queue
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
                            self.game_next_dot_at = None;
                        }
                    }
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

                    // Advance to next pending in display queue
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
                self.is_queue_panel_open = true;
            }

            Input::QueueItemClicked(id) => {
                if let Some(idx) = self.unread_queue.iter().position(|it| it.id == id) {
                    let item = self.unread_queue.remove(idx);
                    effects.push(Effect::Jump(item.target));
                    effects.push(Effect::PersistRemove(item.id, "clicked"));
                    if self.unread_queue.is_empty() {
                        self.is_queue_panel_open = false;
                    }
                }
            }

            Input::QueueClear => {
                self.unread_queue.clear();
                self.is_queue_panel_open = false;
                effects.push(Effect::PersistClearAll("cleared"));
            }

            Input::QueueClose => {
                self.is_queue_panel_open = false;
            }

            Input::ContextChanged { is_game_mode, .. } => {
                self.is_game_mode = is_game_mode;
                if is_game_mode && !self.unread_queue.is_empty() {
                    self.game_dot_until = Some(now + 10000);
                    self.game_next_dot_at = None;
                }
            }

            Input::PauseToggled(paused) => {
                self.is_paused = paused;
            }

            Input::DndToggled(dnd) => {
                self.is_dnd = dnd;
            }
        }

        effects.push(Effect::Render(self.current_view_model(now)));
        effects
    }

    fn push_unread(&mut self, item: StoredNotification, effects: &mut Vec<Effect>) {
        self.unread_queue.insert(0, item);

        // Cap enforcement (200 max, oldest done/new_mail dropped first)
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

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use island_contract::{Source, Surface, Target};

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

        // Accept event at t=1000
        let _fx = core.handle_input(Input::EventAccepted(Box::new(ev)), 1000);
        assert!(matches!(
            core.current_view_model(1000),
            ViewModel::Pill { .. }
        ));

        // Hover at t=2000 (after 1000ms display)
        core.handle_input(Input::HoverEnter, 2000);

        // Advance to t=5000: still hovering, should not expire
        core.handle_input(Input::Tick, 5000);
        assert!(matches!(
            core.current_view_model(5000),
            ViewModel::Pill { .. }
        ));

        // Hover leave at t=5000: remaining was 2000ms, should resume until t=7000
        core.handle_input(Input::HoverLeave, 5000);

        // Tick at t=6000: still displaying
        core.handle_input(Input::Tick, 6000);
        assert!(matches!(
            core.current_view_model(6000),
            ViewModel::Pill { .. }
        ));

        // Tick at t=7001: expired -> becomes unread dot
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
        core.handle_input(Input::Tick, 4001); // expires to unread
        assert_eq!(core.compute_dot_color(), COLOR_GREEN);

        let input_ev = make_test_event(Uuid::new_v4(), Kind::NeedsInput);
        core.handle_input(Input::EventAccepted(Box::new(input_ev)), 5000);
        core.handle_input(Input::Tick, 8001); // expires to unread
                                              // Blue wins over green
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
}
