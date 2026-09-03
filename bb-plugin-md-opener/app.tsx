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
import type { LoadedDoc, SaveResult } from "./packages/md-doc-view";
import {
  parseKasimovSettings,
  kasimovCssVars,
  kasimovFlags,
} from "./packages/md-doc-view";
import {
  isInTabLink,
  parseHref,
  resolveRelative,
} from "./packages/link-navigation/resolve";
import type { rpcContract } from "./server";

function DocOpener({ path, source }: PluginFileOpenerProps) {
  const rpc = useRpc<typeof rpcContract>();
  // Kasimov's own look and flags come from this plugin's settings (separate
  // from Cloud Config). parse is total: while useSettings is still loading,
  // defaults come from kasimov.css.
  const settings = parseKasimovSettings(useSettings().values);
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
      initialPath={path}
      load={load}
      save={save}
      resolveLinkTarget={resolveLinkTarget}
      vars={vars}
      followLinks={flags.followLinks}
      atLinks={flags.atLinks}
      frontmatter={flags.frontmatter}
      mermaidNodes={flags.mermaidNodes}
    />
  );
}

export default definePluginApp((app) => {
  app.slots.fileOpener({
    id: "md-opener",
    title: "Kasimov",
    extensions: ["md", "markdown"],
    component: DocOpener,
  });
});
