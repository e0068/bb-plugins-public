// Folding bb's composer with a finger. On a phone the composer and the keyboard
// under it take half the screen. Pulled down by its body — the draft and what
// sits above the buttons — the composer shrinks with the finger while the
// keyboard stays, and let go past the reach the keyboard goes as the composer
// rides down to one line — the line of text and the send button. Let go short
// of that, it stands back up and the keyboard stays. Pulled down by its panel —
// the row of buttons and the project row under it — only the keyboard goes,
// let go past the same reach, and the composer stays as it stands. A web page
// cannot carry the keyboard with a finger, so it goes on the letting go, not in
// the middle of the pull. A push up over an open composer is held, so the page
// under it does not shake. A tap on the folded composer opens it again. The
// rules live in `src/core/composer-fold.ts`; this is the hand on the composer.
//
// The listeners sit on the composer itself, not on the page: a listener that
// may hold a touch makes the browser wait on it before it scrolls, and only a
// finger on the composer is ever held here.
import {
  COMPOSER_FOLDED_HEIGHT,
  canFold,
  claimsFold,
  composerOpen,
  dismissesKeyboard,
  foldDrag,
  foldZone,
  holdsOpenComposer,
  scrollsDraftBack,
  type FoldZone,
} from "./src/core/composer-fold";
import { hasRoomBelow, type Point } from "./src/core/home-swipe";
import { inHomeLayer } from "./home-layer";

/** bb's composer, on a thread and on Home alike. */
const COMPOSER_SELECTOR = "[data-app-composer-role=primary] form[data-promptbox]";

/** The composer's shell: the form and the project row bb draws under it. */
const SHELL_SELECTOR = "[data-app-composer]";

/** The row of buttons at the foot of the form. */
const ACTION_ROW_SELECTOR = "[data-promptbox-action-row]";

/** Marks a composer bb has drawn compact itself — a thread's, once it loses focus. */
const COMPACT_ATTRIBUTE = "data-promptbox-compact";

/** The scrolling box of the draft inside it. */
const DRAFT_SELECTOR = "[data-promptbox-editor-scroll]";

/** Marks a composer folded to one line; the look is `FOLD_CSS`. */
const FOLDED_ATTRIBUTE = "data-composer-folded";

/** Marks the style element that carries `FOLD_CSS`. */
const STYLE_ATTRIBUTE = "data-composer-fold-style";

/** How long a composer let go short of the fold takes to stand back up, in ms. */
const STAND_BACK_MS = 180;

/** How long a composer let go past the reach takes to ride down to one line, in ms: about as long as the keyboard takes to go. */
const FOLD_SETTLE_MS = 250;

/**
 * One line: the toolbar under the draft, the plugins' buttons beside send and
 * the row under the composer go, the draft shows its first line, and the send
 * button stands at its right end. bb sizes the draft and its grid by inline
 * style, so the fold's sizes are marked important. A composer bb has made
 * compact itself — a thread's, once it loses focus — is one line already and
 * is left as bb draws it.
 */
const FOLD_CSS = `
form[${FOLDED_ATTRIBUTE}]:not([data-promptbox-compact]) :is([data-promptbox-expanded-only], [data-plugin-composer-action-plugin]) { display: none !important; }
form[${FOLDED_ATTRIBUTE}]:not([data-promptbox-compact]) [data-promptbox-layout] { grid-template-rows: auto !important; }
form[${FOLDED_ATTRIBUTE}]:not([data-promptbox-compact]) ${DRAFT_SELECTOR} { min-height: 0 !important; max-height: ${COMPOSER_FOLDED_HEIGHT}px !important; overflow: hidden; padding-top: 10px; padding-bottom: 10px; }
form[${FOLDED_ATTRIBUTE}]:not([data-promptbox-compact]) [data-promptbox-action-row] { position: absolute; top: 0; bottom: 0; right: 8px; padding: 0; }
form[${FOLDED_ATTRIBUTE}] ~ * { display: none !important; }
`;

/** bb's composer on the screen now, or `null` while there is none. The one under the home swipe's card is not it. */
export function findComposer(): HTMLFormElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLFormElement>(COMPOSER_SELECTOR)).find(
      (form) => !inHomeLayer(form),
    ) ?? null
  );
}

/** Put the folded look on the page, and return what takes it off. */
export function mountFoldStyle(): () => void {
  const style = document.createElement("style");
  style.setAttribute(STYLE_ATTRIBUTE, "");
  style.textContent = FOLD_CSS;
  document.head.append(style);
  return () => style.remove();
}

/** The finger of a one-finger touch, or `null` for a touch of more than one. */
export function soleFinger(event: TouchEvent): Point | null {
  const finger = event.touches.length === 1 ? event.touches[0] : undefined;
  return finger === undefined ? null : { x: finger.clientX, y: finger.clientY };
}

/** Whether `form` stands open: neither folded to one line here nor drawn compact by bb. */
export function standsOpen(form: HTMLFormElement): boolean {
  return composerOpen({
    folded: form.hasAttribute(FOLDED_ATTRIBUTE),
    compact: form.hasAttribute(COMPACT_ATTRIBUTE),
  });
}

/** A finger on the composer, from the touch that put it down. */
interface Pull {
  readonly start: Point;
  readonly zone: FoldZone;
  /** The composer stood open at the touch: a push up is held. */
  readonly open: boolean;
  /** The composer was being typed into at the touch: the keyboard is there to put away. */
  readonly typed: boolean;
  /** A pull from the body that folds: false over a draft scrolled back or a composer with nothing to fold. */
  readonly folds: boolean;
  /** The draft under the finger, if the finger is on it. */
  readonly draft: Element | null;
  last: Point | null;
}

