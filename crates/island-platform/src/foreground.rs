use crate::geometry::Rect;
use crate::monitor::WindowSummary;

pub fn is_window_valid_for_selection(
    class_name: &str,
    process_name: &str,
    rect: &Rect,
    island_pid: u32,
    window_pid: u32,
) -> bool {
    // Exclude Island's own windows
    if window_pid == island_pid && process_name.to_lowercase().contains("island") {
        return false;
    }

    // Exclude Windows shell / desktop surfaces
    if class_name == "Progman" || class_name == "WorkerW" {
        return false;
    }

    // Windows Shell Tray (taskbar) is valid per spec §1.3
    if class_name == "Shell_TrayWnd" {
        return true;
    }

    // Must have non-empty geometry
    if rect.is_empty() {
        return false;
    }

    true
}

#[cfg(windows)]
pub fn get_foreground_window_summary(island_pid: u32) -> Option<WindowSummary> {
    use std::mem::zeroed;
    use windows::Win32::Foundation::RECT;
    use windows::Win32::System::ProcessStatus::GetProcessImageFileNameW;
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowRect, GetWindowTextW,
        GetWindowThreadProcessId, IsWindowVisible,
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() || !IsWindowVisible(hwnd).as_bool() {
            return None;
        }

        let mut rect_raw: RECT = zeroed();
        let _ = GetWindowRect(hwnd, &mut rect_raw);
        let rect = Rect::new(rect_raw.left, rect_raw.top, rect_raw.right, rect_raw.bottom);

        let mut class_buf = [0u16; 256];
        let class_len = GetClassNameW(hwnd, &mut class_buf);
        let class_name = if class_len > 0 {
            String::from_utf16_lossy(&class_buf[..class_len as usize])
        } else {
            String::new()
        };

        let mut title_buf = [0u16; 512];
        let title_len = GetWindowTextW(hwnd, &mut title_buf);
        let title = if title_len > 0 {
            String::from_utf16_lossy(&title_buf[..title_len as usize])
        } else {
            String::new()
        };

        let mut pid: u32 = 0;
        let _ = GetWindowThreadProcessId(hwnd, Some(&mut pid));

        let mut process_name = String::new();
        if pid > 0 {
            if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                let mut path_buf = [0u16; 1024];
                let path_len = GetProcessImageFileNameW(handle, &mut path_buf);
                if path_len > 0 {
                    let full_path = String::from_utf16_lossy(&path_buf[..path_len as usize]);
                    if let Some(name) = full_path.rsplit('\\').next() {
                        process_name = name.to_string();
                    }
                }
                let _ = windows::Win32::Foundation::CloseHandle(handle);
            }
        }

        let is_valid =
            is_window_valid_for_selection(&class_name, &process_name, &rect, island_pid, pid);

        Some(WindowSummary {
            hwnd: hwnd.0 as isize,
            title,
            process_name,
            rect,
            is_valid,
        })
    }
}

#[cfg(not(windows))]
pub fn get_foreground_window_summary(_island_pid: u32) -> Option<WindowSummary> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_window_filtering() {
        let island_pid = 1000;

        // Desktop window -> invalid
        assert!(!is_window_valid_for_selection(
            "Progman",
            "explorer.exe",
            &Rect::new(0, 0, 1920, 1080),
            island_pid,
            500,
        ));

        // Island window -> invalid
        assert!(!is_window_valid_for_selection(
            "TauriWindow",
            "island.exe",
            &Rect::new(640, 0, 1280, 560),
            island_pid,
            island_pid,
        ));

        // Taskbar -> valid
        assert!(is_window_valid_for_selection(
            "Shell_TrayWnd",
            "explorer.exe",
            &Rect::new(0, 1040, 1920, 1080),
            island_pid,
            500,
        ));

        // Regular browser window -> valid
        assert!(is_window_valid_for_selection(
            "Chrome_WidgetWin_1",
            "chrome.exe",
            &Rect::new(0, 0, 1920, 1040),
            island_pid,
            2345,
        ));

        // Zero-size window -> invalid
        assert!(!is_window_valid_for_selection(
            "Chrome_WidgetWin_1",
            "chrome.exe",
            &Rect::new(0, 0, 0, 0),
            island_pid,
            2345,
        ));
    }
}
