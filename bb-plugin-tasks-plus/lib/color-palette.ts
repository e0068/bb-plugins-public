/**
 * Fixed swatch palette for projects, labels and icons. Values are CSS named colors —
 * they are stored as user data and rendered via inline `backgroundColor`
 * (matching the seed data's "blue"/"orange"/"violet"), so they must be valid
 * CSS colors without being hex literals.
 */
export const COLOR_PALETTE = [
  { value: "slateblue", label: "Indigo" },
  { value: "steelblue", label: "Blue" },
  { value: "lightseagreen", label: "Teal" },
  { value: "mediumseagreen", label: "Green" },
  { value: "goldenrod", label: "Yellow" },
  { value: "sandybrown", label: "Orange" },
  { value: "indianred", label: "Red" },
  { value: "palevioletred", label: "Pink" },
  { value: "mediumpurple", label: "Purple" },
  { value: "slategray", label: "Gray" },
  { value: "white", label: "White" },
  { value: "black", label: "Black" },
] as const;

export const DEFAULT_COLOR = COLOR_PALETTE[0].value;
