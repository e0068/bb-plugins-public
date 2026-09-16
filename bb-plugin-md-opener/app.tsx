// bb-plugin-md-opener — the fileOpener slot: .md files open with the Kasimov
// editor. Rendering and all interactivity (the jump stack within the SAME
// tab, editing, CAS) live in the shared packages/md-doc-view layer; this file
// is just thin RPC wiring for its contract — load/save/resolveLinkTarget
// close over the tab's opaque `source`. Path/host resolution and
// link-liveness annotation are computed by server.ts.
import { useRef } from "react";
import { definePluginApp, useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import type { PluginFileOpenerProps } from "@get-bb/plugin-sdk/app";

import { MdDocView } from "./packages/md-doc-view";
import type {
  LoadedDoc,
  RevealResult,
  SaveResult,
} from "./packages/md-doc-view";
import {
  NATIVE_VIEWER_TOKEN_DEFAULTS,
  parseKasimovSettings,
  kasimovCssVars,
  kasimovFlags,
} from "./packages/md-doc-view";
import {
  isInTabLink,
  parseHref,
  resolveRelative,
} from "./packages/link-navigation/resolve";
import { mountComposerFormatBarIfEnabled } from "./src/composer-bar-content";
import { installMermaid } from "./src/mermaid-bootstrap";
import { docLibraries } from "./libraries";
import type { rpcContract } from "./server";

function DocOpener({ path, source }: PluginFileOpenerProps) {
  const rpc = useRpc<typeof rpcContract>();
  // Kasimov's own look and flags come from this plugin's settings (separate
  // from Cloud Config). parse is total: while useSettings is still loading,
  // defaults come from kasimov.css.
  // The same preset defaults server.ts registered with buildDescriptors. Hand
  // them over, or the document is the engine's black until useSettings()
  // answers — and stays black on a remount that gets no values.
  const settings = parseKasimovSettings(useSettings().values, NATIVE_VIEWER_TOKEN_DEFAULTS);
  const vars = kasimovCssVars(settings);
  const flags = kasimovFlags(settings);
  // Map of live links for the last document read: href → abs (from the
  // server, `~` already expanded). resolveLinkTarget takes abs from here
  // instead of expanding `~` itself.
  const linksRef = useRef<Map<string, string>>(new Map());

  const load = async (target: string): Promise<LoadedDoc> => {
    const res = await rpc.call("readDoc", { path: target, source });
    linksRef.current = new Map(res.links.map((l) => [l.href, l.abs]));
    return {
      path: res.path,
      content: res.content,
      sha256: res.sha256,
      error: res.error,
    };
  };

  const save = (
    target: string,
    content: string,
    expectedSha256: string | null,
  ): Promise<SaveResult> =>
    rpc.call("writeDoc", { path: target, source, content, expectedSha256 });

  const onReveal = (target: string): Promise<RevealResult> =>
    rpc.call("revealDoc", { path: target, source });

  // All in-tab links are clickable (as in the native viewer); external (http)
  // links resolve to null. Single shared resolver
  // (memory/decisions/link-resolve-shared-layer.md).
  const resolveLinkTarget = (href: string, fromPath: string): string | null =>
    isInTabLink(href)
      ? linksRef.current.get(href) ??
        resolveRelative(fromPath, parseHref(href).path)
      : null;

  // Changing the file OR the source tab rebuilds the view (stack/draft). The
  // key is over source's PRIMITIVES, not the object: the host may recreate
  // source with the same values, and that shouldn't reset the tab
  // (memory/wiki/bb-plugin-file-opener-slot.md).
  const resetKey = `${path}|${source.kind}|${source.threadId}|${source.environmentId}|${source.projectId}`;

  return (
    <MdDocView
      key={resetKey}
      libraries={docLibraries}
      initialPath={path}
      load={load}
      save={save}
      onReveal={onReveal}
      resolveLinkTarget={resolveLinkTarget}
      // The tab owns its surface, so an unsaved draft may hold the rest of the
      // app under a shade until it is saved or discarded.
      guardDraft
      vars={vars}
      // All engine flags at once (toFlags returns exactly the MdDocView flag
      // props): a hand-written list is one `atLinks` away from a setting that
      // silently does nothing — see
      // memory/decisions/kasimov-atlink-click-guard.md.
      {...flags}
    />
  );
}

export default definePluginApp((app) => {
  // Before any MdDocView mounts, so Kasimov's own mermaid renderer picks it
  // up on the first render pass (see src/mermaid-bootstrap.ts for why this
  // lives in the plugin, not the shared packages/md-doc-view layer).
  installMermaid(window);

  app.slots.fileOpener({
    id: "md-opener",
    title: "Kasimov",
    extensions: ["md", "markdown"],
    component: DocOpener,
  });

  // Kasimov в композере: панель форматирования над композером треда, под
  // флагом "Kasimov: use in Composer" (по умолчанию выключен). Content
  // script, а не баннер композера: панель обязана висеть над выделением и
  // заменять его, а ComposerCustomization выделения не отдаёт — см.
  // memory/decisions/kasimov-composer-bar-needs-content-script.md.
  app.contentScripts.register({
    id: "composer-format-bar",
    mount: (context) => mountComposerFormatBarIfEnabled(context),
  });
});
