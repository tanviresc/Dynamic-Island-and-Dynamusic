import { useEffect, useRef, useState } from "react";
import { ShelfScroller } from "./primitives";
import { FitText } from "./FitText";
import { browseMenuItems } from "../lib/trackActions";
import { useMobileMode } from "../stores/mobileMode";
import { useUI } from "../stores/ui";
import type { PlaylistCard } from "../types";

/** Return the index whose invariant layout center sits closest to `viewportCenter`. */
export function nearestMiddleCardIndex(centers: readonly number[], viewportCenter: number): number {
  if (centers.length === 0) return -1;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < centers.length; i++) {
    const d = Math.abs(centers[i] - viewportCenter);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Playlists as a record crate (Home's "Playlists for you", a category's page):
 * sleeves lean back in a row; on desktop, hovering/focusing slowly expands one
 * upright with its name below; on mobile touch screens, the sleeve resting in the
 * middle of the visible row expands automatically with the same slow smooth glide
 * as the row scrolls.
 */
export function Crate({ title, playlists, className = "" }: { title: string; playlists: PlaylistCard[]; className?: string }) {
  const navigate = useUI((s) => s.navigate);
  const isMobileDevice = useMobileMode((s) => s.isMobileDevice);
  const isTouchCrate =
    isMobileDevice ||
    (typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches);

  const scrollerRef = useRef<HTMLDivElement>(null);
  // -1: starts folded so both desktop hover and mobile middle-card spotlight visibly expand smoothly.
  const [lifted, setLifted] = useState(-1);

  useEffect(() => {
    if (!isTouchCrate) return;
    const scroller = scrollerRef.current;
    if (!scroller || playlists.length === 0) return;

    let raf = 0;
    const syncMiddleCard = (): void => {
      raf = 0;
      const buttons = Array.from(scroller.querySelectorAll<HTMLButtonElement>(".crate-sleeve"));
      if (buttons.length === 0) return;
      const centers = buttons.map((btn) => btn.offsetLeft + btn.offsetWidth / 2);
      const viewportCenter = scroller.scrollLeft + scroller.clientWidth / 2;
      const next = nearestMiddleCardIndex(centers, viewportCenter);
      if (next >= 0) {
        setLifted((prev) => (prev === next ? prev : next));
      }
    };

    const scheduleSync = (): void => {
      if (!raf) raf = window.requestAnimationFrame(syncMiddleCard);
    };

    const mountTimer = window.setTimeout(scheduleSync, 140);
    scroller.addEventListener("scroll", scheduleSync, { passive: true });
    const ro = new ResizeObserver(scheduleSync);
    ro.observe(scroller);
    return () => {
      window.clearTimeout(mountTimer);
      if (raf) window.cancelAnimationFrame(raf);
      scroller.removeEventListener("scroll", scheduleSync);
      ro.disconnect();
    };
  }, [isTouchCrate, playlists.length]);

  const shown = lifted >= 0 ? playlists[lifted] : undefined;
  return (
    <section className={className}>
      <h2 className="section-title text-[21px] mb-1 flex items-baseline gap-2">
        {title} <span className="text-[14px] font-medium text-ink-faint tabular-nums">{playlists.length}</span>
      </h2>
      <div
        onMouseLeave={() => {
          if (!isTouchCrate) setLifted(-1);
        }}
        onBlur={(e) => {
          if (!isTouchCrate && !e.currentTarget.contains(e.relatedTarget as Node | null)) setLifted(-1);
        }}
      >
        <ShelfScroller scrollerRef={scrollerRef} arrowTop="top-[146px]" trackClassName="pt-9 pb-6">
          {playlists.map((p, i) => (
            <button
              key={p.id}
              className={`crate-sleeve ${
                lifted < 0 ? "" : i === lifted ? "is-lifted" : i < lifted ? "is-before" : i === lifted + 1 ? "is-after is-next" : "is-after"
              }`}
              style={{ animationDelay: `${Math.min(i, 14) * 35}ms` }}
              onMouseEnter={() => {
                if (!isTouchCrate) setLifted(i);
              }}
              onFocus={() => setLifted(i)}
              onClick={() => navigate({ name: "ytplaylist", param: p.id })}
              onContextMenu={(e) => {
                const items = browseMenuItems({ browseId: p.id, title: p.title, subtitle: p.subtitle ?? "", thumb: p.thumb, type: "playlist" });
                if (!items.length) return;
                e.preventDefault();
                useUI.getState().openContextMenu(e.clientX, e.clientY, items);
              }}
              aria-label={p.title}
            >
              <img src={p.thumb} alt="" draggable={false} />
            </button>
          ))}
          <span className="crate-end" aria-hidden />
        </ShelfScroller>
      </div>
      {/* Keyed by the lifted playlist, so each new name slides in; empty at rest, its height kept so nothing below jumps. */}
      <div key={shown?.id ?? "rest"} className="crate-caption">
        {shown && (
          <>
            <FitText mode="auto" text={shown.title} className="text-[15px] font-semibold text-ink-hi" />
            <FitText mode="auto" text={shown.subtitle ?? ""} className="text-[13px] text-ink-dim" />
          </>
        )}
      </div>
    </section>
  );
}
