// Layer 1 — which plugins bb runs from folders of the checkout `Pull Main`
// just moved, and so keep running the old build until reinstalled from the
// same folder. Zero effects: installed plugins, the checkout and the touched
// ids arrive as arguments.
//
// bb pins a `path:` install: an update leaves it where it is, so a merged
// change to a plugin the owner runs from the integration copy never reaches
// bb on its own (BBPL-962). A reinstall from the same folder builds it again
// and keeps its settings, secrets and schedules.
import { isLocalSource } from "./reinstall-plan";

/** A plugin to reinstall from its own folder. */
export interface LocalRefresh {
  readonly pluginId: string;
  readonly source: string;
}

const PLUGIN_DIR_PREFIX = "bb-plugin-";

const withoutTrailingSlash = (path: string): string => path.replace(/\/+$/, "");

/** Every touched plugin bb runs from `<checkout>/bb-plugin-<id>`, in the order bb lists them. */
export function localRefreshes(
  plugins: readonly { readonly id: string; readonly source: string }[],
  checkout: string,
  touchedIds: readonly string[],
): LocalRefresh[] {
  const root = withoutTrailingSlash(checkout);
  return plugins
    .filter(({ id, source }) => touchedIds.includes(id) && isLocalSource(source) && withoutTrailingSlash(source.slice("path:".length)) === `${root}/${PLUGIN_DIR_PREFIX}${id}`)
    .map(({ id, source }) => ({ pluginId: id, source }));
}
