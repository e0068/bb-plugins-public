// Layer 2 — which shared packages the plugins and packages of the repository
// import, read from the working copy with one `git grep`
// (core/git-commands.ts `pluginImportsArgs`) and parsed by
// core/package-consumers.ts. A failed read is a reason, never an empty graph:
// an empty graph would silently skip every plugin a package change reaches.
import { parseImportOutput, type ImportEdge } from "../core/package-consumers";
import { pluginImportsArgs } from "../core/git-commands";
import { gitRunMessage, type GitPorts } from "./git-run";

export type PluginImports = { readonly ok: true; readonly edges: readonly ImportEdge[] } | { readonly ok: false; readonly reason: string };

/** `git grep` exits 1 when nothing matches — that is an empty graph, not an error. */
const NO_MATCH = 1;

export async function readPluginImports(ports: GitPorts): Promise<PluginImports> {
  const found = await ports.run(pluginImportsArgs());
  if (found.code === NO_MATCH && found.stderr.trim() === "") return { ok: true, edges: [] };
  if (found.code !== 0) return { ok: false, reason: `git grep: ${gitRunMessage(found)}` };
  return { ok: true, edges: parseImportOutput(found.stdout) };
}
