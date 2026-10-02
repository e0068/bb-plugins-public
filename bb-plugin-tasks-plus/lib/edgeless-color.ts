// Colours a project or label may wear that vanish into one of bb's theme
// backgrounds — white on light, black on dark. Whatever draws them gives
// them an edge in the theme's border colour. Colours are stored as typed
// (the CLI takes any string), so the spellings are normalised first.

const EDGELESS_COLORS: ReadonlySet<string> = new Set(["white", "#fff", "#ffffff", "black", "#000", "#000000"]);

export const isEdgeless = (color: string): boolean => EDGELESS_COLORS.has(color.trim().toLowerCase());