/**
 * Let `form` be folded by a finger pulling it down, and return what lets it go,
 * folded look included. The finger is heard over the whole composer — the form
 * and the project row bb draws under it — and where it lands decides what the
 * pull folds: see `foldZone`.
 */
export function foldByDrag(form: HTMLFormElement): () => void {
  const shell = form.closest<HTMLElement>(SHELL_SELECTOR) ?? form;
  let pull: Pull | null = null;
  let full = 0;
  let settling = 0;
  const typedInto = () => form.contains(document.activeElement);
  const putKeyboardAway = () => {
    if (typedInto() && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };
  // Folded here or made compact by bb, the composer is as short as it gets,
  // whatever its border adds to the height it measures.
  const drawnAsOneLine = () => !standsOpen(form);
  const lay = (height: number, transition: string) => {
    form.style.transition = transition;
    form.style.overflow = "hidden";
    form.style.maxHeight = `${height}px`;
  };
  const release = () => {
    window.clearTimeout(settling);
    form.style.transition = "";
    form.style.overflow = "";
    form.style.maxHeight = "";
    form.style.height = "";
  };
  const standBack = () => {
    if (form.style.maxHeight === "") return;
    lay(full, `max-height ${STAND_BACK_MS}ms ease-out`);
    settling = window.setTimeout(release, STAND_BACK_MS);
  };
  // The folded look goes on at once — the line of text and the send button —
  // and the box rides from the height the finger left it at down to one line,
  // in the same breath as the keyboard goes: `height`, not `max-height`, since
  // the folded content is one line tall and would not hold a taller box open.
  const fold = () => {
    const from = form.getBoundingClientRect().height;
    release();
    form.setAttribute(FOLDED_ATTRIBUTE, "");
    putKeyboardAway();
    const border = form.offsetHeight - form.clientHeight;
    form.style.overflow = "hidden";
    form.style.height = `${from}px`;
    void form.offsetHeight;
    form.style.transition = `height ${FOLD_SETTLE_MS}ms ease-out`;
    form.style.height = `${COMPOSER_FOLDED_HEIGHT + border}px`;
    settling = window.setTimeout(release, FOLD_SETTLE_MS);
  };
  const onStart = (event: TouchEvent) => {
    release();
    pull = null;
    const point = soleFinger(event);
    const target = event.target instanceof Element ? event.target : null;
    if (point === null || target === null) return;
    const zone = foldZone({
      inActionRow: target.closest(ACTION_ROW_SELECTOR) !== null,
      inForm: form.contains(target),
    });
    const draft = target.closest(DRAFT_SELECTOR);
    full = form.getBoundingClientRect().height;
    const typed = typedInto();
    const folds =
      zone === "body" &&
      !(draft !== null && scrollsDraftBack(draft)) &&
      canFold(drawnAsOneLine() ? COMPOSER_FOLDED_HEIGHT : full, typed);
    pull = { start: point, zone, open: standsOpen(form), typed, folds, draft, last: null };
  };
  const onMove = (event: TouchEvent) => {
    const now = soleFinger(event);
    if (pull === null || now === null) return;
    // A move the browser no longer lets anyone stop is a scroll under way, not ours.
    if (!event.cancelable) {
      pull = null;
      standBack();
      return;
    }
    pull.last = now;
    const { start, draft } = pull;
    // An open composer has nothing a push up could do — see `holdsOpenComposer` —
    // unless the draft under the finger still has lines below to scroll to.
    if (holdsOpenComposer(start, now)) {
      if (pull.open && !(draft !== null && hasRoomBelow(draft))) event.preventDefault();
      return;
    }
    if (pull.zone === "panel") {
      if (pull.typed && claimsFold(start, now)) event.preventDefault();
      return;
    }
    if (!pull.folds) return;
    if (claimsFold(start, now)) event.preventDefault();
    const drag = foldDrag(start, now, full);
    if (drag.holds || form.style.maxHeight !== "") lay(drag.height, "none");
  };
  const onEnd = () => {
    const ended = pull;
    pull = null;
    if (ended !== null && ended.zone === "panel" && ended.typed && ended.last !== null) {
      if (dismissesKeyboard(ended.start, ended.last)) putKeyboardAway();
    }
    const armed =
      ended !== null && ended.zone === "body" && ended.folds && ended.last !== null
        ? foldDrag(ended.start, ended.last, full).armed
        : false;
    if (armed) fold();
    else standBack();
  };
  const onCancel = () => {
    pull = null;
    standBack();
  };
  const onFocus = () => form.removeAttribute(FOLDED_ATTRIBUTE);
  shell.addEventListener("touchstart", onStart, { passive: true });
  shell.addEventListener("touchmove", onMove, { passive: false });
  shell.addEventListener("touchend", onEnd);
  shell.addEventListener("touchcancel", onCancel);
  form.addEventListener("focusin", onFocus);
  return () => {
    shell.removeEventListener("touchstart", onStart);
    shell.removeEventListener("touchmove", onMove);
    shell.removeEventListener("touchend", onEnd);
    shell.removeEventListener("touchcancel", onCancel);
    form.removeEventListener("focusin", onFocus);
    release();
    form.removeAttribute(FOLDED_ATTRIBUTE);
  };
}
