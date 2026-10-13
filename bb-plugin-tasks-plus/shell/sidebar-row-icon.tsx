// Layer: shell. An invisible app overlay that puts a board's icon into the row of its bb project in bb's thread
// list, where a thread row has its provider's logo, and opens the icon picker from it. bb gives plugins no slot on
// that row, so the button is laid into bb's markup — with plain DOM, not React: while any plugin awaits something,
// bb drops a node React made into a parent React does not own. An app overlay's own element is such a parent too —
// bb leaves it out of the page — so the picker hangs in bb's app element at the top of #root, which React made.
import { useEffect, useRef, useState } from "react";
import { experimental_useSidebarThreads } from "@get-bb/plugin-sdk/app";
import { DEFAULT_PROJECT_ICON } from "@bb-plugins/icon-catalog";
import { IconPicker } from "@/components/icon-picker";
import { OverlayContainerProvider } from "@/components/ui/overlay-container";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { EMOJI_SIZE, ICON_BOX, iconDrawing, paintOf, TILE_RADIUS, type IconDrawing, type Paint } from "@/lib/icon-drawing";
import { useProjects, useTasksRpc } from "./data.js";
import { TasksRefreshProvider } from "./refresh.js";
import { projectOfGroupRow, rowBoardOf, type NamedProject, type RowBoard } from "./sidebar-row-project.js";

const BUTTON_ATTR = "data-tasks-project-icon";
const KEY_ATTR = "data-tasks-project-icon-key";
const BOARD_ATTR = "data-tasks-project-icon-board";
const GROUP_LABEL = '[data-sidebar="group-label"]';
/** Exactly the icon's size, so its hover keeps off the name and the rows above and below. */
const BUTTON_CLASS = "inline-flex size-4 shrink-0 items-center justify-center rounded-sm hover:bg-state-hover";
/**
 * A thread row starts its 16px logo 8px in, and so does the label its content: the 16px button sits on the logos as
 * it is, and 2px after it plus the label's 4px gap start the name where the thread titles do, 6px after the logo.
 */
const BUTTON_MARGIN = "0 2px 0 0";

const SVG_NS = "http://www.w3.org/2000/svg";
/** `strokeLinecap` → `stroke-linecap`: a glyph keys its SVG attributes the way React props are written. `viewBox`
 *  is camel-cased in SVG itself and stays so. */
