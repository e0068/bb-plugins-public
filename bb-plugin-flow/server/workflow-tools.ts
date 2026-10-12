// Инструменты агента над workflow Claude Code в `~/.claude/workflows`: `workflow_read` отдаёт файл деревом конструктора
// или причину, почему конструктор его не узнаёт; `workflow_write` проверяет дерево, собирает файл, сверяет, что
// конструктор узнаёт собранное, и пишет. Рукописный файл инструмент не перезаписывает: собранный поверх стёр бы код.
// Формат дерева и порядок работы — навык `workflow-builder`.
import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { checkTree, compile, NAME_RE, recognize } from "@bb-plugins/workflow-builder/model";
import { agentsMissingTemplate } from "@bb-plugins/workflow-builder/validity";
import { WORKFLOW_BUILDER_SKILL } from "../lib/stage-constants";

export const WORKFLOW_READ_TOOL_NAME = "workflow_read";
export const WORKFLOW_WRITE_TOOL_NAME = "workflow_write";
const SKILL = WORKFLOW_BUILDER_SKILL;

export type WorkflowToolDeps = {
  /** `~/.claude/workflows` хоста сервера. */
  dir: string;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, text: string) => Promise<void>;
};

const toolText = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const toolError = (text: string) => ({ isError: true as const, content: [{ type: "text" as const, text }] });

const REASON_TEXT = {
  "hand-written": "written by hand — there is no builder mark in it",
  edited: "built by the builder, then edited by hand — the tree no longer rebuilds the file",
} as const;

const readOrNull = (deps: WorkflowToolDeps, path: string): Promise<string | null> => deps.readFile(path).catch(() => null);

export const registerWorkflowTools = (bb: Pick<BbPluginApi, "agents">, deps: WorkflowToolDeps): void => {
  bb.agents.registerTool({
    name: WORKFLOW_READ_TOOL_NAME,
    description: `Read a Claude Code workflow from ~/.claude/workflows as the builder's tree, to change it and write it back with ${WORKFLOW_WRITE_TOOL_NAME}. A file the builder can't read comes back with the reason instead of a tree. Follow the ${SKILL} skill.`,
    presentation: { label: { pending: "Reading the workflow", completed: "Workflow read" } },
    parameters: z.object({ name: z.string().describe("File name without .js, e.g. lead-waves") }),
    async execute({ name }) {
      if (!NAME_RE.test(name)) return toolError(`Workflow name "${name}": lowercase latin letters, digits and hyphens.`);
      const path = join(deps.dir, `${name}.js`);
      const source = await readOrNull(deps, path);
      if (source === null) return toolError(`No workflow ${path}.`);
      const result = recognize(source, "claude");
      return result.kind === "tree"
        ? toolText({ path, tree: result.tree })
        : toolText({
            path,
            reason: result.kind,
            note: `The builder can't open this file as a tree: it was ${REASON_TEXT[result.kind]}. ${WORKFLOW_WRITE_TOOL_NAME} won't overwrite it; build a new workflow under another name, or edit the .js by hand knowing the builder will keep it read-only.`,
          });
    },
  });

  bb.agents.registerTool({
    name: WORKFLOW_WRITE_TOOL_NAME,
    description: `Write a Claude Code workflow to ~/.claude/workflows/<tree.name>.js from the builder's tree: { name, description, phases: [{ title, mode?, steps: [agent | container] }] }. The file comes out in the builder's format, so the builder opens it as a tree. A tree with problems is rejected with every problem by node path and nothing is written; a hand-written file of the same name is never overwritten. Follow the ${SKILL} skill.`,
    presentation: { label: { pending: "Writing the workflow", completed: "Workflow written" } },
    parameters: z.object({ tree: z.unknown().describe("The workflow tree, as workflow_read returns it") }),
    async execute({ tree }) {
      const checked = checkTree(tree);
      if (!checked.ok) return toolError(`Workflow not written:\n${checked.problems.map((p) => `- ${p}`).join("\n")}`);
      const missing = agentsMissingTemplate(checked.tree);
      if (missing > 0) return toolError(`Workflow not written: ${missing} agent step(s) without agentType — the builder would mark the workflow invalid.`);
      const path = join(deps.dir, `${checked.tree.name}.js`);
      const existing = await readOrNull(deps, path);
      const kind = existing === null ? null : recognize(existing, "claude").kind;
      if (kind === "hand-written" || kind === "edited")
        return toolError(`Workflow not written: ${path} was ${REASON_TEXT[kind]}, and writing over it would erase its code. Pick another name.`);
      const source = compile(checked.tree, "claude");
      if (recognize(source, "claude").kind !== "tree") return toolError("Workflow not written: the builder can't read back what this tree compiles to — report it as a builder bug.");
      try {
        await deps.writeFile(path, source);
      } catch (error) {
        return toolError(`Workflow not written: ${error instanceof Error ? error.message : String(error)}`);
      }
      return toolText({ path, written: true, phases: checked.tree.phases.length });
    },
  });
};
