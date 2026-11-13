use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl Rect {
    pub const fn new(left: i32, top: i32, right: i32, bottom: i32) -> Self {
        Self {
            left,
            top,
            right,
            bottom,
        }
    }

    pub fn width(&self) -> i32 {
        self.right - self.left
    }

    pub fn height(&self) -> i32 {
        self.bottom - self.top
    }

    pub fn is_empty(&self) -> bool {
        self.left >= self.right || self.top >= self.bottom
    }

    pub fn contains_point(&self, x: i32, y: i32) -> bool {
        x >= self.left && x < self.right && y >= self.top && y < self.bottom
    }

    pub fn intersection(&self, other: &Rect) -> Option<Rect> {
        let left = self.left.max(other.left);
        let top = self.top.max(other.top);
        let right = self.right.min(other.right);
        let bottom = self.bottom.min(other.bottom);

        if left < right && top < bottom {
            Some(Rect {
                left,
                top,
                right,
                bottom,
            })
        } else {
            None
        }
    }

    pub fn area(&self) -> i64 {
        if self.right > self.left && self.bottom > self.top {
            (self.right - self.left) as i64 * (self.bottom - self.top) as i64
        } else {
            0
        }
    }

    pub fn covers(&self, target: &Rect, tolerance_px: i32) -> bool {
        self.left <= target.left + tolerance_px
            && self.top <= target.top + tolerance_px
            && self.right >= target.right - tolerance_px
            && self.bottom >= target.bottom - tolerance_px
    }
}

pub fn calculate_window_position(
    work_area: &Rect,
    logical_width: f64,
    logical_height: f64,
    scale_factor: f64,
    top_margin_logical: f64,
) -> (i32, i32, i32, i32) {
    let physical_width = (logical_width * scale_factor).round() as i32;
    let physical_height = (logical_height * scale_factor).round() as i32;
    let physical_margin = (top_margin_logical * scale_factor).round() as i32;

    let x = work_area.left + (work_area.width() - physical_width) / 2;
    let y = work_area.top + physical_margin;

    (x, y, physical_width, physical_height)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rect_intersection_and_area() {
        let r1 = Rect::new(0, 0, 1920, 1080);
        let r2 = Rect::new(100, 100, 500, 400);

        let inter = r1.intersection(&r2).unwrap();
        assert_eq!(inter, Rect::new(100, 100, 500, 400));
        assert_eq!(inter.width(), 400);
        assert_eq!(inter.height(), 300);
        assert_eq!(inter.area(), 120_000);

        let r3 = Rect::new(2000, 0, 3000, 1000);
        assert!(r1.intersection(&r3).is_none());
    }

    #[test]
    fn test_rect_covers_with_tolerance() {
        let monitor = Rect::new(0, 0, 1920, 1080);
        let window_exact = Rect::new(0, 0, 1920, 1080);
        assert!(window_exact.covers(&monitor, 1));

        let window_1px_off = Rect::new(1, 1, 1919, 1079);
        assert!(window_1px_off.covers(&monitor, 1));

        let window_2px_off = Rect::new(2, 2, 1918, 1078);
        assert!(!window_2px_off.covers(&monitor, 1));

        let window_larger = Rect::new(-5, -5, 1925, 1085);
        assert!(window_larger.covers(&monitor, 1));
    }

    #[test]
    fn test_window_position_mixed_dpi() {
        // Monitor 1: 100% scale (1.0), 1920x1080
        let mon1 = Rect::new(0, 0, 1920, 1040); // 40px taskbar
        let (x1, y1, w1, h1) = calculate_window_position(&mon1, 640.0, 560.0, 1.0, 0.0);
        assert_eq!(w1, 640);
        assert_eq!(h1, 560);
        assert_eq!(x1, (1920 - 640) / 2); // 640
        assert_eq!(y1, 0);

        // Monitor 2 on left: 150% scale (1.5), 2560x1440, negative coordinates
        let mon2 = Rect::new(-2560, 0, 0, 1400);
        let (x2, y2, w2, h2) = calculate_window_position(&mon2, 640.0, 560.0, 1.5, 0.0);
        assert_eq!(w2, 960);
        assert_eq!(h2, 840);
        assert_eq!(x2, -2560 + (2560 - 960) / 2); // -1760
        assert_eq!(y2, 0);
    }
}
