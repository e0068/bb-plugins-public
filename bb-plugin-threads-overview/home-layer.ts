// Home under the card. While a finger carries the thread screen home, bb's own
// composer shows beneath it, standing where it stood on Home. bb draws one
// route at a time, so there is no live Home to show while a thread is open;
// what shows is a layer this plugin holds laid out from the moment it mounts,
// so the lift only moves and shows. The rest of Home is bb's to draw once the
// finger lets go. Nothing dims it: Home is in plain view from the first pixel
// of the lift. This is the hand that shows, hands over and hides it.

import { HOME_SELECTOR, awaitHome } from "./home-screen";
import { portalScopeProps } from "./lib/portal-scope";

/** bb's composer shell inside it. */
const COMPOSER_SELECTOR = "[data-app-composer]";

/** Marks the layer. */
const LAYER_ATTRIBUTE = "data-home-swipe-home";

/** Beneath everything on the page, the carried card included. */
const BENEATH = "-1";

/** Above everything bb and other plugins put on the screen. */
const TOPMOST = "2147483000";

/** How long the layer waits over the screen for the live Home to be drawn, in ms. */
const HANDOVER_WAIT_MS = 1000;

/** How long the layer takes to fade into the live Home under it, in ms. */
const HANDOVER_FADE_MS = 150;

/**
 * The layer, unseen beneath everything until `revealHome`. Unseen by opacity,
 * not visibility: a node inside that asks to be visible would show through a
 * hidden parent. Nothing in it can be touched, focused or read aloud: it is a
 * picture of where the gesture leads, not a screen. It lies in the plugin's
 * style scope, so the section drawn in it is styled as on Home. Not yet on the
 * page — see `mountHomeLayer`.
 */
export function createHomeLayer(): HTMLElement {
  const layer = document.createElement("div");
  for (const [name, value] of Object.entries(portalScopeProps())) layer.setAttribute(name, value);
  layer.setAttribute(LAYER_ATTRIBUTE, "");
  layer.setAttribute("aria-hidden", "true");
  layer.setAttribute("inert", "");
  Object.assign(layer.style, {
    position: "fixed",
    inset: "0",
    overflow: "hidden",
    pointerEvents: "none",
    backgroundColor: "var(--background)",
  });
  hideHome(layer);
  return layer;
}

/** Put the layer on the page, first in `body`, and return what takes it off. */
export function mountHomeLayer(layer: HTMLElement): () => void {
  document.body.prepend(layer);
  return () => layer.remove();
}

/** Whether `node` lies in the layer — a picture of Home, not a composer anyone types into. */
export function inHomeLayer(node: Element): boolean {
  return node.closest(`[${LAYER_ATTRIBUTE}]`) !== null;
}

/** bb's composer on `screen` if Home is on it, or `null` if it is not. */
export function homeComposer(screen: HTMLElement): Element | null {
  return screen.querySelector(HOME_SELECTOR)?.querySelector(COMPOSER_SELECTOR) ?? null;
}

/** Bring the layer into view beneath the card. */
export function revealHome(layer: HTMLElement): void {
  layer.style.opacity = "";
}

/** Put the layer back unseen beneath everything, at once, ready for the next gesture. */
export function hideHome(layer: HTMLElement): void {
  layer.style.transition = "";
  layer.style.opacity = "0";
  layer.style.zIndex = BENEATH;
}

/**
 * Hand the screen over to the live Home, and return what calls it off. The
 * layer rises over everything the moment the card is let go, so nothing —
 * neither the flat thread nor an empty frame — shows while bb draws Home; once
 * the live Home is on `screen()`, or a second has gone by without it, the layer
 * fades into it, goes back beneath and `onHidden` hears it. Calling it off puts
 * the layer back at once, without a word to `onHidden`: whoever calls it off
 * is going away.
 */
export function handOverHome(
  layer: HTMLElement,
  screen: () => HTMLElement | null,
  onHidden: () => void = () => {},
): () => void {
  revealHome(layer);
  layer.style.zIndex = TOPMOST;
  let fading = 0;
  const stopWaiting = awaitHome(true, screen, HANDOVER_WAIT_MS, () => {
    layer.style.transition = `opacity ${HANDOVER_FADE_MS}ms ease-out`;
    layer.style.opacity = "0";
    fading = window.setTimeout(() => {
      hideHome(layer);
      onHidden();
    }, HANDOVER_FADE_MS);
  });
  return () => {
    stopWaiting();
    window.clearTimeout(fading);
    hideHome(layer);
  };
}