const svgAttribute = (prop: string) => (prop === "viewBox" ? prop : prop.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`));

function svgNode(tag: string, attributes: Readonly<Record<string, string | number | undefined>>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) if (name !== "key" && value !== undefined) node.setAttribute(svgAttribute(name), String(value));
  return node;
}

/** A paint as an SVG element's attributes: its colour, or the theme class that sets it. */
const paintAttributes = (paint: Paint | undefined) => {
  const { color, className } = paintOf(paint);
  return { color, class: className };
};

/** The icon as components/entity-icon.tsx draws it, in plain DOM. */
function iconSvg(drawing: IconDrawing): SVGElement {
  const bare = drawing.kind === "glyph" && drawing.tile === undefined ? paintOf(drawing.ink) : {};
  const svg = svgNode("svg", { viewBox: `0 0 ${ICON_BOX} ${ICON_BOX}`, width: ICON_BOX, height: ICON_BOX, fill: "none", "aria-hidden": "true", class: ["size-4 shrink-0", bare.className].filter(Boolean).join(" ") });
  if (bare.color !== undefined) svg.setAttribute("style", `color: ${bare.color}`);
  if (drawing.kind === "emoji") {
    // A colour emoji is a glyph of the text: with the svg's fill="none" Chrome draws nothing.
    const text = svgNode("text", { x: ICON_BOX / 2, y: ICON_BOX / 2, textAnchor: "middle", dominantBaseline: "central", fontSize: EMOJI_SIZE, fill: "currentColor" });
    text.textContent = drawing.char;
    svg.append(text);
    return svg;
  }
  const glyph = svgNode("g", { transform: drawing.transform, ...(drawing.tile === undefined ? {} : paintAttributes(drawing.ink)) });
  glyph.append(...drawing.nodes.map(([tag, attrs]) => svgNode(tag, attrs)));
  if (drawing.tile === undefined) {
    svg.append(glyph);
    return svg;
  }
  const tile = paintAttributes(drawing.tile);
  svg.append(svgNode("rect", { width: ICON_BOX, height: ICON_BOX, rx: TILE_RADIUS, fill: tile.color ?? "currentColor", class: tile.class }), glyph);
  return svg;
}

/** bb's own element at the top of the app: React made it, nothing above it shifts or clips; null outside bb. */
const appElement = (): HTMLElement | null => {
  const first = document.getElementById("root")?.firstElementChild;
  return first instanceof HTMLElement ? first : null;
};

/** The row the picker is open for. Its board is read live, so a colour picked while it is open shows at once. */
interface Picking {
  readonly name: string;
  readonly boardId: string;
}

const drawingKey = (board: RowBoard) => `${board.icon ?? ""}|${board.color}`;
/** The button of a board's row on the page now: bb re-renders its rows, and a new one may stand there. */
const liveButton = (boardId: string) => document.querySelector(`[${BOARD_ATTR}="${boardId}"]`);

/** Draws the board's icon into the button. */
function paint(button: Element, board: RowBoard): void {
  const drawing = iconDrawing(board.icon, DEFAULT_PROJECT_ICON, board.color);
  button.replaceChildren(...(drawing === null ? [] : [iconSvg(drawing)]));
  button.setAttribute(KEY_ATTR, drawingKey(board));
}

function rowButton(name: string, board: RowBoard, onOpen: (picking: Picking) => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute(BUTTON_ATTR, "");
  button.setAttribute(BOARD_ATTR, board.boardId);
  button.setAttribute("aria-label", `Icon of ${name}`);
  button.className = BUTTON_CLASS;
  button.style.margin = BUTTON_MARGIN;
  paint(button, board);
  // The row underneath folds the project and drags it; the button only picks its icon.
  button.addEventListener("pointerdown", (event) => event.stopPropagation());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onOpen({ name, boardId: board.boardId });
  });
  return button;
}

/** Puts, refreshes or takes off the icon button of every project row on the page. */
function placeRowIcons(projects: readonly NamedProject[], boards: Parameters<typeof rowBoardOf>[1], onOpen: (picking: Picking) => void): void {
  for (const label of Array.from(document.querySelectorAll(GROUP_LABEL))) {
    const nameNode = label.querySelector("span.truncate");
    const placed = label.querySelector(`[${BUTTON_ATTR}]`);
    const name = nameNode?.getAttribute("title") ?? nameNode?.textContent ?? "";
    const threadHrefs = Array.from(label.closest("[data-sidebar-sticky-group]")?.querySelectorAll("a[data-sidebar-thread-id]") ?? []).map(
      (link) => link.getAttribute("href") ?? "",
    );
    const projectId = nameNode === null ? null : projectOfGroupRow({ name, threadHrefs }, projects);
    const board = projectId === null ? null : rowBoardOf(projectId, boards);
    if (board === null || nameNode === null) {
      placed?.remove();
      continue;
    }
    // The button the picker may hang from stays in place, and only its drawing changes with the board's icon.
    if (placed?.nextElementSibling === nameNode && placed.getAttribute(BOARD_ATTR) === board.boardId && placed.getAttribute("aria-label") === `Icon of ${name}`) {
      if (placed.getAttribute(KEY_ATTR) !== drawingKey(board)) paint(placed, board);
      continue;
    }
    placed?.remove();
    nameNode.before(rowButton(name, board, onOpen));
  }
}

function SidebarRowIconsInner() {
  const rpc = useTasksRpc();
  const boards = useProjects();
  const { projects } = experimental_useSidebarThreads();
  const [picking, setPicking] = useState<Picking | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const pickingRef = useRef(picking);
  pickingRef.current = picking;
  // The picker measures the row's button each time it places itself, whichever button stands there now.
  const anchorRef = useRef({
    getBoundingClientRect: () => (pickingRef.current === null ? null : liveButton(pickingRef.current.boardId))?.getBoundingClientRect() ?? new DOMRect(),
    // The thread list it scrolls with, so the picker follows the row.
    get contextElement() {
      return (pickingRef.current === null ? null : liveButton(pickingRef.current.boardId)) ?? undefined;
    },
  });
  // The observer reads the latest lists through here: it lives as long as the overlay, so a refetch while the
  // picker is open never takes the button it hangs from out of the row.
  const latest = useRef({ projects, boards: boards.data ?? [] });
  latest.current = { projects, boards: boards.data ?? [] };
  const scheduleRef = useRef<() => void>(() => {});

  useEffect(() => {
    let frame: number | null = null;
    const scan = () => placeRowIcons(latest.current.projects, latest.current.boards, setPicking);
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(() => ((frame = null), scan()));
    };
    scheduleRef.current = schedule;
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    scan();
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      document.querySelectorAll(`[${BUTTON_ATTR}]`).forEach((button) => button.remove());
    };
  }, []);
  useEffect(() => scheduleRef.current(), [projects, boards.data]);

  const board = picking === null ? undefined : boards.data?.find((candidate) => candidate.id === picking.boardId);
  if (picking === null || board === undefined) return null;
  const close = () => {
    setPicking(null);
    setProblem(null);
  };
  // A refused pick keeps the picker open with why, as every other icon pick of Tasks+ tells it.
  const save = (icon: string, then: () => void) => {
    setProblem(null);
    rpc.call("updateProject", { projectId: picking.boardId, icon }).then(then, (error: unknown) =>
      setProblem(error instanceof Error ? error.message : String(error)),
    );
  };
  return (
    <OverlayContainerProvider container={appElement()}>
      <Popover open onOpenChange={(open) => (open ? undefined : close())}>
        <PopoverAnchor virtualRef={anchorRef} />
        <PopoverContent align="start" collisionPadding={8} className="w-96 p-2" mobileTitle={`Icon of ${picking.name}`}>
          <IconPicker
            value={board.icon}
            color={board.color}
            onRecolor={(icon) => save(icon, () => {})}
            onPick={(icon) => save(icon, close)}
          />
          {problem === null ? null : (
            <p role="alert" className="px-1 pt-1 text-xs text-destructive">
              {problem}
            </p>
          )}
        </PopoverContent>
      </Popover>
    </OverlayContainerProvider>
  );
}

/** The overlay, with its own refresh of the Tasks+ data it reads. */
export function SidebarRowIcons() {
  return (
    <TasksRefreshProvider>
      <SidebarRowIconsInner />
    </TasksRefreshProvider>
  );
}
