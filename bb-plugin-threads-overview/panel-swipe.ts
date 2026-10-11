// The right panel of a thread, carried by a finger. On a phone bb opens it with
// the button at the top of the window and lets a swipe only close it. Open, it
// fills the screen and bb's page lies pushed off to the left; closed, it waits
// beneath the page, unseen. So a finger from the right edge pushes the page to
// the left and shows the panel beneath, pixel for pixel; let go past the
// threshold, bb's own button is pressed at once and the page rides on from
// where the finger left it, held there by hand until bb holds it itself; let go
// short of it, the page rides back.
//
// Open, bb lays the panel over its page, and its own swipe to close the panel
// moves the page beneath it, out of sight. So while a finger is on the open
// panel the page is lifted over it, and bb's swipe brings the thread back in
// from the left under the finger — see `liftPageOverPanel`.
// The rules live in `src/core/edge-swipe.ts`; this is the hand on the page.
import { claimsPanelSwipe, opensPanel, panelProgress } from "./src/core/edge-swipe";
import type { Point } from "./src/core/home-swipe";

/**
 * bb's button that opens and closes the right panel: in the window's chrome on
 * a wide screen, in the thread's header on a phone, where it carries no test
 * id — only its icon.
 */
const TOGGLE_SELECTOR =
  '[data-testid=window-right-panel-toggle], [data-thread-header-pane-actions] button:has([data-icon="PanelRight"])';

/** The right panel itself, beneath the page while closed and over it while open. */
export const SHELF_SELECTOR = "[data-testid=secondary-panel-shelf]";

/** bb's page, which the open panel pushes off to the left. */
export const INSET_SELECTOR = '[data-sidebar="inset"]';

/** How long the page takes to ride off or back once the finger lets go, in ms — as long as bb's own. */
export const PANEL_SETTLE_MS = 220;

/**
 * How long bb is given, past the ride, to stand its panel open or closed, in
 * ms: on a phone the panel takes a while to draw, and the page is held by hand
 * meanwhile.
 */
const BB_WAIT_MS = 2000;

/** Above the open panel, which bb stands at 45 over its page. */
const OVER_PANEL = "46";

/** bb's own easing for its panels. */
const PANEL_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

/** The page of the last swipe, still riding off or back. */
interface Settling {
  /** Whether bb's button was pressed: the ride ends with the panel open. */
  readonly opens: boolean;
  /** Stop the ride and hand the page to bb as it stands. */
  readonly stop: () => void;
}

/** One page, one ride at a time: every swipe and every listener share bb's page. */
let settling: Settling | null = null;

/** The finger's lift on the open panel last heard, still waiting for bb to put its page down. */
let lowering: (() => void) | null = null;

/**
 * Stop the ride of the last swipe and hand the page to bb, so the next swipe
 * starts on a page standing still; whether that ride opens the panel. A page
 * still lifted over the panel is put down.
 */
export function abandonPanelSettle(): boolean {
  lowering?.();
  const ride = settling;
  if (ride === null) return false;
  settling = null;
  ride.stop();
  return ride.opens;
}

/**
 * Wait, frame by frame, until `ready` or `BB_WAIT_MS` has gone by, then `then`;
 * return what stops the wait unfinished.
 */
function waitForBb(ready: () => boolean, then: () => void): () => void {
  const since = performance.now();
  let frame = 0;
  const look = () => {
    if (ready() || performance.now() - since >= BB_WAIT_MS) then();
    else frame = window.requestAnimationFrame(look);
  };
  look();
  return () => window.cancelAnimationFrame(frame);
}

/**
 * Lift bb's page over its open panel for a finger put down on the panel, and
 * return what lowers it once the finger is gone. bb's own swipe to close the
 * panel carries the page under the finger; lifted, the page is seen coming in
 * from the left. It is lowered once bb has let go of it and closed the panel —
 * the page standing where bb's own style holds it, over a panel no longer laid
 * over it — so nothing is seen to jump; a close called off leaves the page off
 * to the left, where it is lowered unseen once the wait runs out. A ride of the
 * last swipe still under way is stopped first: its end would take the page
 * from under bb's swipe.
 */
