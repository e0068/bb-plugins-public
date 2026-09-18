// Шаги набора Pull Request по id — для плагина, который исполняет их сам, без
// Automations (Flow). Каждый шаг отвечает итогом и не бросает: исключение
// помощника становится `{ ok: false, error }`, а недоделанное обещание —
// задача не перевелась, main не подтянулся — тоже провал, потому что цепочка
// шагов на нём должна остановиться.
import type { PluginKvStorage } from "@get-bb/plugin-sdk";

import type { StepId } from "./catalog";
import type { BumpLevel } from "./core/plugin-version-bump";
import { bumpOutcome, reinstallOutcome, type StepOutcome } from "./core/step-outcomes";
import { bbCliClient } from "./wiring/bb-cli-client";
import type { CliPorts } from "./wiring/bb-cli-run";
import { markLinkedTasksStatus, splitTaskStatusResults } from "./wiring/mark-task-status";
import { waitForMergeability } from "./wiring/mergeability-wait";
import type { PluginsPort } from "./wiring/plugin-reinstall";
import {
  attemptArchive,
  attemptLocalMainPull,
  attemptMerge,
  catchUpBranch,
  environmentIdOf,
  gatherAndCreate,
  githubBranchesOf,
  githubPullOf,
  MERGE_METHOD,
  reinstallAfterMerge,
  resolveToken,
  settleVersionsForMerge,
  type GithubTokenSettings,
  type Sdk,
} from "./shell/pr-helpers";

export type { StepOutcome };

export interface StepPorts {
  sdk: Sdk;
  /** kv плагина-исполнителя: базовый режим окружения и кэш «уже влито» читаются из него. */
  kv: PluginKvStorage;
  settings: GithubTokenSettings;
  /** `bb` CLI; по умолчанию — настоящий процесс. */
  cli?: CliPorts;
  /** Плагины хоста (`bb.sdk.plugins`) — их обновляет шаг `bb.reinstall`. */
  plugins: PluginsPort;
  /** Id плагина, ведущего прогон: обновлять сам себя внутри цепочки он не может. */
  ownPluginId: string;
}

/**
 * Ключи kv, куда шаг обновления кладёт id собственного плагина: обновление
 * себя гасит API-хэндл плагина, поэтому его применяют после цепочки, а не
 * внутри шага (bb-plugin-flow/server/automation-runner.ts). Ключ на тред, а
 * не один на всех: цепочки идут параллельно, и отложенное одним тредом не
 * должно теряться, пока занят сосед, — по префиксу исполнитель снимает все
 * отложенные разом, когда работы не осталось.
 */
export const SELF_UPDATE_PENDING_PREFIX = "self-update-pending:";

export const selfUpdatePendingKey = (threadId: string): string => `${SELF_UPDATE_PENDING_PREFIX}${threadId}`;

export type Steps = Readonly<Record<StepId, (threadId: string) => Promise<StepOutcome>>>;

const done = (detail: string | null = null): StepOutcome => ({ ok: true, detail });
const failed = (error: string): StepOutcome => ({ ok: false, error });
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Исключение шага — его итог, а не падение исполнителя. */
const guarded =
  (run: (threadId: string) => Promise<StepOutcome>) =>
  async (threadId: string): Promise<StepOutcome> => {
    try {
      return await run(threadId);
    } catch (error) {
      return failed(messageOf(error));
    }
  };

export function createSteps(ports: StepPorts): Steps {
  const { sdk, kv, settings } = ports;
  const cli = () => ports.cli ?? bbCliClient();

  const environmentOf = async (threadId: string): Promise<string> => {
    const environmentId = await environmentIdOf(sdk, threadId);
    if (!environmentId) throw new Error("The thread has no environment with git.");
    return environmentId;
  };

  const moveTasks = (status: "in_review" | "done") => async (threadId: string) => {
    const report = await markLinkedTasksStatus(cli(), threadId, status);
    if (report.unavailable !== null) return failed(`Linked tasks were not moved: ${report.unavailable}`);
    const { successKeys, failedTasks } = splitTaskStatusResults(report.results);
    if (failedTasks.length > 0) return failed(`Tasks not moved to ${status}: ${failedTasks.map(({ key, reason }) => `${key} (${reason})`).join(", ")}`);
    return done(successKeys.length === 0 ? null : successKeys.join(", "));
  };

  const bumpStep = (level: BumpLevel) =>
    guarded(async (threadId: string) => {
      const environmentId = await environmentOf(threadId);
      return bumpOutcome(await settleVersionsForMerge(await githubPullOf(sdk, settings, environmentId), level));
    });

  return {
    // Чистое дерево — не провал: коммитить нечего, цепочка идёт дальше.
    "git.commit": guarded(async (threadId) => {
      const environmentId = await environmentOf(threadId);
      const status = await sdk.environments.status({ environmentId });
      if (status.outcome !== "available") return failed(`Environment git status unavailable (${status.outcome}).`);
      if (!status.workspace.workingTree.hasUncommittedChanges) return done("nothing to commit");
      return done((await sdk.environments.commit({ environmentId })).commitSubject);
    }),
    "git.fast-forward": guarded(async (threadId) => {
      return done(await catchUpBranch(sdk, kv, threadId));
    }),
    "git.create-pr": guarded(async (threadId) => {
      const created = await gatherAndCreate(sdk, kv, await resolveToken(settings), threadId);
      return done(created.url);
    }),
    "bb.tasks-in-review": guarded(moveTasks("in_review")),
    // Версия ставится коммитом в ветку открытого PR и считается от базовой
    // ветки: соседний PR, севший на main минуту назад, уже учтён.
    "files.bump-major": bumpStep("major"),
    "files.bump-minor": bumpStep("minor"),
    "files.bump-patch": bumpStep("patch"),
    "git.merge": guarded(async (threadId) => {
      const environmentId = await environmentOf(threadId);
      const gh = await githubPullOf(sdk, settings, environmentId);
      const failure = await attemptMerge(async () => {
        if (gh.ok) await waitForMergeability(gh.ports, gh.repo, gh.number);
        await sdk.environments.mergePullRequest({ environmentId, method: MERGE_METHOD });
      });
      return failure === null ? done() : failed(failure.message);
    }),
    "git.pull-main": guarded(async (threadId) => {
      const pull = await attemptLocalMainPull(sdk, kv, await environmentOf(threadId));
      if (pull === null) return failed("The environment has no working copy or base branch to pull main into.");
      return pull.ok ? done() : failed(pull.reason);
    }),
    // Плагины переводятся на смёрдженный код по файлам самого PR. Собственный
    // плагин сюда не входит: его id уходит в kv и обновляется после цепочки.
    "bb.reinstall": guarded(async (threadId) => {
      const environmentId = await environmentOf(threadId);
      const report = await reinstallAfterMerge(await githubBranchesOf(sdk, settings, environmentId), ports.plugins, ports.ownPluginId);
      const outcome = reinstallOutcome(report);
      // Ключ ставится только на успехе: шаг, ответивший «не обновлено»,
      // останавливает цепочку, и обновлять себя после него — значит сделать
      // ровно то, о чём владельцу только что сказали, что оно не сделано.
      if (outcome.ok && report.pendingSelfUpdate !== null) {
        await kv.set(selfUpdatePendingKey(threadId), report.pendingSelfUpdate);
      }
      return outcome;
    }),
    "bb.tasks-done": guarded(moveTasks("done")),
    "bb.archive": guarded(async (threadId) => {
      const failure = await attemptArchive(() => sdk.threads.archive({ threadId }));
      return failure === null ? done() : failed(failure.message);
    }),
  };
}
