#[cfg(windows)]
pub fn focus_window(hwnd: isize) -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        FlashWindowEx, IsIconic, SetForegroundWindow, ShowWindow, FLASHWINFO, FLASHW_ALL,
        FLASHW_TIMERNOFG, SW_RESTORE,
    };

    let hwnd = HWND(hwnd as _);
    unsafe {
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }

        if SetForegroundWindow(hwnd).as_bool() {
            return true;
        }

        // Fallback: FlashWindowEx
        let flash = FLASHWINFO {
            cbSize: std::mem::size_of::<FLASHWINFO>() as u32,
            hwnd,
            dwFlags: FLASHW_ALL | FLASHW_TIMERNOFG,
            uCount: 3,
            dwTimeout: 0,
        };
        let _ = FlashWindowEx(&flash);
        false
    }
}

#[cfg(not(windows))]
pub fn focus_window(_hwnd: isize) -> bool {
    true
}

#[cfg(windows)]
pub fn find_window_by_process_and_title(
    target_process: &str,
    target_title_contains: Option<&str>,
) -> Option<isize> {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows::Win32::System::ProcessStatus::GetProcessImageFileNameW;
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
    };

    struct SearchContext {
        target_process: String,
        target_title: Option<String>,
        found_hwnd: Option<isize>,
    }

    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = &mut *(lparam.0 as *mut SearchContext);

        if !IsWindowVisible(hwnd).as_bool() {
            return BOOL(1);
        }

        let mut pid: u32 = 0;
        let _ = GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return BOOL(1);
        }

        let mut process_matches = false;
        if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            let mut path_buf = [0u16; 1024];
            let len = GetProcessImageFileNameW(handle, &mut path_buf);
            if len > 0 {
                let full = String::from_utf16_lossy(&path_buf[..len as usize]);
                if let Some(file_name) = full.rsplit('\\').next() {
                    if file_name.eq_ignore_ascii_case(&ctx.target_process) {
                        process_matches = true;
                    }
                }
            }
            let _ = windows::Win32::Foundation::CloseHandle(handle);
        }

        if !process_matches {
            return BOOL(1);
        }

        if let Some(ref title_sub) = ctx.target_title {
            let mut title_buf = [0u16; 512];
            let t_len = GetWindowTextW(hwnd, &mut title_buf);
            let title = if t_len > 0 {
                String::from_utf16_lossy(&title_buf[..t_len as usize])
            } else {
                String::new()
            };

            if !title.to_lowercase().contains(&title_sub.to_lowercase()) {
                return BOOL(1);
            }
        }

        ctx.found_hwnd = Some(hwnd.0 as isize);
        BOOL(0) // stop enumeration
    }

    let mut ctx = SearchContext {
        target_process: target_process.to_string(),
        target_title: target_title_contains.map(|s| s.to_string()),
        found_hwnd: None,
    };

    unsafe {
        let lparam = LPARAM(&mut ctx as *mut SearchContext as isize);
        let _ = EnumWindows(Some(enum_proc), lparam);
    }

    ctx.found_hwnd
}

#[cfg(not(windows))]
pub fn find_window_by_process_and_title(
    _target_process: &str,
    _target_title_contains: Option<&str>,
) -> Option<isize> {
    None
}
