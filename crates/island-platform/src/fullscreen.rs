use crate::geometry::Rect;
use crate::monitor::WindowSummary;

pub const QUNS_NOT_PRESENT: u32 = 1;
pub const QUNS_BUSY: u32 = 2;
pub const QUNS_RUNNING_D3D_FULL_SCREEN: u32 = 3;
pub const QUNS_PRESENTATION_MODE: u32 = 4;
pub const QUNS_ACCEPTS_NOTIFICATIONS: u32 = 5;
pub const QUNS_QUIET_TIME: u32 = 6;
pub const QUNS_APP: u32 = 7;

pub fn is_game_mode_active(
    island_monitor_rect: &Rect,
    foreground: Option<&WindowSummary>,
    quns_state: u32,
) -> bool {
    let fg = match foreground {
        Some(f) if f.is_valid => f,
        _ => return false,
    };

    // (a) Rect check: valid foreground window covers the whole island monitor (1px tolerance)
    if fg.rect.covers(island_monitor_rect, 1) {
        return true;
    }

    // (b) System state: QUNS_RUNNING_D3D_FULL_SCREEN or QUNS_PRESENTATION_MODE
    // AND the foreground window is on the island monitor
    if quns_state == QUNS_RUNNING_D3D_FULL_SCREEN || quns_state == QUNS_PRESENTATION_MODE {
        if let Some(inter) = fg.rect.intersection(island_monitor_rect) {
            if inter.area() > 0 {
                return true;
            }
        }
    }

    // QUNS_BUSY alone does NOT turn game mode on per spec §1.7
    false
}

#[cfg(windows)]
pub fn query_user_notification_state() -> u32 {
    use windows::Win32::UI::Shell::SHQueryUserNotificationState;
    unsafe {
        match SHQueryUserNotificationState() {
            Ok(state) => state.0 as u32,
            Err(_) => QUNS_ACCEPTS_NOTIFICATIONS,
        }
    }
}

#[cfg(not(windows))]
pub fn query_user_notification_state() -> u32 {
    QUNS_ACCEPTS_NOTIFICATIONS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_game_mode_rect_check() {
        let island_monitor = Rect::new(0, 0, 1920, 1080);

        // Exact fullscreen window
        let fg_full = WindowSummary {
            hwnd: 100,
            title: "Game".to_string(),
            process_name: "game.exe".to_string(),
            rect: Rect::new(0, 0, 1920, 1080),
            is_valid: true,
        };
        assert!(is_game_mode_active(
            &island_monitor,
            Some(&fg_full),
            QUNS_ACCEPTS_NOTIFICATIONS
        ));

        // 1px tolerance window
        let fg_1px = WindowSummary {
            hwnd: 100,
            title: "Game".to_string(),
            process_name: "game.exe".to_string(),
            rect: Rect::new(1, 1, 1919, 1079),
            is_valid: true,
        };
        assert!(is_game_mode_active(
            &island_monitor,
            Some(&fg_1px),
            QUNS_ACCEPTS_NOTIFICATIONS
        ));

        // Window on another monitor (e.g. secondary monitor -2560 to 0)
        let fg_other_mon = WindowSummary {
            hwnd: 200,
            title: "Video".to_string(),
            process_name: "vlc.exe".to_string(),
            rect: Rect::new(-2560, 0, 0, 1440),
            is_valid: true,
        };
        // Should NOT put island monitor into game mode
        assert!(!is_game_mode_active(
            &island_monitor,
            Some(&fg_other_mon),
            QUNS_ACCEPTS_NOTIFICATIONS
        ));
    }

    #[test]
    fn test_game_mode_quns_busy_rule() {
        let island_monitor = Rect::new(0, 0, 1920, 1080);

        // Normal window (not covering monitor) with QUNS_BUSY -> should be FALSE
        let fg_normal = WindowSummary {
            hwnd: 100,
            title: "Docs".to_string(),
            process_name: "word.exe".to_string(),
            rect: Rect::new(100, 100, 1200, 800),
            is_valid: true,
        };
        assert!(!is_game_mode_active(
            &island_monitor,
            Some(&fg_normal),
            QUNS_BUSY
        ));

        // Normal window with QUNS_RUNNING_D3D_FULL_SCREEN on island monitor -> TRUE
        assert!(is_game_mode_active(
            &island_monitor,
            Some(&fg_normal),
            QUNS_RUNNING_D3D_FULL_SCREEN
        ));

        // Normal window with QUNS_RUNNING_D3D_FULL_SCREEN on OTHER monitor -> FALSE
        let fg_other = WindowSummary {
            hwnd: 100,
            title: "Docs".to_string(),
            process_name: "word.exe".to_string(),
            rect: Rect::new(-2000, 100, -1000, 800),
            is_valid: true,
        };
        assert!(!is_game_mode_active(
            &island_monitor,
            Some(&fg_other),
            QUNS_RUNNING_D3D_FULL_SCREEN
        ));
    }
}
