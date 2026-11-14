import { useRef, useState, type TouchEvent } from "react";

export interface UseSwipeGestureOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  /** Minimum horizontal pixels on release to trigger an action (default 52). */
  threshold?: number;
  /** Maximum horizontal preview shift in px (default 92). */
  maxOffset?: number;
  disabled?: boolean;
}

export function useSwipeGesture({
  onSwipeLeft,
  onSwipeRight,
  threshold = 52,
  maxOffset = 92,
  disabled = false,
}: UseSwipeGestureOptions) {
  const [offsetX, setOffsetX] = useState(0);
  const [dragging, setDragging] = useState(false);

  const startRef = useRef<{ x: number; y: number } | null>(null);
  const axisRef = useRef<"h" | "v" | null>(null);
  const lastDxRef = useRef(0);
  const didSwipeRef = useRef(false);

  const canLeft = Boolean(onSwipeLeft);
  const canRight = Boolean(onSwipeRight);

  const reset = () => {
    startRef.current = null;
    axisRef.current = null;
    lastDxRef.current = 0;
    setDragging(false);
    setOffsetX(0);
  };

  const onTouchStart = (e: TouchEvent) => {
    if (disabled || (!canLeft && !canRight) || e.touches.length !== 1) return;
    const t = e.touches[0];
    startRef.current = { x: t.clientX, y: t.clientY };
    axisRef.current = null;
    lastDxRef.current = 0;
    didSwipeRef.current = false;
  };

  const onTouchMove = (e: TouchEvent) => {
    const start = startRef.current;
    if (!start || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (axisRef.current === null) {
      if (absY > 10 && absY > absX) {
        axisRef.current = "v";
        return;
      }
      if (absX > 14 && absX > absY * 1.25) {
        if ((dx > 0 && !canRight) || (dx < 0 && !canLeft)) {
          axisRef.current = "v";
          return;
        }
        axisRef.current = "h";
        setDragging(true);
      } else {
        return;
      }
    }

    if (axisRef.current !== "h") return;

    const clamped =
      dx > 0
        ? canRight
          ? Math.min(maxOffset, dx * 0.72)
          : 0
        : canLeft
          ? Math.max(-maxOffset, dx * 0.72)
          : 0;
    lastDxRef.current = dx;
    if (absX > 18) didSwipeRef.current = true;
    setOffsetX(clamped);
  };

  const onTouchEnd = () => {
    const dx = lastDxRef.current;
    const axis = axisRef.current;
    reset();
    if (axis !== "h") return;
    if (dx >= threshold && onSwipeRight) {
      didSwipeRef.current = true;
      onSwipeRight();
    } else if (dx <= -threshold && onSwipeLeft) {
      didSwipeRef.current = true;
      onSwipeLeft();
    }
  };

  const onTouchCancel = () => {
    reset();
  };

  const consumeDidSwipe = (): boolean => {
    if (!didSwipeRef.current) return false;
    didSwipeRef.current = false;
    return true;
  };

  return {
    offsetX,
    dragging,
    consumeDidSwipe,
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel,
    },
  };
}

