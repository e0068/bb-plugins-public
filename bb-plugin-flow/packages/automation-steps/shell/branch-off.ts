// Отвод своей ветки перед коммитом: тред, стоящий на ветке по умолчанию (чекаут
// проекта на main), коммитил бы прямо в main. Ветка отводится на месте —
// незакоммиченное едет вместе с ней. Порт шагов `branchOff` (steps.ts).
import { branchOffName } from "../core/tree-place";
import { gitClient } from "../wiring/git-client";
import { gitRunMessage } from "../wiring/git-run";
import type { Sdk } from "./pr-helpers";

/** Отведённая ветка; `null` — тред и так на своей ветке или у него нет окружения. Отказ git — исключение с его текстом. */
export const branchOffDefaultBranch =
  (sdk: Sdk) =>
  async (threadId: string): Promise<string | null> => {
    const { environmentId } = await sdk.threads.get({ threadId });
    if (environmentId === null) return null;
    const env = await sdk.environments.get({ environmentId });
    const branch = env.path === null ? null : branchOffName(env, threadId);
    if (branch === null || env.path === null) return null;
    const run = await gitClient(env.path).run(["switch", "-c", branch]);
    if (run.code !== 0) throw new Error(gitRunMessage(run));
    return branch;
  };
