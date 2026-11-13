use crate::geometry::Rect;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MonitorInfo {
    pub id: String,
    pub name: String,
    pub is_primary: bool,
    pub rect: Rect,
    pub work_area: Rect,
    pub scale_factor: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowSummary {
    pub hwnd: isize,
    pub title: String,
    pub process_name: String,
    pub rect: Rect,
    pub is_valid: bool,
}

pub fn select_active_monitor(
    monitors: &[MonitorInfo],
    foreground_window: Option<&WindowSummary>,
    cursor_pos: Option<(i32, i32)>,
    fixed_monitor_id: Option<&str>,
    follow_active_monitor: bool,
) -> Option<String> {
    if monitors.is_empty() {
        return None;
    }

    // 1. Fixed monitor rule
    if !follow_active_monitor {
        if let Some(fixed_id) = fixed_monitor_id {
            if monitors.iter().any(|m| m.id == fixed_id) {
                return Some(fixed_id.to_string());
            }
        }
    }

    // 2. Valid foreground window largest intersection
    if let Some(fg) = foreground_window {
        if fg.is_valid && !fg.rect.is_empty() {
            let mut best_monitor: Option<&MonitorInfo> = None;
            let mut best_area: i64 = 0;

            for mon in monitors {
                if let Some(inter) = mon.rect.intersection(&fg.rect) {
                    let area = inter.area();
                    if area > best_area {
                        best_area = area;
                        best_monitor = Some(mon);
                    }
                }
            }

            if let Some(best) = best_monitor {
                return Some(best.id.clone());
            }
        }
    }

    // 3. Monitor under cursor
    if let Some((cx, cy)) = cursor_pos {
        for mon in monitors {
            if mon.rect.contains_point(cx, cy) {
                return Some(mon.id.clone());
            }
        }
    }

    // 4. Primary monitor fallback
    if let Some(primary) = monitors.iter().find(|m| m.is_primary) {
        return Some(primary.id.clone());
    }

    // 5. First monitor fallback
    Some(monitors[0].id.clone())
}

#[cfg(windows)]
pub fn enumerate_monitors() -> Vec<MonitorInfo> {
    use std::mem::zeroed;
    use windows::Win32::Foundation::{BOOL, LPARAM, RECT};
    use windows::Win32::Graphics::Gdi::{
        EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFOEXW,
    };
    use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};

    let mut monitors = Vec::new();

    unsafe extern "system" fn monitor_enum_proc(
        hmonitor: HMONITOR,
        _hdc: HDC,
        _rect: *mut RECT,
        lparam: LPARAM,
    ) -> BOOL {
        let list = &mut *(lparam.0 as *mut Vec<MonitorInfo>);
        let mut info: MONITORINFOEXW = unsafe { zeroed() };
        info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;

        if unsafe {
            GetMonitorInfoW(
                hmonitor,
                &mut info as *mut MONITORINFOEXW as *mut windows::Win32::Graphics::Gdi::MONITORINFO,
            )
        }
        .as_bool()
        {
            let is_primary = (info.monitorInfo.dwFlags & 1) != 0;
            let r = info.monitorInfo.rcMonitor;
            let w = info.monitorInfo.rcWork;

            let rect = Rect::new(r.left, r.top, r.right, r.bottom);
            let work_area = Rect::new(w.left, w.top, w.right, w.bottom);

            let dev_name = String::from_utf16_lossy(
                &info.szDevice[..info
                    .szDevice
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(info.szDevice.len())],
            );

            let mut dpi_x: u32 = 96;
            let mut dpi_y: u32 = 96;
            let _ =
                unsafe { GetDpiForMonitor(hmonitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y) };
            let scale_factor = (dpi_x as f64) / 96.0;

            list.push(MonitorInfo {
                id: dev_name.clone(),
                name: format!("Display {}", list.len() + 1),
                is_primary,
                rect,
                work_area,
                scale_factor,
            });
        }

        BOOL(1)
    }

    unsafe {
        let lparam = LPARAM(&mut monitors as *mut Vec<MonitorInfo> as isize);
        let _ = EnumDisplayMonitors(
            HDC(std::ptr::null_mut()),
            None,
            Some(monitor_enum_proc),
            lparam,
        );
    }

    monitors
}

