// Provider-neutral skill delivery. Copies only into the thread's managed worktree.
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { WorkStage } from "../shared/contract";

export type SkillDeliveryDeps = {
  stages: (threadId: string) => readonly WorkStage[];
  source: (name: string) => Promise<string | null>;
  warn: (message: string) => void;
};
const safeName = (name: string) => /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(name);

/** Source resolution is async; session configuration only reads the prepared catalog. */
export const createSkillDelivery = (deps: SkillDeliveryDeps) => {
  const sources = new Map<string, Map<string, string>>();
  const sync = async (threadId: string) => {
    const names = [...new Set(deps.stages(threadId).flatMap((stage) => stage.skill && stage.skill !== "-" ? [stage.skill] : []))];
    const paths = await Promise.all(names.filter(safeName).map(async (name) => [name, await deps.source(name)] as const));
    sources.set(threadId, new Map(paths.flatMap(([name, path]) => path === null ? [] : [[name, path]])));
    return sources.get(threadId)!.size > 0;
  };
  const deliver = (threadId: string, root: string | null): string | undefined => {
    if (root === null) return undefined;
    const paths = sources.get(threadId);
    if (paths === undefined) return undefined;
    const loaded: string[] = [];
    for (const [name, source] of paths) {
      try {
        const target = join(root, ".agents", "skills", name.replace(/:/g, "--"));
        // Owner's existing skills win. Flow never replaces them or clears the directory.
        if (!existsSync(target)) {
          mkdirSync(dirname(target), { recursive: true });
          cpSync(dirname(source), target, { recursive: true, dereference: true, errorOnExist: true, force: false });
        }
        const skill = join(target, "SKILL.md");
        if (existsSync(skill)) loaded.push(`- ${name}: ${skill}`);
      } catch (error) {
        deps.warn(`skill delivery: ${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return loaded.length === 0 ? undefined : `Skills for this thread's Flow are available below. Before each skill stage, read its SKILL.md; resolve supporting files relative to its directory.\n${loaded.join("\n")}`;
  };
  const forget = (threadId: string) => sources.delete(threadId);
  return { sync, deliver, forget };
};
