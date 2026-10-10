// The analytics screen: rows of tiles over the cut and the filters set in
// the topbar (page-controls.tsx). Every tile is a setting of one model
// (shared/analytics-tile.ts) answered by one RPC (analyticsTile); the set of
// tiles and their rows are kept in the plugin's KV, the same on every device.
// The owner edits a tile in the side panel — the tile on the screen is drawn
// from the draft while the panel is open — duplicates, deletes and moves it,
// and adds new ones from the empty tile at the end. This file is the shell:
// it asks the server and keeps the state; every pure piece lives in the
// modules it imports.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "../../components/ui/icon";
import type { Dashboard, Tile, TileAnswer } from "../../shared/contract.js";
import { useTasksQuery, useTasksRpc } from "../../client/data";
import { useTasksNavigation } from "../../client/routes.js";
import { cn } from "../../lib/utils";
import { isSuggested } from "../../shared/tile-conditions.js";
import { tileTable, type TileTable } from "../../shared/analytics-tile.js";
import { DEFAULT_REDUCED_PROJECTS } from "../../shared/reduced-projects.js";
import { useSuggestionScope } from "./suggestion-scope";
import { ChartColorsScope, type ChartBoard } from "./chart-colors";
import { hourEdges } from "./closed-model";
import {
  type AnalyticsWindow,
  columnUnit,
  copyTitle,
  defaultDashboard,
  newTile,
  tileEdges,
  tileScope,
  type TileScope,
} from "./default-dashboard";
import { useAnalyticsFilter } from "./page-filter";
import { RowBoard } from "./row-board";
import { ClaimClicks, PANEL, PickScope } from "./pick-scope";
import { SegmentTable } from "./segment-table";
import { insertCell, insertRow, keepCells, removeCell, type RowLayout } from "./row-layout";
import { TileCard } from "./tile-card";
import { TilePanel } from "./tile-panel";

/** Below this width the rows stack into one column. */
const STACK_BELOW_PX = 768;

function useMeasuredWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

const CLOCK_TICK_MS = 60_000;

/** Start of the viewer's current local hour — the last column of the hourly charts. */
const currentHourStart = () => hourEdges(Date.now())[23]!;

/** Start of the current minute. */
const currentMinuteStart = () => Math.floor(Date.now() / CLOCK_TICK_MS) * CLOCK_TICK_MS;

/** The current local hour, re-read every minute; and the current minute, ticking only while some tile counts minutes — so a quiet screen does not re-render each minute. */
function useClock(countsMinutes: boolean): { hour: number; minute: number } {
  const [hour, setHour] = useState(currentHourStart);
  const [minute, setMinute] = useState(currentMinuteStart);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setHour(currentHourStart());
      if (countsMinutes) setMinute(currentMinuteStart());
    }, CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, [countsMinutes]);
  return { hour, minute };
}

const countsMinutes = (tile: Tile): boolean => tile.window !== "page" && tile.window.unit === "minute";

/** The tile being edited: its draft, and whether Save adds it rather than replaces it. */
interface Editing {
  id: string;
  draft: Tile;
  isNew: boolean;
}

/** A layout's rows as the dashboard keeps them. */
const rowsOf = (layout: RowLayout): Dashboard["rows"] => layout.rows.map((row) => ({ ...row, cells: row.cells.map((cell) => ({ ...cell })) }));

/** An id no tile of the dashboard has. */
const freshId = (dashboard: Dashboard) => {
  const taken = new Set(dashboard.tiles.map((tile) => tile.id));
  const stamp = Date.now().toString(36);
  return [...Array(dashboard.tiles.length + 1).keys()].map((n) => `tile-${stamp}-${n}`).find((id) => !taken.has(id))!;
};

interface TileSlotProps {
  tile: Tile;
  window: AnalyticsWindow;
  scope: TileScope;
  /** When the asked projects' history starts — where all time opens. */
  firstMs: number;
  hour: number;
  /** Start of the current minute; only a tile counting minutes asks again on it. */
  minute: number;
  picked: string | null;
  editing: boolean;
  onPick: (key: string | null) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onOpenTask: (taskKey: string) => void;
  onSplit: (share: number) => void;
  /** A header of the table under the chart was clicked: the sort the tile keeps. */
  onTableSort: (sort: TileTable["sort"]) => void;
}

