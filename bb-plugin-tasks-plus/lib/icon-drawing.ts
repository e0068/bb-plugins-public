// What an icon value draws, and the choices of each tab of the icon picker — pure, so the React icon
// (components/entity-icon.tsx) and the plain-DOM one in bb's thread list (shell/sidebar-row-icon.tsx) draw alike.
import {
  EMOJI,
  ICON_CATALOG,
  iconValue,
  parseIcon,
  PHOSPHOR_BOX,
  PHOSPHOR_FILL,
  PHOSPHOR_LINE,
  type Glyph,
  type Icon,
  type IconColors,
} from "@bb-plugins/icon-catalog";
import { isEdgeless } from "./edgeless-color";

/**
 * How a part of the icon is painted: a colour of its own, the theme's text or page colour (black and white vanish
 * into one of bb's themes, so they take the theme's instead), or — absent — the text colour around it.
 */
export type Paint = { readonly color: string } | "foreground" | "background";

export type IconDrawing =
  | {
      readonly kind: "glyph";
      readonly nodes: Glyph;
      /** Maps the glyph's own box into the icon's 24×24; absent — it is drawn in that box already. */
      readonly transform?: string;
      /** The glyph's colour. */
      readonly ink?: Paint;
      /** The tile under the glyph; absent — no tile. */
      readonly tile?: Paint;
    }
  | { readonly kind: "emoji"; readonly char: string };

/** The icon is drawn in a 24×24 box, as Hugeicons are. */
export const ICON_BOX = 24;
/** The rounding of a filled icon's tile. */
export const TILE_RADIUS = 6;
/** A glyph on a tile is drawn 15 of 24 wide, in the middle. */
const TILE_GLYPH = 15;
/** An emoji's size inside the box. */
export const EMOJI_SIZE = 20;
/** What an icon button shows while nothing is chosen. */
export const PLACEHOLDER_ICON = "Image01";

const phosphorNodes = (paths: readonly string[]): Glyph => paths.map((d) => ["path", { d, fill: "currentColor" }] as const);

/** The glyph an icon names, in its own box. Only icons parseIcon read reach here, so the sign is there. */
const glyphOf = (icon: Exclude<Icon, { kind: "emoji" }>): { nodes: Glyph; box: number } =>
  icon.set === "phosphor"
    ? { nodes: phosphorNodes((icon.kind === "line" ? PHOSPHOR_LINE : PHOSPHOR_FILL).get(icon.name)!), box: PHOSPHOR_BOX }
    : { nodes: ICON_CATALOG.get(icon.name)!, box: ICON_BOX };

const scale = (box: number, size: number) => size / box;

function transformOf(box: number, tiled: boolean): string | undefined {
  if (tiled) return `translate(${(ICON_BOX - TILE_GLYPH) / 2} ${(ICON_BOX - TILE_GLYPH) / 2}) scale(${scale(box, TILE_GLYPH)})`;
  return box === ICON_BOX ? undefined : `scale(${scale(box, ICON_BOX)})`;
}

/** A colour as painted where nothing under it shows it off: black and white take the theme's text colour. */
const bare = (color: string | undefined): Paint | undefined => (color === undefined ? undefined : isEdgeless(color) ? "foreground" : { color });

/** The colour of the tile `icon` is drawn on — undefined when neither it nor the bearer chose one; null for no tile. */
function tileColorOf(icon: Exclude<Icon, { kind: "emoji" }>, color: string | undefined): string | undefined | null {
  if (icon.kind === "line") return null;
  // A Hugeicons sign has no filled weight: it is always drawn on a tile, the bearer's colour when none is chosen.
  return icon.background ?? (icon.set === "phosphor" ? null : color);
}

/** The tile's colour and the glyph's on it, or no tile. */
function tileOf(icon: Exclude<Icon, { kind: "emoji" }>, color: string | undefined): { tile: Paint; ink: Paint } | null {
  const tile = tileColorOf(icon, color);
  if (tile === null) return null;
  // A tile without a colour, or black or white, is the theme's text colour, and the glyph on it the page's.
  // A black or white line on it follows the theme too, so it stays the tile's opposite.
  if (tile === undefined || isEdgeless(tile)) return { tile: "foreground", ink: icon.color === undefined || isEdgeless(icon.color) ? "background" : { color: icon.color } };
  return { tile: { color: tile }, ink: { color: icon.color ?? "white" } };
}

/**
 * What `raw` draws, else what `fallback` draws; null when neither is an icon. `color` is the bearer's — a project's
 * or label's — and paints what the icon chose no colour for.
 */
