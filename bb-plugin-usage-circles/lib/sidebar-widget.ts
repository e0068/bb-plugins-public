// Layer 3 — assembly. Mounts the widget into the sidebar footer menu (not an
// official plugin slot: BB has no rich-content sidebar-footer slot, only the
// single-icon-button `sidebarFooterAction` — see the plugin-authoring guide's
// "Trusted frontend content scripts" section, which is exactly this case),
// polls state over the plugin's own RPC wire endpoint (the same
// `/api/v1/plugins/<id>/rpc/<method>` contract useRpc() calls — there is no
// hook-based RPC client outside a React tree), and reacts to toggle/usage
// changes on a fixed interval.
//
// Layout/colors below are plain inline styles, not Tailwind utility classes:
// `bb plugin build` only extracts Tailwind classes referenced from .tsx
// source — this plugin has no JSX at all, so utility classes used here
// previously compiled to nothing and the whole widget rendered as an empty,
// unstyled box (see lib/render/ring.ts for the same note).
import { buildUsageWindowModel, statusLabel, type UsageResultWire, type UsageWindowModel } from "./usage-model";
import { buildRingIcon, buildWindowRow } from "./render";

const POLL_MS = 60_000;
// Re-attaching to the footer is checked far more often than data is fetched.
// A settings save (and any host re-render of the sidebar) replaces the footer
// menu node and orphans our row; tying re-attach to the 60s data poll left the
// widget gone for up to a minute after every save — the reported "исчез на
// save, сам вернулся через время".
const MOUNT_RETRY_MS = 2_000;
const PANEL_WIDTH_PX = 288;
const PANEL_GAP_PX = 8;

interface StateWire {
  toggles: { fiveHour: boolean; weekly: boolean; fable: boolean };
  openOnHover: boolean;
  usage: UsageResultWire;
}

// Grace period before a hover-opened panel closes, so the pointer can cross the
// gap between the footer button and the portalled panel without it snapping shut.
const HOVER_CLOSE_MS = 180;

interface RpcEnvelope<T> {
  ok: boolean;
  result?: T;
  error?: { message?: string };
}

function div(className: string, style: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const node = document.createElement("div");
  node.className = className;
  Object.assign(node.style, style);
  return node;
}

// Live data labels the 5-hour window "Current session", not "5-hour limit" —
// see lib/core/usage-model.ts's inferWindowDurationMs for the same two-signal
// match (an explicit hour count is a fallback, not the primary signal).
function isFiveHourWindow(label: string): boolean {
  return /\d+\s*-?\s*hour/i.test(label) || /session/i.test(label);
}

function isFableWindow(label: string): boolean {
  return /fable/i.test(label);
}

/** Which sidebar toggle governs one window, by its label. Anything that is
 * neither hour-cycle nor Fable-labelled is treated as the plain weekly window. */
function toggleForWindow(label: string, toggles: StateWire["toggles"]): boolean {
  if (isFiveHourWindow(label)) return toggles.fiveHour;
  if (isFableWindow(label)) return toggles.fable;
  return toggles.weekly;
}

async function fetchState(pluginId: string, signal: AbortSignal): Promise<StateWire | null> {
  try {
    const response = await fetch(`/api/v1/plugins/${pluginId}/rpc/getState`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
      credentials: "same-origin",
      signal,
    });
    const payload = (await response.json()) as RpcEnvelope<StateWire>;
    if (!response.ok || !payload.ok || payload.result === undefined) return null;
    return payload.result;
  } catch {
    return null;
  }
}

function footerMenu(): HTMLElement | null {
  const footers = Array.from(document.querySelectorAll<HTMLElement>('[data-sidebar="footer"]'));
  const footer = footers.find((candidate) => candidate.getClientRects().length > 0) ?? footers[0] ?? null;
  return footer?.querySelector<HTMLElement>('[data-sidebar="menu"]') ?? null;
}