/** One tile and its own answer, asked again when its settings, the page's cut and filters or the hour change. */
function TileSlot({ tile, window, scope, firstMs, hour, minute, picked, onTableSort, ...card }: TileSlotProps) {
  const query = useTasksQuery<{ answer: TileAnswer; edges: number[]; nowMs: number }>(
    async (rpc) => {
      const nowMs = Date.now();
      const edges = tileEdges(tile.window, window, nowMs, firstMs);
      const answer = await rpc.call("analyticsTile", { tile, edges, ...scope, picked });
      return { answer, edges, nowMs };
    },
    ["tasks:changed"],
    // The answer reads neither the title nor the look, so typing a title or toggling the legend asks nothing again.
    [{ ...tile, title: "", display: null }, window, scope, firstMs, countsMinutes(tile) ? minute : hour, picked],
  );
  const data = query.data;
  return (
    <TileCard
      {...card}
      tile={tile}
      answer={data?.answer}
      error={query.error}
      edges={data?.edges ?? []}
      unit={columnUnit(tile.window, window)}
      nowMs={data?.nowMs ?? Date.now()}
      picked={picked}
      contents={({ pick, heading, style }) => (
        <SegmentTable
          tile={tile}
          edges={data?.edges ?? []}
          asked={data?.nowMs ?? 0}
          scope={scope}
          picked={picked}
          pick={pick}
          heading={heading}
          onSort={onTableSort}
          onOpenTask={card.onOpenTask}
          style={style}
        />
      )}
    />
  );
}

