// Шаги набора Pull Request по id — для плагина, который исполняет их сам, без
// Automations (Flow). Каждый шаг отвечает итогом и не бросает: исключение
// помощника становится `{ ok: false, error }`, а недоделанное обещание —
// задача не перевелась, main не подтянулся — тоже провал, потому что цепочка
// шагов на нём должна остановиться.
import type { PluginKvStorage } from "@get-bb/plugin-sdk";

import type { StepId } from "./catalog";
import type { BumpLevel } from "./core/plugin-version-bump";
import { classifyFailure, RETRY_DELAYS_MS } from "./core/retry";
import { bumpOutcome, reinstallOutcome, type StepOutcome } from "./core/step-outcomes";
import { bbCliClient } from "./wiring/bb-cli-client";
import type { CliPorts } from "./wiring/bb-cli-run";
import type { CatchUpOutcome } from "./wiring/catch-up";
import { markLinkedTasksStatus, splitTaskStatusResults } from "./wiring/mark-task-status";
import type { PluginsPort } from "./wiring/plugin-reinstall";
import {
  attemptArchive,
  attemptLocalMainPull,
  catchUpBranch,
  environmentIdOf,
  gatherAndCreate,
  markAwaiting,
  githubBranchesOf,
  githubPullOf,
  MERGE_METHOD,
  mergeWithVerdict,
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
  /** Пауза между повторами шага; по умолчанию — настоящий таймер. В тестах подменяется, чтобы повтор не стоил секунд. */
  sleep?: (ms: number) => Promise<void>;
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

/** Строка успеха, добравшегося не с первой попытки: повтор виден в строке шага, без похода в логи. */
const withAttempt = (detail: string | null, attempt: number): string =>
  detail === null ? `succeeded on attempt ${attempt}` : `${detail}; succeeded on attempt ${attempt}`;

/**
 * Повтор шага на временной ошибке: GitHub, который ещё считает или ещё не
 * видит, перегруженная сеть, оборванное соединение. Постоянная ошибка
 * (конфликт, нет токена, закрытый PR) идёт к владельцу сразу — повтор её не
 * лечит, а только оттягивает показ. Что считать временным и сколько ждать —
 * core/retry.ts; безопасность самого повтора держат шаги: каждый отвечает
 * успехом на уже сделанную работу, а не вторым эффектом.
 */
export const retrying =
  (sleep: (ms: number) => Promise<void>, run: (threadId: string) => Promise<StepOutcome>) =>
  async (threadId: string): Promise<StepOutcome> => {
    for (let attempt = 1; ; attempt += 1) {
      const outcome = await run(threadId);
      if (outcome.ok) return attempt === 1 ? outcome : { ok: true, detail: withAttempt(outcome.detail, attempt) };
      const delay = RETRY_DELAYS_MS[attempt - 1];
      if (delay === undefined || classifyFailure(outcome.error) === "permanent") {
        return attempt === 1 ? outcome : { ok: false, error: `${outcome.error} (${attempt} attempts)` };
      }
      await sleep(delay);
    }
  };

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Строка шага, подтянувшего базу. Два исхода из четырёх говорят о ветке, чей
 * PR уже влит, и владелец должен прочесть их с первого раза: слова «доведена»
 * и «перенесена» объясняют, почему у ветки вдруг стало меньше коммитов.
 */
const CATCH_UP_DETAIL: Record<CatchUpOutcome, string> = {
  "up-to-date": "up-to-date",
  "fast-forwarded": "fast-forwarded",
  merged: "merged",
  "reset-to-base": "brought onto the base — the branch's content is already there",
  "replay-onto-base": "the branch's own work moved onto the base — the rest was already merged",
};

/**
 * Окружение без git — чаще всего проект смотрит на папку выше репозитория. Владелец
 * должен увидеть, какая это папка и что поправить, а не код статуса bb.
 */
const notARepository = (path: string): string =>
  `The thread's environment is not a git repository: ${path}. Point the project at the folder that holds the repository, then retry.`;

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
    // Пустой список законен — тред без задачи доезжает до архива, — но
    // молчаливая галочка под ним прятала поломку разрешения дерева.
    return done(successKeys.length === 0 ? "no linked tasks" : successKeys.join(", "));
  };

  const bumpStep = (level: BumpLevel) =>
    guarded(async (threadId: string) => {
      const environmentId = await environmentOf(threadId);
      return bumpOutcome(await settleVersionsForMerge(await githubPullOf(sdk, settings, environmentId), level));
    });

  const steps: Steps = {
    // Чистое дерево — не провал: коммитить нечего, цепочка идёт дальше.
    "git.commit": guarded(async (threadId) => {
      const environmentId = await environmentOf(threadId);
      const status = await sdk.environments.status({ environmentId });
      // Окружение без папки называется своим id: другого адреса у него нет.
      if (status.outcome === "not_applicable") return failed(notARepository((await sdk.environments.get({ environmentId })).path ?? environmentId));
      if (status.outcome === "unavailable") {
        const { code, workspacePath, message } = status.failure;
        return failed(code === "not_git_repo" ? notARepository(workspacePath) : `Git status of the thread's environment is unavailable (${workspacePath}): ${message}`);
      }
      if (!status.workspace.workingTree.hasUncommittedChanges) return done("nothing to commit");
      return done((await sdk.environments.commit({ environmentId })).commitSubject);
    }),
    "git.fast-forward": guarded(async (threadId) => {
      return done(CATCH_UP_DETAIL[await catchUpBranch(sdk, kv, threadId)]);
    }),
    // Открытый PR ветки — итог этого шага, а не отказ: повтор после потерянного
    // ответа GitHub не открывает второй PR и говорит, что нашёл первый.
    "git.create-pr": guarded(async (threadId) => {
      const created = await gatherAndCreate(sdk, kv, await resolveToken(settings), threadId);
      return done(created.existed ? `already open: ${created.url}` : created.url);
    }),
    "bb.tasks-in-review": guarded(moveTasks("in_review")),
    // Версия ставится коммитом в ветку открытого PR и считается от базовой
    // ветки: соседний PR, севший на main минуту назад, уже учтён.
    "files.bump-major": bumpStep("major"),
    "files.bump-minor": bumpStep("minor"),
    "files.bump-patch": bumpStep("patch"),
    // Состояние PR спрашивается у GitHub до мёрджа и после упавшего: уже
    // влитый PR — успех шага, закрытый — названный отказ, конфликт — названный
    // конфликт, а не «HTTP 409» (shell/pr-helpers.ts).
    "git.merge": guarded(async (threadId) => {
      const environmentId = await environmentOf(threadId);
      const gh = await githubPullOf(sdk, settings, environmentId);
      await markAwaiting(sdk, environmentId, "merge");
      return mergeWithVerdict(gh, async () => void (await sdk.environments.mergePullRequest({ environmentId, method: MERGE_METHOD })));
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

  // Повтор надет на каждый шаг, а не на избранные: временная ошибка приходит
  // не от шага, а от сети и GitHub, и любой шаг ловит её одинаково.
  const sleep = ports.sleep ?? realSleep;
  return Object.fromEntries(Object.entries(steps).map(([id, run]) => [id, retrying(sleep, run)])) as Steps;
}