export function liftPageOverPanel(): () => void {
  abandonPanelSettle();
  const inset = document.querySelector<HTMLElement>(INSET_SELECTOR);
  if (inset === null) return () => {};
  inset.style.zIndex = OVER_PANEL;
  return () => {
    let stopWaiting = () => {};
    const lower = () => {
      stopWaiting();
      lowering = null;
      inset.style.removeProperty("z-index");
    };
    lowering = lower;
    stopWaiting = waitForBb(
      () => inset.style.translate === "" && inset.getAttribute("data-panel-shelf") !== "full",
      lower,
    );
  };
}

/** A finger carrying the right panel. */
export interface PanelDrag {
  /** Whether the finger's move to `now` is the panel's, kept from the page. */
  readonly holds: (now: Point) => boolean;
  /** The finger moved to `now`. */
  readonly move: (now: Point) => void;
  /** The finger is gone: lifted when `completed`, taken away when not. */
  readonly end: (completed: boolean) => void;
}

/**
 * Carry the right panel under a finger put down at `start`, or `null` when this
 * screen has no right panel to open — no button for it, or the panel is open.
 * A ride of the last swipe still under way is stopped first: one let go past
 * the threshold has already pressed bb's button, so this finger finds the panel open.
 */
export function dragThreadPanel(start: Point): PanelDrag | null {
  // bb may not yet show the panel it was just told to open: this finger finds it open all the same.
  if (abandonPanelSettle()) return null;
  const toggle = document.querySelector<HTMLElement>(TOGGLE_SELECTOR);
  const shelf = document.querySelector<HTMLElement>(SHELF_SELECTOR);
  const inset = document.querySelector<HTMLElement>(INSET_SELECTOR);
  if (toggle === null || shelf === null || inset === null) return null;
  if (toggle.getAttribute("aria-expanded") === "true") return null;

  let last = start;
  let lastTime = performance.now();
  let velocityX = 0;
  let shown = false;
  // Decided once, on the first move: a finger that set out scrolling the
  // conversation is the conversation's to the end, wherever it wanders.
  let claimed: boolean | null = null;
  let ended = false;
  const decide = (now: Point): boolean => {
    if (claimed === null && (now.x !== start.x || now.y !== start.y)) claimed = claimsPanelSwipe(start, now);
    return claimed === true;
  };

  const show = (progress: number, ease: boolean) => {
    shown = true;
    // Shown whole and across the screen beneath the page, as it stands open.
    shelf.style.visibility = "visible";
    shelf.style.width = "100%";
    shelf.style.transition = "none";
    inset.style.translate = `${-window.innerWidth * progress}px`;
    inset.style.transition = ease ? `translate ${PANEL_SETTLE_MS}ms ${PANEL_EASE}` : "none";
    // Kept over the panel even once bb stands it open over the page mid-ride.
    inset.style.zIndex = OVER_PANEL;
  };
  const clear = () => {
    for (const style of [shelf.style, inset.style]) {
      style.removeProperty("visibility");
      style.removeProperty("width");
      style.removeProperty("transition");
      style.removeProperty("translate");
      style.removeProperty("z-index");
    }
  };
  // Let the page ride off and open the panel, or ride back and leave it
  // closed. bb's button is pressed at the lift, not at the end of the ride: bb
  // draws its panel while the page rides, and the page is held where the ride
  // left it until bb stands it there itself, or it would flash back across the
  // screen and come again.
  const settle = (opens: boolean) => {
    show(opens ? 1 : 0, true);
    if (opens) toggle.click();
    let stopWaiting = () => {};
    const done = () => {
      if (settling === ride) settling = null;
      clear();
    };
    const timer = window.setTimeout(() => {
      stopWaiting = waitForBb(() => !opens || inset.getAttribute("data-panel-shelf") === "full", done);
    }, PANEL_SETTLE_MS);
    const ride: Settling = {
      opens,
      stop: () => {
        window.clearTimeout(timer);
        stopWaiting();
        clear();
      },
    };
    settling = ride;
  };

  return {
    holds: decide,
    move: (now) => {
      const time = performance.now();
      if (time > lastTime) velocityX = ((now.x - last.x) / (time - lastTime)) * 1000;
      last = now;
      lastTime = time;
      if (!ended && decide(now)) show(panelProgress(start, now, window.innerWidth), false);
    },
    end: (completed) => {
      if (ended) return;
      ended = true;
      if (!shown) return;
      const progress = panelProgress(start, last, window.innerWidth);
      settle(completed && opensPanel(progress, velocityX));
    },
  };
}