#[cfg(not(windows))]
pub fn enumerate_monitors() -> Vec<MonitorInfo> {
    vec![MonitorInfo {
        id: "default-display".to_string(),
        name: "Default Display".to_string(),
        is_primary: true,
        rect: Rect::new(0, 0, 1920, 1080),
        work_area: Rect::new(0, 0, 1920, 1040),
        scale_factor: 1.0,
    }]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_monitors() -> Vec<MonitorInfo> {
        vec![
            MonitorInfo {
                id: r"\\.\DISPLAY1".to_string(),
                name: "Primary".to_string(),
                is_primary: true,
                rect: Rect::new(0, 0, 1920, 1080),
                work_area: Rect::new(0, 0, 1920, 1040),
                scale_factor: 1.0,
            },
            MonitorInfo {
                id: r"\\.\DISPLAY2".to_string(),
                name: "Secondary Left".to_string(),
                is_primary: false,
                rect: Rect::new(-2560, 0, 0, 1440),
                work_area: Rect::new(-2560, 0, 0, 1400),
                scale_factor: 1.5,
            },
        ]
    }

    #[test]
    fn test_select_fixed_monitor() {
        let monitors = make_test_monitors();

        // Connected fixed monitor
        let selected = select_active_monitor(
            &monitors,
            None,
            None,
            Some(r"\\.\DISPLAY2"),
            false, // follow = false
        );
        assert_eq!(selected, Some(r"\\.\DISPLAY2".to_string()));

        // Disconnected fixed monitor -> falls back to primary
        let selected_disc = select_active_monitor(
            &monitors,
            None,
            None,
            Some(r"\\.\DISPLAY_NONEXISTENT"),
            false,
        );
        assert_eq!(selected_disc, Some(r"\\.\DISPLAY1".to_string()));
    }

    #[test]
    fn test_select_foreground_intersection() {
        let monitors = make_test_monitors();

        // Window mostly on Display 2 (-2560 to 0)
        let fg_win = WindowSummary {
            hwnd: 1234,
            title: "VS Code".to_string(),
            process_name: "code.exe".to_string(),
            rect: Rect::new(-2000, 100, -200, 1000), // on Display 2
            is_valid: true,
        };

        let selected = select_active_monitor(&monitors, Some(&fg_win), None, None, true);
        assert_eq!(selected, Some(r"\\.\DISPLAY2".to_string()));

        // Invalid window (e.g. desktop shell) -> ignored
        let invalid_win = WindowSummary {
            hwnd: 1,
            title: "".to_string(),
            process_name: "explorer.exe".to_string(),
            rect: Rect::new(-2560, 0, 0, 1440),
            is_valid: false,
        };
        let selected_invalid = select_active_monitor(
            &monitors,
            Some(&invalid_win),
            Some((500, 500)), // cursor on Display 1
            None,
            true,
        );
        // Should fall back to cursor on Display 1
        assert_eq!(selected_invalid, Some(r"\\.\DISPLAY1".to_string()));
    }

    #[test]
    fn test_select_cursor_and_primary_fallback() {
        let monitors = make_test_monitors();

        // No foreground, cursor on Display 2
        let sel_cursor = select_active_monitor(&monitors, None, Some((-500, 500)), None, true);
        assert_eq!(sel_cursor, Some(r"\\.\DISPLAY2".to_string()));

        // No foreground, cursor nowhere -> primary
        let sel_primary = select_active_monitor(&monitors, None, None, None, true);
        assert_eq!(sel_primary, Some(r"\\.\DISPLAY1".to_string()));
    }
}
