pub mod clickthrough;
pub mod foreground;
pub mod fullscreen;
pub mod geometry;
pub mod idle;
pub mod jump;
pub mod monitor;

pub use clickthrough::*;
pub use foreground::*;
pub use fullscreen::*;
pub use geometry::*;
pub use idle::*;
pub use jump::*;
pub use monitor::*;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlatformState {
    pub monitors: Vec<MonitorInfo>,
    pub foreground_window: Option<WindowSummary>,
    pub cursor_pos: Option<(i32, i32)>,
    pub active_monitor_id: Option<String>,
    pub is_idle: bool,
    pub idle_ms: u64,
    pub is_game_mode: bool,
    pub quns_state: u32,
}

#[cfg(windows)]
pub fn get_cursor_pos() -> Option<(i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

    unsafe {
        let mut pt = POINT::default();
        if GetCursorPos(&mut pt).is_ok() {
            Some((pt.x, pt.y))
        } else {
            None
        }
    }
}

#[cfg(not(windows))]
pub fn get_cursor_pos() -> Option<(i32, i32)> {
    None
}

pub fn poll_platform_state(
    island_pid: u32,
    fixed_monitor_id: Option<&str>,
    follow_active_monitor: bool,
    idle_threshold_minutes: u32,
) -> PlatformState {
    let monitors = enumerate_monitors();
    let foreground_window = get_foreground_window_summary(island_pid);
    let cursor_pos = get_cursor_pos();

    let active_monitor_id = select_active_monitor(
        &monitors,
        foreground_window.as_ref(),
        cursor_pos,
        fixed_monitor_id,
        follow_active_monitor,
    );

    let idle_ms = get_idle_duration_ms();
    let is_idle = is_user_idle(idle_ms, idle_threshold_minutes);
    let quns_state = query_user_notification_state();

    let is_game_mode = if let Some(ref act_id) = active_monitor_id {
        if let Some(act_mon) = monitors.iter().find(|m| &m.id == act_id) {
            is_game_mode_active(&act_mon.rect, foreground_window.as_ref(), quns_state)
        } else {
            false
        }
    } else {
        false
    };

    PlatformState {
        monitors,
        foreground_window,
        cursor_pos,
        active_monitor_id,
        is_idle,
        idle_ms,
        is_game_mode,
        quns_state,
    }
}
