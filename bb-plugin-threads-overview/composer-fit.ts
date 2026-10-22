// Keeping bb's composer on the screen. bb lets the draft grow to half the
// screen, counted with no keyboard, so with the keyboard out a long draft
// pushes the composer up under the thread's header, its first lines out of
// sight and out of reach. bb's draft caps itself by a property it reads and
// never sets — `--composer-editor-available-height`; here it gets the room
// left between the draft's foot and the top of what is seen, a fixed reserve
// under the top of the screen for bb's header. The
// rule is `draftRoom` in `src/core/composer-fold.ts`, and it holds for a
// composer that grows up from its foot, as bb's do on a thread and on Home.
// While the fold has the composer's height in hand the room stays as it was:
// the box shrunk under the finger is no measure of it. With the keyboard
// coming or going, bb lays its screen out a frame later — scrolls the page
// back up and pins its shell to what is seen — so the composer is measured in
// the frame after, and again once bb has moved its shell; a measure that finds
// the composer's foot out of what is seen is a screen not laid out yet, and
// is let go.
import { draftRoom, footInView } from "./src/core/composer-fold";
import { composerInView, foldHolds } from "./composer-fold";

/** The scrolling box of the draft inside bb's composer. */
const DRAFT_SELECTOR = "[data-promptbox-editor-scroll]";

/** The property bb's draft caps its height by. */
const ROOM_PROPERTY = "--composer-editor-available-height";

/**
 * Keep `form` on the screen as the screen and the composer change size, and
 * return what hands the draft's height back to bb.
 */
export function fitComposer(form: HTMLFormElement): () => void {
  const draft = () => form.querySelector<HTMLElement>(DRAFT_SELECTOR);
  const fit = () => {
    const box = draft();
    if (box === null || foldHolds(form)) return;
    const composer = composerInView(form);
    if (!footInView(composer)) return;
    const { top: draftTop, bottom: draftBottom } = box.getBoundingClientRect();
    const room = draftRoom({ formTop: composer.top, draftTop, draftBottom, viewTop: composer.viewTop });
    box.style.setProperty(ROOM_PROPERTY, `${room}px`);
  };
  let frame = 0;
  const fitNextFrame = () => {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(fit);
  };
  fit();
  const resizes = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fitNextFrame);
  resizes?.observe(form);
  // bb marks the shell it has pinned for the keyboard on the body's style.
  const layouts = new MutationObserver(fitNextFrame);
  layouts.observe(document.body, { attributes: true, attributeFilter: ["style"] });
  const view = window.visualViewport;
  window.addEventListener("resize", fitNextFrame);
  view?.addEventListener("resize", fitNextFrame);
  view?.addEventListener("scroll", fitNextFrame);
  return () => {
    window.cancelAnimationFrame(frame);
    resizes?.disconnect();
    layouts.disconnect();
    window.removeEventListener("resize", fitNextFrame);
    view?.removeEventListener("resize", fitNextFrame);
    view?.removeEventListener("scroll", fitNextFrame);
    draft()?.style.removeProperty(ROOM_PROPERTY);
  };
}
