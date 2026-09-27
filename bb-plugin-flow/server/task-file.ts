// Файл задачи из дерева треда: Flow читает из него название задачи для итога прогона и пишет в шапку flow треда.
// Flow — плагин той же машины, что и дерево треда, поэтому ходит в файл напрямую, а корень дерева берёт у окружения треда.
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

/** Та часть SDK, что нужна пути: окружение треда и корень его дерева. */
type Sdk = {
  threads: { get: (args: { threadId: string }) => Promise<{ environmentId: string | null }> };
  environments: { get: (args: { environmentId: string }) => Promise<{ path: string | null }> };
};

/** Путь файла результата этапа: относительный — от корня дерева треда, абсолютный — как есть. */
const pathOf = async (sdk: Sdk, threadId: string, target: string): Promise<string> => {
  if (isAbsolute(target)) return target;
  const { environmentId } = await sdk.threads.get({ threadId });
  const root = environmentId === null ? null : (await sdk.environments.get({ environmentId })).path;
  if (!root) throw new Error(`Thread ${threadId} has no worktree to reach ${target} in`);
  return join(root, target);
};

export const readTaskFile = async (sdk: Sdk, threadId: string, target: string): Promise<string> => readFile(await pathOf(sdk, threadId, target), "utf8");

export const writeTaskFile = async (sdk: Sdk, threadId: string, target: string, text: string): Promise<void> =>
  writeFile(await pathOf(sdk, threadId, target), text, "utf8");