export function AnalyticsDashboard() {
  const filter = useAnalyticsFilter();
  const asked = useMemo(() => tileScope(filter), [filter]);
  const [pageRef, pageWidth] = useMeasuredWidth();
  const navigation = useTasksNavigation();
  const rpc = useTasksRpc();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const { hour, minute } = useClock(Boolean(dashboard?.tiles.some(countsMinutes)) || (editing !== null && countsMinutes(editing.draft)));
  // The boards' values, loaded only while the tile being edited filters a field that has some to offer.
  const scope = useSuggestionScope(editing?.draft.conditions.some((condition) => isSuggested(condition.field)) ?? false);
  const [picks, setPicks] = useState<Readonly<Record<string, string | null>>>({});

  const stored = useTasksQuery((client) => client.call("loadAnalyticsDashboard", {}), [], []);
  useEffect(() => {
    if (dashboard === null && stored.data !== undefined) setDashboard(stored.data ?? defaultDashboard());
  }, [dashboard, stored.data]);

  const projectsQuery = useTasksQuery((client) => client.call("listProjects", {}), ["projects:changed"], []);
  const projects = [...(projectsQuery.data?.projects ?? [])].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const reducedProjects = useTasksQuery((client) => client.call("loadReducedProjects", {}), [], []).data ?? DEFAULT_REDUCED_PROJECTS;
  // A new board only when a project, its colour or the choice changes — the charts' colours are memoised on it.
  const boardSignature = `${reducedProjects}|${projects.map((project) => `${project.id}:${project.color}`).join("|")}`;
  const board = useMemo<ChartBoard>(() => ({ projects, reducedProjects }), [boardSignature]);

  const span = useTasksQuery(
    async (client) => (filter.window === "all" ? ((await client.call("analyticsSpan", { projectIds: asked.projectIds })).firstCreatedMs ?? Date.now()) : Date.now()),
    ["tasks:changed"],
    [filter.window, asked.projectIds.join()],
  );
  const firstMs = filter.window === "all" ? (span.data ?? null) : hour;

  const [saveError, setSaveError] = useState<string | null>(null);
  const save = useCallback(
    (next: Dashboard) => {
      setDashboard(next);
      rpc.call("saveAnalyticsDashboard", next).then(
        () => setSaveError(null),
        (error: unknown) => setSaveError(`The charts were not saved — ${error instanceof Error ? error.message : String(error)}`),
      );
    },
    [rpc],
  );

  const openTask = useCallback((taskKey: string) => navigation.go({ kind: "task", taskKey }), [navigation]);

  // Escape closes the panel the way Cancel does.
  useEffect(() => {
    if (editing === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setEditing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);

  /** The dashboard as drawn: a new tile being added stands in its own row at the bottom until it is saved or dropped. */
  const shown: Dashboard | null =
    dashboard === null
      ? null
      : editing?.isNew
        ? { ...dashboard, tiles: [...dashboard.tiles, editing.draft], rows: rowsOf(insertRow({ rows: dashboard.rows }, editing.id)) }
        : dashboard;

  const tileOf = (id: string): Tile | undefined => (editing?.id === id ? editing.draft : shown?.tiles.find((tile) => tile.id === id));

  const addTile = () => {
    if (dashboard === null) return;
    const id = freshId(dashboard);
    setEditing({ id, draft: newTile(id), isNew: true });
  };

  const commit = () => {
    if (dashboard === null || editing === null) return;
    // A value picked on the old switch means nothing on a new one.
    if (dashboard.tiles.find((tile) => tile.id === editing.id)?.switch !== editing.draft.switch) setPicks((current) => ({ ...current, [editing.id]: null }));
    save(
      editing.isNew
        ? { ...dashboard, tiles: [...dashboard.tiles, editing.draft], rows: rowsOf(insertRow({ rows: dashboard.rows }, editing.id)) }
        : { ...dashboard, tiles: dashboard.tiles.map((tile) => (tile.id === editing.id ? editing.draft : tile)) },
    );
    setEditing(null);
  };

  const duplicate = (tile: Tile) => {
    if (dashboard === null) return;
    const id = freshId(dashboard);
    save({ ...dashboard, tiles: [...dashboard.tiles, { ...tile, id, title: copyTitle(tile.title) }], rows: rowsOf(insertCell({ rows: dashboard.rows }, tile.id, id)) });
  };

  const remove = (id: string) => {
    if (dashboard === null) return;
    if (editing?.id === id) setEditing(null);
    save({ ...dashboard, tiles: dashboard.tiles.filter((tile) => tile.id !== id), rows: rowsOf(removeCell({ rows: dashboard.rows }, id)) });
  };

  /** The divider of a tile let go: its chart's share, kept in the saved tile and in the draft the panel holds. */
  // A change made on the tile itself — the divider, a header's sort: into the draft while it is edited, and kept by a tile that lists its contents.
  const retouch = (id: string, change: (tile: Tile) => Tile) => {
    if (editing?.id === id) setEditing((current) => (current === null ? null : { ...current, draft: change(current.draft) }));
    // A tile whose contents are only turned on in its draft keeps nothing until it is saved.
    if (dashboard?.tiles.some((tile) => tile.id === id && tile.display.contents !== undefined)) save({ ...dashboard, tiles: dashboard.tiles.map((tile) => (tile.id === id ? change(tile) : tile)) });
  };
  const split = (id: string, share: number) => retouch(id, (tile) => ({ ...tile, display: { ...tile.display, contents: share } }));
  const sortTable = (id: string, sort: TileTable["sort"]) => retouch(id, (tile) => ({ ...tile, table: { ...tileTable(tile), sort } }));

  const relayout = (layout: RowLayout) => {
    // A tile being added has a cell but is no tile yet: only that cell goes, never the tiles sharing its row.
    if (dashboard !== null) save({ ...dashboard, rows: rowsOf(keepCells(layout, dashboard.tiles.map((tile) => tile.id))) });
  };

  return (
    <ChartColorsScope board={board}>
      <PickScope>
        <div className="relative flex h-full min-h-0">
          <div ref={pageRef} className="h-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
            <div className="flex min-h-full flex-col gap-6 px-6 py-8">
              {stored.error ? <p className="text-xs text-destructive">{stored.error}</p> : null}
              {saveError ? <p className="text-xs text-destructive">{saveError}</p> : null}

              {shown === null || pageWidth === 0 || firstMs === null ? (
                <div className="h-40 animate-pulse rounded-lg bg-muted/40" />
              ) : (
                <>
                  <RowBoard
                    layout={{ rows: shown.rows }}
                    stacked={pageWidth < STACK_BELOW_PX}
                    onChange={relayout}
                    renderCell={(id) => {
                      const tile = tileOf(id);
                      return tile === undefined ? null : (
                        <TileSlot
                          tile={tile}
                          window={filter.window}
                          scope={asked}
                          firstMs={firstMs}
                          hour={hour}
                          minute={minute}
                          // A draft whose switch reads another field has no value picked on it yet.
                          picked={editing?.id === id && editing.draft.switch !== dashboard?.tiles.find((entry) => entry.id === id)?.switch ? null : (picks[id] ?? null)}
                          editing={editing?.id === id}
                          onPick={(key) => setPicks((current) => ({ ...current, [id]: key }))}
                          onEdit={() => setEditing({ id, draft: tile, isNew: false })}
                          onDuplicate={() => duplicate(tile)}
                          onDelete={() => remove(id)}
                          onOpenTask={openTask}
                          onSplit={(share) => split(id, share)}
                          onTableSort={(sort) => sortTable(id, sort)}
                        />
                      );
                    }}
                  />
                  {editing?.isNew ? null : (
                    <button
                      type="button"
                      onClick={addTile}
                      className="flex min-h-24 shrink-0 items-center justify-center gap-1.5 rounded-lg text-sm text-muted-foreground ring-1 ring-border ring-inset hover:bg-state-hover hover:text-foreground"
                    >
                      <Icon name="Plus" className="size-3.5" />
                      Add chart
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
          {editing === null ? null : (
            // Beside the tiles on a wide screen, pushing them narrower; over them, full width, on a narrow one — as Display.
            <ClaimClicks owner={PANEL} className={cn("w-[320px] shrink-0 border-l border-border-hairline", "max-md:absolute max-md:inset-0 max-md:z-30 max-md:w-full max-md:border-l-0")}>
              <TilePanel
                draft={editing.draft}
                isNew={editing.isNew}
                scope={scope}
                onChange={(draft) => setEditing((current) => (current === null ? null : { ...current, draft }))}
                onSave={commit}
                onCancel={() => setEditing(null)}
              />
            </ClaimClicks>
          )}
        </div>
      </PickScope>
    </ChartColorsScope>
  );
}
