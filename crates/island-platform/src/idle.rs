pub fn is_user_idle(idle_duration_ms: u64, threshold_minutes: u32) -> bool {
    let threshold_ms = (threshold_minutes as u64) * 60_000;
    idle_duration_ms >= threshold_ms
}

#[cfg(windows)]
pub fn get_idle_duration_ms() -> u64 {
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    unsafe {
        let mut info = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if GetLastInputInfo(&mut info).as_bool() {
            let now = GetTickCount();
            (now.saturating_sub(info.dwTime)) as u64
        } else {
            0
        }
    }
}

#[cfg(not(windows))]
pub fn get_idle_duration_ms() -> u64 {
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_idle_threshold() {
        let three_minutes_ms = 3 * 60 * 1000;

        assert!(!is_user_idle(three_minutes_ms - 1, 3));
        assert!(is_user_idle(three_minutes_ms, 3));
        assert!(is_user_idle(three_minutes_ms + 1000, 3));
        assert!(!is_user_idle(1000, 1));
    }
}
