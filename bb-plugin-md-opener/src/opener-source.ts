// Layer 2 — the tab's source: get a host and a root for reading/writing out
// of a PluginFileOpenerSource. The only bb-I/O here goes through the passed-in
// `bb` (the module doesn't import it at the top level — type-only), so this
// layer is testable with a mock object, no live SDK needed.
//
// What `source.kind` determines (see
// memory/wiki/bb-plugin-file-opener-slot.md):
//   workspace      — the path is relative to the environment's workdir; root
//                    = env.path;
//   thread-storage — the path is relative to the thread's storage root;
//   host           — the path is absolute, there's NO root fence (the file
//                    may live on a different machine —
//                    memory/decisions/opener-host-path-no-home-fence.md).
//
// The host is needed for ALL file calls: skipping it on a remote machine
// kills the feature entirely, not just "degrades it slightly".
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export interface OpenerSource {
  kind: "host" | "thread-storage" | "workspace";
  threadId: string | null;
  environmentId: string | null;
  projectId: string | null;
}

export interface ResolvedSource {
  /** The files host (undefined — the bb server's local host). */
  hostId: string | undefined;
  /**
   * The absolute root that reads/writes are confined below (rootPath,
   * symlink-safe). undefined for kind:"host" — there's intentionally no
   * boundary there.
   */
  root: string | undefined;
}

/**
 * Resolves source into { hostId, root }. Returns null when the source
 * doesn't provide what's needed (no environmentId for workspace, no
 * threadId for thread-storage, the environment doesn't have a path yet) —
 * the caller turns this into a clear error instead of reading outside the
 * root.
 */
export async function resolveSource(
  bb: BbPluginApi,
  source: OpenerSource,
): Promise<ResolvedSource | null> {
  if (source.kind === "workspace") {
    if (!source.environmentId) return null;
    const env = await bb.sdk.environments.get({
      environmentId: source.environmentId,
    });
    if (!env.path) return null;
    return { hostId: env.hostId, root: env.path };
  }

  // For thread-storage/host, the host comes from the environment (that's
  // where the thread's file hostId lives). No environment — local host.
  const hostId = source.environmentId
    ? (await bb.sdk.environments.get({ environmentId: source.environmentId }))
        .hostId
    : undefined;

  if (source.kind === "thread-storage") {
    if (!source.threadId) return null;
    const storage = await bb.sdk.threads.storageFiles({
      threadId: source.threadId,
    });
    return { hostId, root: storage.storageRootPath };
  }

  // host — the path is absolute, there's no fence.
  return { hostId, root: undefined };
}
