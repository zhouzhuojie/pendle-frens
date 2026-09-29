/**
 * The brand mark, as numbers.
 *
 * Every value below was measured off the source artwork in
 * `assets/brand/source/` (784×1168 and 1168×784 JPEGs), not invented, so the
 * generated icon and the vector mark cannot drift from the supplied design:
 *
 *   disc   centre (391.5, 514)  r 219.2   colour #ededef
 *   rule   x 391.5, width 10, y 381..850  colour #0a2656
 *   dot L  centre (339.5, 799)  r  47.8   colour #0a2656
 *   dot R  centre (439.0, 799)  r  50.0   colour #00adac
 *   ink    #030713  (the artwork's own backdrop)
 *
 * Coordinates here are normalised to the mark's bounding box (436×557 in the
 * source), so `1.0` is the full height of the mark and the centre of that box is
 * the origin. The mark is taller than it is wide — that is the design, not a
 * cropping artefact.
 */

export const BRAND = {
  /** #ededef — the disc, in the artwork's own near-white. */
  light: '#ededef',
  /** #0a2656 — the rule and the left dot. */
  navy: '#0a2656',
  /** #00adac — the right dot. */
  teal: '#00adac',
  /** #030713 — the artwork's backdrop; also the icon tile. */
  ink: '#030713',
};

/** Mark geometry in normalised units (height = 1, origin = centre of bbox). */
export const MARK = {
  width: 0.7828,
  height: 1,
  disc: { cx: 0, cy: -0.1023, r: 0.3935 },
  rule: { cx: 0, top: -0.3411, bottom: 0.5009, width: 0.018 },
  dotNavy: { cx: -0.0934, cy: 0.4093, r: 0.0858 },
  dotTeal: { cx: 0.0853, cy: 0.4093, r: 0.0898 },
};

/**
 * Per-size drawing values.
 *
 * The source proportions cannot survive scaling: the rule is 1.8% of the mark
 * height, which is 0.25 px at a 16 px icon and 2 px even at 128. So the rule and
 * the dots are optically compensated — thicker than the artwork at every size,
 * increasingly so as the icon gets smaller. This is the standard icon-design
 * trade: preserve the *reading* of the mark, not its measurements.
 */
export const SIZE_TUNING = {
  16: { padding: 1.0, ruleWidth: 1.5, dotR: 1.5 },
  32: { padding: 2.0, ruleWidth: 2.0, dotR: 2.8 },
  48: { padding: 3.0, ruleWidth: 2.4, dotR: 4.0 },
  128: { padding: 9.0, ruleWidth: 5.0, dotR: 9.5 },
};

/**
 * Rule width for the vector mark, in the same normalised units.
 *
 * The header renders `mark.svg` at 22 px, where the source's 0.018-unit rule
 * lands at ~0.3 px and disappears. This value rasterises to ~1 px there: enough
 * to read as the navy hairline the artwork intends, without the 0.066 that turns
 * it into a bar and lets it dominate the disc. Chosen by rendering 0.028 / 0.045
 * / 0.066 at 22 px and comparing, the same way SIZE_TUNING was chosen.
 */
export const MARK_UI_RULE = 0.045;

/** Corner radius of the icon tile, as a fraction of the tile. */
export const TILE_RADIUS = 0.22;

/**
 * Normalised padding for the vector mark: the artwork's own margin, tightened.
 * Used by both the SVG mark and the banner so they line up with the PNG icons.
 */
export const SVG_PADDING = 0.09;