function buildDetailsPanel(models: UsageWindowModel[]): HTMLDivElement {
  // Fixed + portalled to document.body (not appended under the sidebar
  // footer's own DOM), with a z-index above every other overlay: the footer
  // menu is a narrow, potentially clipped/scrolling container, and a
  // child positioned relative to it stayed trapped inside — obscured behind
  // or cut off by the sidebar instead of floating on top like a real popover.
  const panel = div("usage-circles__panel", {
    position: "fixed",
    zIndex: "9999",
    width: `${PANEL_WIDTH_PX}px`,
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    backgroundColor: "var(--card)",
    padding: "12px",
    boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.3), 0 4px 6px -4px rgb(0 0 0 / 0.3)",
  });
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Лимиты Claude Code");
  models.forEach((model) => panel.append(buildWindowRow(model)));
  return panel;
}

function positionPanel(panel: HTMLDivElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const left = Math.min(Math.max(PANEL_GAP_PX, rect.left), window.innerWidth - PANEL_WIDTH_PX - PANEL_GAP_PX);
  panel.style.left = `${left}px`;
  panel.style.bottom = `${window.innerHeight - rect.top + PANEL_GAP_PX}px`;
}

export function mountSidebarUsageCircles(pluginId: string, signal: AbortSignal): () => void {
  let root: HTMLLIElement | null = null;
  let panel: HTMLDivElement | null = null;
  let expanded = false;
  let state: StateWire | null = null;
  let hoverCloseTimer: number | null = null;
  const controller = new AbortController();
  signal.addEventListener("abort", () => controller.abort(), { once: true });

  const cancelHoverClose = (): void => {
    if (hoverCloseTimer !== null) {
      window.clearTimeout(hoverCloseTimer);
      hoverCloseTimer = null;
    }
  };

  const scheduleHoverClose = (): void => {
    cancelHoverClose();
    hoverCloseTimer = window.setTimeout(() => {
      hoverCloseTimer = null;
      if (expanded) {
        expanded = false;
        render();
      }
    }, HOVER_CLOSE_MS);
  };

  const closePanel = (): void => {
    panel?.remove();
    panel = null;
  };

  const render = (): void => {
    if (root === null) return;
    root.replaceChildren();
    closePanel();

    if (state === null) return;

    if (state.usage.status !== "ok") {
      const message = document.createElement("span");
      message.className = "usage-circles__status";
      Object.assign(message.style, { padding: "0 8px", fontSize: "12px", color: "var(--muted-foreground)" });
      message.textContent = statusLabel(state.usage.status, state.usage.status === "error" ? state.usage.message : undefined);
      root.append(message);
      return;
    }

    const now = Date.now();
    const allModels = state.usage.windows.map((window) => buildUsageWindowModel(window, now));
    const visibleModels = allModels.filter((model) => toggleForWindow(model.label, state!.toggles));

    const wrapper = div("usage-circles__strip", {
      position: "relative",
      display: "flex",
      alignItems: "center",
      gap: "4px",
      padding: "4px 8px",
    });

    const button = document.createElement("button");
    button.type = "button";
    button.className = "usage-circles__toggle";
    Object.assign(button.style, {
      display: "flex",
      alignItems: "center",
      gap: "4px",
      borderRadius: "6px",
      padding: "4px",
      backgroundColor: "transparent",
      border: "none",
      cursor: "pointer",
    });
    button.addEventListener("mouseenter", () => {
      button.style.backgroundColor = "var(--accent)";
    });
    button.addEventListener("mouseleave", () => {
      button.style.backgroundColor = "transparent";
    });
    button.setAttribute("aria-expanded", String(expanded));
    button.setAttribute(
      "aria-label",
      visibleModels.length === 0 ? "Лимиты Claude Code" : `Лимиты Claude Code: ${visibleModels.map((m) => `${m.label} ${Math.round(m.usedPercent)}%`).join(", ")}`,
    );
    visibleModels.forEach((model) => button.append(buildRingIcon(model)));
    if (visibleModels.length === 0) {
      const dot = document.createElement("span");
      dot.className = "usage-circles__empty";
      Object.assign(dot.style, {
        width: "8px",
        height: "8px",
        borderRadius: "9999px",
        backgroundColor: "var(--muted-foreground)",
        opacity: "0.4",
      });
      button.append(dot);
    }
    button.addEventListener("click", () => {
      cancelHoverClose();
      expanded = !expanded;
      render();
    });
    if (state.openOnHover) {
      button.addEventListener("mouseenter", () => {
        cancelHoverClose();
        if (!expanded) {
          expanded = true;
          render();
        }
      });
      button.addEventListener("mouseleave", scheduleHoverClose);
    }
    wrapper.append(button);
    root.append(wrapper);

    if (expanded) {
      panel = buildDetailsPanel(allModels);
      // Keep a hover-opened panel open while the pointer is over it, and let it
      // close once the pointer leaves — mirroring the button's own handlers.
      if (state.openOnHover) {
        panel.addEventListener("mouseenter", cancelHoverClose);
        panel.addEventListener("mouseleave", scheduleHoverClose);
      }
      document.body.append(panel);
      positionPanel(panel, button);
    }
  };

  // Re-checked on its own MOUNT_RETRY_MS tick (see below), separate from the
  // 60s data poll, and not watched via a MutationObserver: ensureMounted() is
  // two cheap querySelectors that early-return once attached, so a short
  // interval is far lighter than a whole-document observer, which would fire
  // on every unrelated DOM change in the app (message streaming, other
  // plugins).
  const ensureMounted = (): void => {
    if (controller.signal.aborted) return;
    const menu = footerMenu();
    if (menu === null) {
      root?.remove();
      root = null;
      closePanel();
      return;
    }
    if (root !== null && root.parentElement === menu) return;
    root?.remove();
    root = document.createElement("li");
    root.className = "usage-circles";
    root.setAttribute("data-sidebar", "menu-item");
    // The sidebar footer menu is a horizontal row of icon buttons (Settings,
    // the mobile handoff, devtools), not a vertical stack. To sit in the
    // bottom-right corner the rings must be the LAST item (append, not
    // prepend) and hug the right edge: in a flex row an `auto` inline-start
    // margin absorbs the free space to its left, shoving this <li> — and only
    // it — against the far right, leaving BB's own controls on the left. The
    // earlier `width:100%`+`flex-end` on the inner strip was a no-op here: the
    // <li> is content-width in a row, so there was nothing to right-align
    // against, and prepend left the rings on the far left.
    root.style.marginLeft = "auto";
    menu.append(root);
    render();
  };

  const load = async (): Promise<void> => {
    ensureMounted();
    const next = await fetchState(pluginId, controller.signal);
    if (controller.signal.aborted || next === null) return;
    state = next;
    render();
  };

  void load();
  const pollInterval = window.setInterval(() => void load(), POLL_MS);
  // Re-attach on its own fast cadence, independent of data fetches: recovers
  // the widget within MOUNT_RETRY_MS after the host swaps the footer node
  // (e.g. a settings save) instead of waiting for the next 60s poll. render()
  // reuses the last fetched `state`, so no extra RPC traffic.
  const mountInterval = window.setInterval(ensureMounted, MOUNT_RETRY_MS);
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!expanded || !(event.target instanceof Node)) return;
      const insideRoot = root !== null && root.contains(event.target);
      const insidePanel = panel !== null && panel.contains(event.target);
      if (!insideRoot && !insidePanel) {
        expanded = false;
        render();
      }
    },
    { signal: controller.signal },
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && expanded) {
        expanded = false;
        render();
      }
    },
    { signal: controller.signal },
  );
  window.addEventListener(
    "resize",
    () => {
      const button = root === null ? null : root.querySelector<HTMLElement>(".usage-circles__toggle");
      if (panel !== null && button !== null) positionPanel(panel, button);
    },
    { signal: controller.signal },
  );

  // One cleanup path for both triggers (the host aborting `signal`, or the
  // caller invoking the returned disposer): both just call controller.abort()
  // — idempotent, and the actual teardown runs once, on that signal's own
  // "abort" event, instead of being duplicated in two branches.
  controller.signal.addEventListener(
    "abort",
    () => {
      window.clearInterval(pollInterval);
      window.clearInterval(mountInterval);
      cancelHoverClose();
      root?.remove();
      root = null;
      closePanel();
    },
    { once: true },
  );

  return () => controller.abort();
}
