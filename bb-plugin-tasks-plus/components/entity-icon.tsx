import { createElement } from "react";
import { EMOJI_SIZE, ICON_BOX, iconDrawing, paintOf, TILE_RADIUS } from "@/lib/icon-drawing";
import { cn } from "@/lib/utils";
import type { Glyph } from "@bb-plugins/icon-catalog";

const glyphShapes = (glyph: Glyph) => glyph.map(([tag, attrs], index) => createElement(tag, { key: index, ...attrs }));

/**
 * The icon of a project, task, label, option or column, of any kind: a line sign in its colour, a filled one on its
 * tile or bare, an emoji as itself. `color` is the bearer's and paints what the icon chose no colour for; black and
 * white take the theme's text colour, so they show on either theme. Nothing is drawn when the value is no icon and
 * there is no `fallback`.
 */
export function EntityIcon({
  icon,
  color,
  fallback = null,
  className,
}: {
  icon?: string;
  color?: string;
  fallback?: string | null;
  className?: string;
}) {
  const drawing = iconDrawing(icon, fallback, color);
  if (drawing === null) return null;
  const bare = drawing.kind === "glyph" && drawing.tile === undefined ? paintOf(drawing.ink) : {};
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${ICON_BOX} ${ICON_BOX}`}
      width={ICON_BOX}
      height={ICON_BOX}
      fill="none"
      aria-hidden="true"
      className={cn("shrink-0", bare.className, className)}
      style={bare.color === undefined ? undefined : { color: bare.color }}
    >
      {drawing.kind === "emoji" ? (
        // A colour emoji is a glyph of the text: with the svg's fill="none" Chrome draws nothing.
        <text x={ICON_BOX / 2} y={ICON_BOX / 2} textAnchor="middle" dominantBaseline="central" fontSize={EMOJI_SIZE} fill="currentColor">
          {drawing.char}
        </text>
      ) : drawing.tile === undefined ? (
        drawing.transform === undefined ? glyphShapes(drawing.nodes) : <g transform={drawing.transform}>{glyphShapes(drawing.nodes)}</g>
      ) : (
        <>
          <rect width={ICON_BOX} height={ICON_BOX} rx={TILE_RADIUS} fill={paintOf(drawing.tile).color ?? "currentColor"} className={paintOf(drawing.tile).className} />
          <g transform={drawing.transform} color={paintOf(drawing.ink).color} className={paintOf(drawing.ink).className}>
            {glyphShapes(drawing.nodes)}
          </g>
        </>
      )}
    </svg>
  );
}
