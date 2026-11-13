export interface MeasureResult {
  width: number;
  height: number;
  borderRadius: number;
  isTwoLines: boolean;
  titleMaxWidth?: number;
}

export interface MeasureInput {
  title: string;
  text: string;
  category?: string;
  hasIcon?: boolean;
}

export const PILL_MIN_WIDTH = 130;
export const PILL_MAX_WIDTH = 340;
export const PILL_HORIZONTAL_PADDING = 20; // 10px left + 10px right ("30% reduced padding")
export const PILL_ONE_LINE_HEIGHT = 28;
export const PILL_TWO_LINE_HEIGHT = 28; // Reduced 30% from 38-40px
export const ICON_WIDTH_WITH_GAP = 20; // 14px circle + 6px gap
export const TAG_GAP = 4;

/**
 * Calculates estimated text widths using standard character width metrics
 * for "Segoe UI Variable Text" 10.5px 600 (title) and 400 (text).
 * In the browser DOM, this is supplemented/verified by synchronous hidden measuring.
 */
export function estimateTextWidth(text: string, isBold = false): number {
  if (!text) return 0;
  // Average character width for 10.5px Segoe UI:
  // Regular ~ 5.4px, Bold ~ 6.0px
  const charWidth = isBold ? 6.0 : 5.4;
  return Math.ceil(text.length * charWidth);
}

export function computePillGeometry(
  input: MeasureInput,
  domWidthMeasured?: number
): MeasureResult {
  const iconSpace = input.hasIcon !== false ? ICON_WIDTH_WITH_GAP : 0;
  const tagSpace = input.category
    ? estimateTextWidth(input.category, true) + 12 + TAG_GAP // 10px padding + borders + gap
    : 0;

  let totalContentWidth: number;
  if (domWidthMeasured !== undefined) {
    totalContentWidth = domWidthMeasured;
  } else {
    const titleWidth = estimateTextWidth(input.title, true);
    const dotWidth = input.text ? 10 : 0; // ": "
    const textWidth = estimateTextWidth(input.text, false);
    totalContentWidth = iconSpace + tagSpace + titleWidth + dotWidth + textWidth;
  }

  const desiredOuterWidth = totalContentWidth + PILL_HORIZONTAL_PADDING;

  if (desiredOuterWidth <= PILL_MAX_WIDTH) {
    const clampedWidth = Math.max(PILL_MIN_WIDTH, desiredOuterWidth);
    return {
      width: Math.round(clampedWidth),
      height: PILL_ONE_LINE_HEIGHT,
      borderRadius: Math.round(PILL_ONE_LINE_HEIGHT / 2),
      isTwoLines: false,
    };
  }

  // Strictly single-line dynamic island with text ellipsis
  return {
    width: PILL_MAX_WIDTH,
    height: PILL_ONE_LINE_HEIGHT,
    borderRadius: Math.round(PILL_ONE_LINE_HEIGHT / 2),
    isTwoLines: false,
    titleMaxWidth: 140,
  };
}
