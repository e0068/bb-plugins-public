// Файл workflow для открывателя .js в правой панели: прочитать, записать, агенты шаблона шага и модели провайдеров.
// Путь проверяет ядро (core/workflow-file): только верхний уровень `~/.claude/workflows` и `.bb/workflows` — иначе
// открыватель стал бы дверью к любому файлу хоста.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { z } from "zod";

import { workflowFileEngine, type WorkflowAgentOption } from "../core/workflow-file";
import { workflowFilesRpcContract } from "../shared/contract";

export type WorkflowFileDeps = {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, text: string) => Promise<void>;
  agents: () => Promise<WorkflowAgentOption[]>;
  providers: () => Promise<z.output<typeof workflowFilesRpcContract.workflowProviders.output>>;
};

const workflowPath = (path: string): string => {
  if (workflowFileEngine(path) === null) throw new Error(`Not a workflow file: ${path}`);
  return path;
};

export const registerWorkflowFiles = (bb: Pick<BbPluginApi, "rpc">, deps: WorkflowFileDeps): void => {
  bb.rpc.register(workflowFilesRpcContract, {
    workflowRead: async ({ path }) => ({ source: await deps.readFile(workflowPath(path)) }),
    workflowSave: async ({ path, source }) => {
      await deps.writeFile(workflowPath(path), source);
      return { path };
    },
    workflowAgents: () => deps.agents(),
    workflowProviders: () => deps.providers(),
  });
};

/** Модели провайдеров bb: сбой одного провайдера не гасит остальных. */
export const readProviderModels = async (bb: Pick<BbPluginApi, "sdk">): Promise<z.output<typeof workflowFilesRpcContract.workflowProviders.output>> =>
  Promise.all(
    (await bb.sdk.providers.list()).map(async (p) => {
      const models = await bb.sdk.providers.models({ providerId: p.id }).then(
        (res) => res.models.map((m) => ({ id: m.id, efforts: m.supportedReasoningEfforts.map((e) => e.reasoningEffort) })),
        () => [],
      );
      return { id: p.id, name: p.displayName || p.id, models };
    }),
  );
