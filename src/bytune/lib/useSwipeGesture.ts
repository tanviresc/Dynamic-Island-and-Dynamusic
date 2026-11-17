import { useRef, type TouchEvent } from "react";

export interface UseSwipeGestureOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  /** Optional left-side badge revealed when swiping right (opacity synced directly on DOM). */
  rightBadgeRef?: React.RefObject<HTMLElement | null>;
  /** Minimum horizontal pixels on release to trigger an action (default 52). */
  threshold?: number;
  /** Maximum horizontal preview shift in px (default 92). */
  maxOffset?: number;
  disabled?: boolean;
}

/**
 * Zero-rerender horizontal touch swipe hook: updates DOM `transform` directly
 * on the target element during `touchmove` so mobile lists/mini-players stay at 60fps.
 */
export function useSwipeGesture({
  onSwipeLeft,
  onSwipeRight,
  rightBadgeRef,
  threshold = 52,
  maxOffset = 92,
  disabled = false,
}: UseSwipeGestureOptions) {
  const targetRef = useRef<HTMLElement | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const axisRef = useRef<"h" | "v" | null>(null);
  const lastDxRef = useRef(0);
  const didSwipeRef = useRef(false);

  const canLeft = Boolean(onSwipeLeft);
  const canRight = Boolean(onSwipeRight);

  const reset = () => {
    const el = targetRef.current;
    if (el) {
      el.style.transition = "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)";
      el.style.transform = "";
    }
    const badge = rightBadgeRef?.current;
    if (badge) {
      badge.style.transition = "opacity 180ms ease";
      badge.style.opacity = "0";
    }
    startRef.current = null;
    axisRef.current = null;
    lastDxRef.current = 0;
  };

  const onTouchStart = (e: TouchEvent) => {
    if (disabled || (!canLeft && !canRight) || e.touches.length !== 1) return;
    targetRef.current = e.currentTarget as HTMLElement;
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
      if (absX > 12 && absX > absY * 1.15) {
        if ((dx > 0 && !canRight) || (dx < 0 && !canLeft)) {
          axisRef.current = "v";
          return;
        }
        axisRef.current = "h";
      } else {
        return;
      }
    }

    if (axisRef.current !== "h") return;
    if (e.cancelable) e.preventDefault();

    const clamped =
      dx > 0
        ? canRight
          ? Math.min(maxOffset, dx * 0.78)
          : 0
        : canLeft
          ? Math.max(-maxOffset, dx * 0.78)
          : 0;
    lastDxRef.current = dx;
    if (absX > 16) didSwipeRef.current = true;
    const el = targetRef.current;
    if (el) {
      el.style.transition = "none";
      el.style.transform = `translate3d(${clamped}px, 0, 0)`;
    }
    const badge = rightBadgeRef?.current;
    if (badge) {
      badge.style.transition = "none";
      badge.style.opacity = clamped > 10 ? String(Math.min(1, (clamped - 10) / (threshold * 0.65))) : "0";
    }
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
    offsetX: 0,
    dragging: false,
    consumeDidSwipe,
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel,
    },
  };
}

export interface UseVerticalDismissOptions {
  onDismiss: () => void;
  /** Minimum downward pixels on release to dismiss (default 100). */
  threshold?: number;
  /** Minimum downward release velocity in px/ms to flick-dismiss (default 0.55). */
  velocityThreshold?: number;
  disabled?: boolean;
}

function hasScrolledAncestor(target: EventTarget | null, boundary: EventTarget | null): boolean {
  let node = target instanceof HTMLElement ? target : null;
  const stopAt = boundary instanceof HTMLElement ? boundary : null;
  while (node && node !== stopAt) {
    const style = window.getComputedStyle(node);
    const overflowY = style.overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight + 2) {
      if (node.scrollTop > 2) return true;
    }
    node = node.parentElement;
  }
  return false;
}

function isInteractiveDragBlock(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('[role="slider"], input, textarea, [data-no-dismiss="true"]'));
}

export function useVerticalDismissGesture({
  onDismiss,
  threshold = 100,
  velocityThreshold = 0.55,
  disabled = false,
}: UseVerticalDismissOptions) {
  const targetRef = useRef<HTMLElement | null>(null);
  const startRef = useRef<{ x: number; y: number; blocked: boolean } | null>(null);
  const lastSampleRef = useRef<{ y: number; t: number; vy: number }>({ y: 0, t: 0, vy: 0 });
  const axisRef = useRef<"v" | "h" | null>(null);
  const offsetYRef = useRef(0);

  const reset = () => {
    const el = targetRef.current;
    if (el) {
      el.style.transition = "transform 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease-out";
      el.style.transform = "";
      el.style.opacity = "";
    }
    startRef.current = null;
    axisRef.current = null;
    offsetYRef.current = 0;
  };

  const onTouchStart = (e: TouchEvent) => {
    if (disabled || e.touches.length !== 1) return;
    targetRef.current = e.currentTarget as HTMLElement;
    if (isInteractiveDragBlock(e.target) || hasScrolledAncestor(e.target, e.currentTarget)) {
      startRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, blocked: true };
      return;
    }
    const t = performance.now();
    const y = e.touches[0].clientY;
    startRef.current = { x: e.touches[0].clientX, y, blocked: false };
    lastSampleRef.current = { y, t, vy: 0 };
    axisRef.current = null;
    offsetYRef.current = 0;
  };

  const onTouchMove = (e: TouchEvent) => {
    const start = startRef.current;
    if (!start || start.blocked || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - start.x;
    const dy = e.touches[0].clientY - start.y;

    if (!axisRef.current) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.15) {
        axisRef.current = "v";
      } else {
        axisRef.current = "h";
        return;
      }
    }

    if (axisRef.current !== "v") return;

    const now = performance.now();
    const dt = Math.max(1, now - lastSampleRef.current.t);
    const curY = e.touches[0].clientY;
    const instVy = (curY - lastSampleRef.current.y) / dt;
    lastSampleRef.current = {
      y: curY,
      t: now,
      vy: lastSampleRef.current.vy * 0.4 + instVy * 0.6,
    };

    const clamped = Math.max(0, dy);
    offsetYRef.current = clamped;
    const el = targetRef.current;
    if (el) {
      el.style.transition = "none";
      el.style.transform = `translate3d(0, ${clamped}px, 0)`;
      el.style.opacity = clamped > 0 ? String(Math.max(0.35, 1 - clamped / 420)) : "1";
    }
  };

  const onTouchEnd = () => {
    const wasVertical = axisRef.current === "v";
    const dy = offsetYRef.current;
    const vy = lastSampleRef.current.vy;
    reset();
    if (wasVertical && (dy > threshold || (dy > 28 && vy > velocityThreshold))) {
      onDismiss();
    }
  };

  return {
    offsetY: 0,
    dragging: false,
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: reset,
    },
  };
}

