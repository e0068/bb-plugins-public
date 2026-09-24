// Инструменты агента над коллекцией flow: `read_flows` показывает flow, каталог
// и шаги автоматизаций, `save_flow` разбирает черновик в ядре, ставит flow на
// место и сохраняет тем же хранилищем и каналом, что и страница Flow. Когда и
// из чего собирать flow — навык `flow-create`, а не инструкции каждого хода.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { STEP_IDS, STEP_LABELS } from "../packages/automation-steps/catalog";
import { resolveFlowDraft } from "../core/flow-draft";
import { putFlow } from "../core/flows";
import { flowDraftSchema, type StageCatalog } from "../shared/contract";
import type { FlowSettingsStore } from "./flow-settings";
import { STAGE_SETTINGS_CHANNEL } from "./settings-api";

export const READ_FLOWS_TOOL_NAME = "read_flows";
export const SAVE_FLOW_TOOL_NAME = "save_flow";

const toolText = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const toolError = (text: string) => ({ isError: true as const, content: [{ type: "text" as const, text }] });

export const registerFlowTools = (
  bb: Pick<BbPluginApi, "agents" | "realtime">,
  settings: FlowSettingsStore,
  deps: { catalog: () => Promise<StageCatalog>; newId: () => string },
): void => {
  bb.agents.registerTool({
    name: READ_FLOWS_TOOL_NAME,
    description:
      "Read the owner's flows in order (the first one is the default for threads without a chosen flow) with their stages, plus what a flow can be built from: skill names, executor ids (agent:… and workflow:…) and the step ids of Flow's built-in automations. Use it before save_flow, following the flow-create skill.",
    presentation: { label: { pending: "Reading flows", completed: "Flows read" } },
    parameters: z.object({}),
    async execute() {
      const catalog = await deps.catalog();
      return toolText({
        flows: settings.current().flows,
        skills: catalog.skills.map((s) => s.name).sort(),
        executors: catalog.executors.map((e) => e.id),
        steps: STEP_IDS.map((id) => ({ id, label: STEP_LABELS[id].en })),
      });
    },
  });

  bb.agents.registerTool({
    name: SAVE_FLOW_TOOL_NAME,
    description:
      "Create or replace one flow of the owner. Stages in order: built-in kinds (questions, criteria, select, demo), skill stages with a skill from the catalog and executor ids, automation stages (kind skill, no skill) and action stages (kind action, same steps, run by the owner with a button) — Flow's built-in automation { source: \"flow\", steps, scripts } where a script step is \"script:<id>\" with its script { id, name, content } in the same stage, or an Automations automation { id, name }. Ids and names left out are filled in. A flow without id is new; position puts it at that place, 0 makes it the default. Stages whose skill or executor is not in the catalog are rejected, and nothing is saved.",
    presentation: { label: { pending: "Saving the flow", completed: "Flow saved" } },
    parameters: flowDraftSchema,
    async execute(params) {
      const resolved = resolveFlowDraft(params, await deps.catalog(), deps.newId);
      if (!resolved.ok) return toolError(`Flow not saved: ${resolved.problems.join("; ")}.`);
      try {
        const saved = await settings.save(putFlow(settings.current(), resolved.flow, params.position));
        bb.realtime.publish(STAGE_SETTINGS_CHANNEL, {});
        return toolText({ saved: resolved.flow, order: saved.flows.map((f) => ({ id: f.id, name: f.name })) });
      } catch (error) {
        return toolError(`Flow not saved: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  });
};