export function iconDrawing(raw: string | undefined, fallback: string | null, color?: string): IconDrawing | null {
  const icon = parseIcon(raw) ?? (fallback === null ? null : parseIcon(fallback));
  if (icon === null) return null;
  if (icon.kind === "emoji") return icon;
  const { nodes, box } = glyphOf(icon);
  const tiled = tileOf(icon, color);
  const transform = transformOf(box, tiled !== null);
  const ink = tiled?.ink ?? bare(icon.color ?? color);
  return { kind: "glyph", nodes, ...(transform === undefined ? {} : { transform }), ...(ink === undefined ? {} : { ink }), ...(tiled === null ? {} : { tile: tiled.tile }) };
}

/**
 * The colour a bearer is seen in where its icon is drawn — a project's, in the sidebar: the tile's, else the line's
 * the icon chose, else the bearer's own `color`. What a screen paints beside the icon (a chart's segment, a dot at
 * the name) takes it, so the two never disagree. Black and white are returned as they are; the screen decides how
 * they stay visible.
 */
export function drawnColor(raw: string | undefined, color: string): string {
  const icon = parseIcon(raw);
  if (icon === null || icon.kind === "emoji") return color;
  return tileColorOf(icon, color) ?? icon.color ?? color;
}

export type IconTab = "line" | "filled" | "emoji";

export interface IconChoice {
  /** The value a pick stores. */
  readonly value: string;
  /** The choice's name to a reader: the sign's name, or the emoji itself. */
  readonly label: string;
}

const HUGEICONS: readonly string[] = [...ICON_CATALOG.keys()];
const PHOSPHOR: readonly string[] = [...PHOSPHOR_LINE.keys()];

/** The tab an icon value opens on; Line for none. */
export const tabOf = (value: string | undefined): IconTab => parseIcon(value)?.kind ?? "line";

/** The colours an icon value chose itself; none for an emoji or no icon. */
export function colorsOf(value: string | undefined): IconColors {
  const icon = parseIcon(value);
  if (icon === null || icon.kind === "emoji") return {};
  return { ...(icon.color === undefined ? {} : { color: icon.color }), ...(icon.kind === "filled" && icon.background !== undefined ? { background: icon.background } : {}) };
}

const withColors = (icon: Exclude<Icon, { kind: "emoji" }>, colors: IconColors): Icon =>
  icon.kind === "line"
    ? { ...icon, ...(colors.color === undefined ? {} : { color: colors.color }) }
    : { ...icon, ...(colors.color === undefined ? {} : { color: colors.color }), ...(colors.background === undefined ? {} : { background: colors.background }) };

/** The same icon in other colours; an emoji or no icon stays as it is. */
export function recolored(value: string, colors: IconColors): string {
  const icon = parseIcon(value);
  if (icon === null || icon.kind === "emoji") return value;
  const { name, set } = icon;
  const uncolored: Exclude<Icon, { kind: "emoji" }> = { kind: icon.kind, name, ...(set === undefined ? {} : { set }) };
  return iconValue(withColors(uncolored, colors));
}

/**
 * The tab's choices that hold the typed text, case aside: Line — the Hugeicons catalog, then Phosphor's line signs;
 * Filled — Phosphor's filled signs; Emoji — the emoji whose words hold it. Line and filled choices wear `colors`.
 */
export function iconChoices(tab: IconTab, query: string, colors: IconColors = {}): readonly IconChoice[] {
  const needle = query.trim().toLowerCase();
  const holds = (name: string) => name.toLowerCase().includes(needle);
  const choice = (icon: Exclude<Icon, { kind: "emoji" }>): IconChoice => ({ value: iconValue(withColors(icon, colors)), label: icon.name });
  switch (tab) {
    case "emoji":
      return EMOJI.filter(({ words }) => words.includes(needle)).map(({ char }) => ({ value: char, label: char }));
    case "line":
      return [
        ...HUGEICONS.filter(holds).map((name) => choice({ kind: "line", name })),
        ...PHOSPHOR.filter(holds).map((name) => choice({ kind: "line", name, set: "phosphor" })),
      ];
    case "filled":
      return PHOSPHOR.filter(holds).map((name) => choice({ kind: "filled", name, set: "phosphor" }));
  }
}

/** A paint as an element wears it: its own colour, or the theme class that sets it; nothing — the colour around. */
export function paintOf(paint: Paint | undefined): { readonly color?: string; readonly className?: string } {
  if (paint === undefined) return {};
  if (typeof paint === "object") return { color: paint.color };
  return { className: paint === "foreground" ? "text-foreground" : "text-background" };
}
