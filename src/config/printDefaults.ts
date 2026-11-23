/**
 * Print defaults. Margin and bleed values are PLACEHOLDERS — adjust here only;
 * nothing else in the codebase hard-codes them.
 */
export const PRINT_DEFAULTS = {
  size: 'A4',
  widthMm: 210,
  heightMm: 297,
  orientation: 'portrait',
  marginsMm: { top: 20, right: 15, bottom: 20, left: 15 },
  marginsLinked: false,
  bleedMm: 0, // off by default; 3 mm when enabled (placeholder)
  bleedWhenEnabledMm: 3,
  minMarginMm: 0,
  minContentMm: 50, // content area must stay at least 50 × 50 mm
  marginStepMm: 0.5,
  dpi: 300,
  /** Warn when content sits this close to the trim with bleed off (placeholder). */
  printerUnprintableMm: 5,
} as const;

export const MM_PER_INCH = 25.4;
export const CSS_PX_PER_INCH = 96;
export const PT_PER_INCH = 72;

export const mmToCssPx = (mm: number) => (mm / MM_PER_INCH) * CSS_PX_PER_INCH;
export const mmToPt = (mm: number) => (mm / MM_PER_INCH) * PT_PER_INCH;
export const mmToDevicePx = (mm: number, dpi: number = PRINT_DEFAULTS.dpi) =>
  Math.round((mm / MM_PER_INCH) * dpi);
export const cssPxToPt = (px: number) => (px / CSS_PX_PER_INCH) * PT_PER_INCH;
