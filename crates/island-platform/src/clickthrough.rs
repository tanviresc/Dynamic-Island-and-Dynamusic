use crate::geometry::Rect;

pub fn calculate_cursor_distance_to_rect(point: (i32, i32), rect: &Rect) -> f64 {
    let (px, py) = point;
    let dx = 0.max((rect.left - px).max(px - rect.right));
    let dy = 0.max((rect.top - py).max(py - rect.bottom));
    ((dx * dx + dy * dy) as f64).sqrt()
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
        GetWindowLongW, SetWindowLongW, GWL_EXSTYLE, WS_EX_TRANSPARENT,
    };

    let hwnd = HWND(hwnd as _);
    unsafe {
        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
        let has_transparent = (ex_style & WS_EX_TRANSPARENT.0 as i32) != 0;

        if cursor_in_hit_rect && has_transparent {
            // Remove WS_EX_TRANSPARENT so window receives mouse events
            SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style & !(WS_EX_TRANSPARENT.0 as i32));
        } else if !cursor_in_hit_rect && !has_transparent {
            // Add WS_EX_TRANSPARENT so mouse events pass through to apps underneath
            SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style | WS_EX_TRANSPARENT.0 as i32);
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
}
