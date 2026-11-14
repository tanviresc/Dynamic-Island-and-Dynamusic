use crate::geometry::Rect;

pub fn calculate_cursor_distance_to_rect(point: (i32, i32), rect: &Rect) -> f64 {
    let (px, py) = point;
    let dx = 0.max((rect.left - px).max(px - rect.right));
    let dy = 0.max((rect.top - py).max(py - rect.bottom));
    ((dx * dx + dy * dy) as f64).sqrt()
}

pub fn client_rect_to_screen_rect(
    client_rect: &Rect,
    window_rect: &Rect,
    scale_factor: f64,
    tolerance_px: i32,
) -> Rect {
    let left =
        window_rect.left + (client_rect.left as f64 * scale_factor).round() as i32 - tolerance_px;
    let top =
        window_rect.top + (client_rect.top as f64 * scale_factor).round() as i32 - tolerance_px;
    let right =
        window_rect.left + (client_rect.right as f64 * scale_factor).round() as i32 + tolerance_px;
    let bottom =
        window_rect.top + (client_rect.bottom as f64 * scale_factor).round() as i32 + tolerance_px;
    Rect::new(left, top, right, bottom)
}

#[cfg(windows)]
pub fn get_window_screen_rect(hwnd: isize) -> Option<Rect> {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

    let hwnd = HWND(hwnd as _);
    let mut raw: RECT = unsafe { std::mem::zeroed() };
    if unsafe { GetWindowRect(hwnd, &mut raw).is_ok() } {
        Some(Rect::new(raw.left, raw.top, raw.right, raw.bottom))
    } else {
        None
    }
}

#[cfg(not(windows))]
pub fn get_window_screen_rect(_hwnd: isize) -> Option<Rect> {
    None
}

#[cfg(windows)]
pub fn get_window_dpi_scale(hwnd: isize) -> f64 {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::HiDpi::GetDpiForWindow;

    let hwnd = HWND(hwnd as _);
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    if dpi > 0 {
        dpi as f64 / 96.0
    } else {
        1.0
    }
}

#[cfg(not(windows))]
pub fn get_window_dpi_scale(_hwnd: isize) -> f64 {
    1.0
}

pub fn get_adaptive_poll_interval_ms(point: (i32, i32), hit_rect: Option<&Rect>) -> u64 {
    let rect = match hit_rect {
        Some(r) if !r.is_empty() => r,
        _ => return 250, // when hidden or no hit rect, idle poll
    };

    let dist = calculate_cursor_distance_to_rect(point, rect);
    if dist < 80.0 {
        33 // near or inside: high responsiveness (30 fps)
    } else {
        100 // far: low CPU overhead
    }
}

#[cfg(windows)]
pub fn update_window_clickthrough(hwnd: isize, cursor_in_hit_rect: bool) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongW, SetWindowLongW, SetWindowPos, GWL_EXSTYLE, SWP_FRAMECHANGED,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_EX_TRANSPARENT,
    };

    let hwnd = HWND(hwnd as _);
    unsafe {
        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
        let has_transparent = (ex_style & WS_EX_TRANSPARENT.0 as i32) != 0;

        if cursor_in_hit_rect && has_transparent {
            // Remove WS_EX_TRANSPARENT so window receives mouse events
            SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style & !(WS_EX_TRANSPARENT.0 as i32));
            let _ = SetWindowPos(
                hwnd,
                HWND(std::ptr::null_mut()),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        } else if !cursor_in_hit_rect && !has_transparent {
            // Add WS_EX_TRANSPARENT so mouse events pass through to apps underneath
            SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style | WS_EX_TRANSPARENT.0 as i32);
            let _ = SetWindowPos(
                hwnd,
                HWND(std::ptr::null_mut()),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
    }
}

#[cfg(not(windows))]
pub fn update_window_clickthrough(_hwnd: isize, _cursor_in_hit_rect: bool) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_adaptive_polling_distance() {
        let hit_rect = Rect::new(600, 10, 1000, 50);

        // Point inside
        assert_eq!(
            get_adaptive_poll_interval_ms((700, 30), Some(&hit_rect)),
            33
        );

        // Point near (30px away)
        assert_eq!(
            get_adaptive_poll_interval_ms((700, 80), Some(&hit_rect)),
            33
        );

        // Point far (300px away)
        assert_eq!(
            get_adaptive_poll_interval_ms((700, 350), Some(&hit_rect)),
            100
        );

        // Hidden (None)
        assert_eq!(get_adaptive_poll_interval_ms((700, 30), None), 250);
    }

    #[test]
    fn test_client_rect_to_screen_rect_translation() {
        let window_rect = Rect::new(520, 0, 1240, 500);
        let client_rect = Rect::new(200, 25, 480, 53);

        // 1.0x scale, 4px tolerance
        let screen = client_rect_to_screen_rect(&client_rect, &window_rect, 1.0, 4);
        assert_eq!(screen.left, 520 + 200 - 4);
        assert_eq!(screen.top, 25 - 4);
        assert_eq!(screen.right, 520 + 480 + 4);
        assert_eq!(screen.bottom, 53 + 4);

        // Outside window / left desktop area
        assert!(!screen.contains_point(300, 30));
        // Inside pill on screen
        assert!(screen.contains_point(750, 30));
    }
}
