// A project's icon — its Tasks+ board's, the one bb's thread list wears beside the project. Tasks+ draws it and the
// server hands it on (`projectIcons`), so the section carries no icon catalog of its own. Tasks+ tells the window
// when a board changes (packages/task-bridge), and the icons are read again.
import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { onProjectsChanged } from "@bb-plugins/task-bridge";
import type { IconPaint, ProjectIconDrawing, rpcContract } from "./server";
import { cn } from "@/lib/utils";

/** The icon is drawn in a 24×24 box, as Tasks+ draws it (bb-plugin-tasks-plus/lib/icon-drawing.ts). */
const ICON_BOX = 24;
const TILE_RADIUS = 6;
const EMOJI_SIZE = 20;

type ProjectIcons = ReadonlyMap<string, ProjectIconDrawing>;

const ProjectIconsContext = createContext<ProjectIcons>(new Map());

/** Reads every project's icon and reads them again whenever Tasks+ says a board changed. */
export function ProjectIconsProvider({ children }: { children: ReactNode }) {
  const rpc = useRpc<typeof rpcContract>();
  const [icons, setIcons] = useState<ProjectIcons>(new Map());
  useEffect(() => {
    // Only the latest read lands: an older answer arriving last must not bring back the icons before a change.
    let latest = 0;
    const read = async () => {
      const own = ++latest;
      try {
        const { icons } = await rpc.call("projectIcons");
        if (own === latest && icons !== null) setIcons(new Map(icons.map(({ bbProjectId, drawing }) => [bbProjectId, drawing])));
      } catch {
        // Keep the icons already shown: a missed read must not strip them off.
      }
    };
    void read();
    const off = onProjectsChanged(window, () => void read());
    return () => {
      latest = -1;
      off();
    };
    // rpc is a fresh client per render; depending on it would read again on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <ProjectIconsContext.Provider value={icons}>{children}</ProjectIconsContext.Provider>;
}

/** A paint as an element wears it: its own colour, or the theme class that sets it; nothing — the colour around. */
function paintOf(paint: IconPaint | undefined): { color?: string; className?: string } {
  if (paint === undefined) return {};
  if (typeof paint === "object") return { color: paint.color };
  return { className: paint === "foreground" ? "text-foreground" : "text-background" };
}

const glyphShapes = (nodes: Extract<ProjectIconDrawing, { kind: "glyph" }>["nodes"]) =>
  // A glyph may carry a `key` of its own, the same in every node; the position must win, or React mixes the nodes up.
  nodes.map(([tag, attrs], index) => createElement(tag, { ...attrs, key: index }));

/** The project's icon; nothing for a project without one, so the name keeps its place. */
export function ProjectIcon({ projectId, className }: { projectId: string; className?: string }) {
  const drawing = useContext(ProjectIconsContext).get(projectId);
  if (drawing === undefined) return null;
  const bare = drawing.kind === "glyph" && drawing.tile === undefined ? paintOf(drawing.ink) : {};
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${ICON_BOX} ${ICON_BOX}`}
      fill="none"
      aria-hidden="true"
      data-project-icon={projectId}
      className={cn("shrink-0", bare.className, className)}
      style={bare.color === undefined ? undefined : { color: bare.color }}
    >
      {drawing.kind === "emoji" ? (
        // A colour emoji is a glyph of the text: with the svg's fill="none" Chrome draws nothing.
        <text x={ICON_BOX / 2} y={ICON_BOX / 2} textAnchor="middle" dominantBaseline="central" fontSize={EMOJI_SIZE} fill="currentColor">
          {drawing.char}
        </text>
      ) : drawing.tile === undefined ? (
        <g transform={drawing.transform}>{glyphShapes(drawing.nodes)}</g>
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
