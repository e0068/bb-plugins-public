// bb's Home on a narrow screen, as the layers laid over it see it: whether it
// is on the page, and a wait for it to come or go. bb draws one route at a
// time, so Home's arrival and departure are how a layer knows bb has finished
// a change of screen.

/** bb's Home on a narrow screen: in the tree exactly while Home is on the screen. */
export const HOME_SELECTOR = "[data-testid=root-compose-compact-home]";

/** How often Home is looked for while waiting, in ms: once a frame. */
const POLL_MS = 16;

/**
 * Call `then` once Home's presence under `within()` is `shown` — at once if it
 * already is — or once `waitMs` has gone by without that, and return what
 * calls the wait off.
 */
export function awaitHome(
  shown: boolean,
  within: () => ParentNode | null,
  waitMs: number,
  then: () => void,
): () => void {
  const deadline = Date.now() + waitMs;
  let timer = 0;
  const look = () => {
    const onScreen = (within()?.querySelector(HOME_SELECTOR) ?? null) !== null;
    if (onScreen === shown || Date.now() >= deadline) then();
    else timer = window.setTimeout(look, POLL_MS);
  };
  look();
  return () => window.clearTimeout(timer);
}
