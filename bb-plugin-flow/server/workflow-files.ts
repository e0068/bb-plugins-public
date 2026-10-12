// Файл workflow для открывателя .js в правой панели: прочитать, записать, агенты шаблона шага и модели провайдеров.
// Путь проверяет ядро (core/workflow-file): только верхний уровень `~/.claude/workflows` и `.bb/workflows` — иначе
// открыватель стал бы дверью к любому файлу хоста. Файл агента над настройками шага — только из списка агентов-шаблонов.
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { readMetaDescription, recognize } from "@bb-plugins/workflow-builder/model";
import type { z } from "zod";

import { workflowFileEngine, type WorkflowAgentOption } from "../core/workflow-file";
import { workflowFilesRpcContract } from "../shared/contract";

export type WorkflowFileDeps = {
  /** `~/.claude/workflows` хоста сервера — список раздела Workflows и папка новых workflow. */
  dir: string;
  listDir: (dir: string) => Promise<string[]>;
  readFile: (path: string) => Promise<string>;
  /** `exclusive` — файла с этим путём быть не должно: занятый путь — ошибка, а не перезапись. */
  writeFile: (path: string, text: string, exclusive?: boolean) => Promise<void>;
  agents: () => Promise<WorkflowAgentOption[]>;
  providers: () => Promise<z.output<typeof workflowFilesRpcContract.workflowProviders.output>>;
};

const isMissing = (error: unknown): boolean => typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT";

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Путь — файл одного из агентов-шаблонов, иначе null: так редактор агента не открывает остальной диск. */
const agentPath = async (deps: WorkflowFileDeps, path: string): Promise<string | null> =>
  (await deps.agents()).some((agent) => agent.path === path) ? path : null;

const workflowPath = (path: string): string => {
  if (workflowFileEngine(path) === null) throw new Error(`Not a workflow file: ${path}`);
  return path;
};

export const registerWorkflowFiles = (bb: Pick<BbPluginApi, "rpc">, deps: WorkflowFileDeps): void => {
  bb.rpc.register(workflowFilesRpcContract, {
    workflowList: async () => {
      // Папки ещё нет — workflow нет; любой другой сбой чтения — ошибка, а не пустой список.
      const names = (await deps.listDir(deps.dir).catch((error: unknown) => (isMissing(error) ? [] : Promise.reject(error)))).filter((name) => workflowFileEngine(join(deps.dir, name)) !== null).sort();
      const items = await Promise.all(
        names.map(async (name) => {
          const path = join(deps.dir, name);
          const source = await deps.readFile(path).catch(() => "");
          const result = recognize(source, "claude");
          return {
            name: name.slice(0, -".js".length),
            path,
            description: result.kind === "tree" ? result.tree.description : readMetaDescription(source),
            reason: result.kind === "tree" ? null : result.kind,
          };
        }),
      );
      return { dir: deps.dir, items };
    },
    workflowRead: async ({ path }) => ({ source: await deps.readFile(workflowPath(path)) }),
    workflowSave: async ({ path, source, create }) => {
      await deps.writeFile(workflowPath(path), source, create === true);
      return { path };
    },
    workflowAgents: () => deps.agents(),
    workflowProviders: () => deps.providers(),
    agentDocRead: async ({ path }) => {
      if ((await agentPath(deps, path)) === null) return { path, content: null, sha256: null, error: "Not an agent file." };
      return deps.readFile(path).then(
        (content) => ({ path, content, sha256: sha256(content), error: null }),
        (error: unknown) => ({ path, content: null, sha256: null, error: isMissing(error) ? "File not found." : String(error) }),
      );
    },
    agentDocWrite: async ({ path, content, expectedSha256 }) => {
      if ((await agentPath(deps, path)) === null) return { outcome: "denied" as const, message: "Not an agent file." };
      const current = await deps.readFile(path).catch((error: unknown) => (isMissing(error) ? null : Promise.reject(error)));
      if (current === null) return { outcome: "not-found" as const, message: "File not found." };
      if (expectedSha256 !== null && sha256(current) !== expectedSha256) return { outcome: "conflict" as const, sha256: sha256(current), message: "The file changed on disk." };
      await deps.writeFile(path, content);
      return { outcome: "written" as const, sha256: sha256(content) };
    },
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
