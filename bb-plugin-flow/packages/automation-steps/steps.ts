// Шаги набора Pull Request по id — для плагина, который исполняет их сам, без
// Automations (Flow). Каждый шаг отвечает итогом и не бросает: исключение
// помощника становится `{ ok: false, error }`, а недоделанное обещание —
// задача не перевелась, main не подтянулся — тоже провал, потому что цепочка
// шагов на нём должна остановиться.
import type { PluginKvStorage } from "@get-bb/plugin-sdk";

import type { StepId } from "./catalog";
import { type ParentDelivery, parentNote } from "./core/parent-delivery";
import type { BumpLevel } from "./core/plugin-version-bump";
import { classifyFailure, RETRY_DELAYS_MS } from "./core/retry";
import { threadTitleOf } from "./core/thread-title";
import { treePlaceOf, type TreePlace } from "./core/tree-place";
import { mergedPullLinks, openedPullOutcome, taskLink, withLinks } from "./core/step-links";
import { bumpOutcome, reinstallOutcome, stepFailure, withCommitted, type StepOutcome } from "./core/step-outcomes";
import { issueKeysArgs, issueKeysEnv, parseIssuedKeys } from "./core/bb-tasks-commands";
import { bbCliClient } from "./wiring/bb-cli-client";
import { cliRunMessage, type CliPorts } from "./wiring/bb-cli-run";
import type { CatchUpOutcome, ParentDeliveryOutcome } from "./wiring/catch-up";
import type { RefreshOutcome } from "./wiring/create-pr";
import { gitClient } from "./wiring/git-client";
import type { GitPorts } from "./wiring/git-run";
import { findLinkedTask } from "./wiring/linked-task";
import { markLinkedTasksStatus, splitTaskStatusResults, type TaskStatusReport } from "./wiring/mark-task-status";
import { writeTaskFact, writeTaskPlan } from "./wiring/task-figures";
import type { PlannedFigures, RunSpend } from "./core/task-figures";
import type { PluginsPort } from "./wiring/plugin-reinstall";
import {
  attemptArchive,
  attemptLocalMainPullRefreshing,
  availableStatus,
  catchUpBranch,
  codeInMainGate,
  deliverIntoParent,
  parentHeadOf,
  environmentIdOf,
  gatherAndCreate,
  markAwaiting,
  githubBranchesOf,
  githubPullOf,
  mergeThroughHostOrGithub,
  mergeWithVerdict,
  parentDeliveryOf,
  pluginImportsOf,
  refreshOpenPr,
  reinstallAfterMerge,
  resolveToken,
  settleVersionsForMerge,
  type ChildDelivery,
  type GithubTokenSettings,
  type PrBranchOutcome,
  type Sdk,
} from "./shell/pr-helpers";

export type { StepOutcome };

/**
 * План и факт прогона треда, как их знает плагин, ведущий прогон: бюджет прогона и итог его закрытых этапов под id
 * прогона; `null` — такого числа у прогона нет. Итог считается по запросу: шагу плана он не нужен.
 */
export interface RunFigures {
  readonly planned: PlannedFigures | null;
  spent(): Promise<RunSpend | null>;
}

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
  /**
   * Реплика в другой тред — встаёт в очередь и не перебивает идущий ход. Ею
   * «Смёрджить PR» дочернего треда говорит родителю, что ветка влита к нему.
   * Без порта родитель не узнаёт — как было до него.
   */
  tell?: (threadId: string, text: string) => Promise<void>;
  /**
   * Догнать ветку открытого PR до ветки треда — первое, что делает «Смёрджить
   * PR». По умолчанию — настоящий GitHub; в тестах подменяется, чтобы мёрдж
   * проверялся без сети.
   */
  refreshPr?: (threadId: string) => Promise<RefreshOutcome | "no-open-pr">;
  /**
   * План и факт прогона треда — их знает только плагин, ведущий прогон.
   * Без порта шаги «План → задача» и «Факт → задача» ничего не пишут и
   * проходят зелёными: писать нечего, а не что-то сломалось.
   */
  runFigures?: (threadId: string) => Promise<RunFigures | null>;
  /**
   * Отвод своей ветки перед коммитом, когда тред стоит на ветке по умолчанию
   * (shell/branch-off.ts): отведённая ветка или `null`. Без порта шаги
   * коммитят в текущую ветку, как раньше.
   */
  branchOff?: (threadId: string) => Promise<string | null>;
  /** git в дереве по пути; по умолчанию — настоящий процесс. Шаг «Задача → done» спрашивает им, в main ли код треда. */
  git?: (path: string) => GitPorts;
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

/** Ключ kv с разрядом последнего бампа PR окружения: по нему «Смёрджить PR» поднимает версию заново после догоняния PR. */
export const lastBumpKey = (environmentId: string): string => `last-bump-level:${environmentId}`;

/** Деталь мёрджа, перед которым PR догнан до ветки треда: владелец видит, что коммиты после «Открыть PR» доехали. */
export const MERGE_REFRESHED = "PR branch brought up to the thread's branch";

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
      if (outcome.ok) return attempt === 1 ? outcome : { ...outcome, detail: withAttempt(outcome.detail, attempt) };
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

/** Строка шага «Открыть PR»: адрес PR и что стало с его веткой на GitHub. */
const PR_DETAIL: Record<PrBranchOutcome, (url: string) => string> = {
  opened: (url) => url,
  updated: (url) => `already open: ${url}; branch updated`,
  unchanged: (url) => `already open: ${url}`,
};

/**
 * Строка шага, сдавшего ветку дочернего треда в ветку родителя: владелец
 * должен прочесть, что PR на GitHub не открыт не по ошибке, а потому что
 * работу увезёт PR родителя.
 */
const DELIVERY_DETAIL: Record<ParentDeliveryOutcome, (parentBranch: string) => string> = {
  "already-in": (parentBranch) => `already in ${parentBranch}`,
  delivered: (parentBranch) => `merged into ${parentBranch} — the parent thread's branch, no PR on GitHub`,
};

/**
 * Строка шага «Дерево и ветка от origin/main». Сам тред переносит Flow до
 * первого хода, а шаг только говорит, где тред работает, и не падает: тред,
 * у которого дерево и ветка уже свои, проходит его зелёным.
 */
const TREE_DETAIL: Record<TreePlace, string> = {
  "not-started": "not started yet — Flow moves the thread before its first turn",
  "own-tree": "already in its own worktree",
  "project-checkout": "the thread already works in the project checkout — Flow moves a thread only before its first turn",
  "no-git": "the thread's folder has no git",
};

/** Исключение шага — его итог, а не падение исполнителя. */
const guarded =
  (run: (threadId: string) => Promise<StepOutcome>) =>
  async (threadId: string): Promise<StepOutcome> => {
    try {
      return await run(threadId);
    } catch (error) {
      return stepFailure(error);
    }
  };

export function createSteps(ports: StepPorts): Steps {
  const { sdk, kv, settings } = ports;
  const cli = () => ports.cli ?? bbCliClient();
  const refreshPr = ports.refreshPr ?? (async (threadId: string) => refreshOpenPr(sdk, kv, await resolveToken(settings), threadId));

  const environmentOf = async (threadId: string): Promise<string> => {
    const environmentId = await environmentIdOf(sdk, threadId);
    if (!environmentId) throw new Error("The thread has no environment with git.");
    return environmentId;
  };

  /**
   * Итог правки задач треда: CLI не запустился или хоть одна задача не приняла
   * правку — красный с причинами; задач нет — зелёный. Пустой список законен —
   * тред без задачи доезжает до архива, — но молчаливая галочка под ним
   * прятала поломку разрешения дерева.
   */
  const tasksOutcome = (report: TaskStatusReport, unavailable: string, refused: string): StepOutcome => {
    if (report.unavailable !== null) return failed(`${unavailable}: ${report.unavailable}`);
    const { successKeys, failedTasks } = splitTaskStatusResults(report.results);
    if (failedTasks.length > 0) return failed(`${refused}: ${failedTasks.map(({ key, reason }) => `${key} (${reason})`).join(", ")}`);
    return done(successKeys.length === 0 ? "no linked tasks" : successKeys.join(", "));
  };

  const moveTasks = (status: "in_review" | "done") => async (threadId: string) => {
    // В done задача уходит только с кодом треда в origin/main; в in_review — как есть.
    const gate = codeInMainGate(sdk, ports.git ?? gitClient, threadId);
    const report = await markLinkedTasksStatus(cli(), threadId, status, gate);
    const outcome = tasksOutcome(report, "Linked tasks were not moved", `Tasks not moved to ${status}`);
    if (!outcome.ok) return outcome;
    // Ссылку на файл даёт только закрытая задача: её этап — последний, и задача
    // в его итогах — то, что владелец откроет. Без слага файла не найти — ссылки нет.
    const moved = report.results.flatMap((r) => (r.ok && r.slug !== undefined ? [taskLink({ key: r.key, slug: r.slug })] : []));
    return status === "done" ? withLinks(outcome, moved) : outcome;
  };

  const writePlan = async (threadId: string) => {
    const planned = (await ports.runFigures?.(threadId))?.planned ?? null;
    return planned === null ? done("no plan in the run") : tasksOutcome(await writeTaskPlan(cli(), threadId, planned), "Plan not written", "Plan not written");
  };

  const writeFact = async (threadId: string) => {
    const spent = (await (await ports.runFigures?.(threadId))?.spent()) ?? null;
    return spent === null ? done("no spend in the run") : tasksOutcome(await writeTaskFact(cli(), kv, threadId, spent), "Spend not written", "Spend not written");
  };

  // Тред получает название своей задачи. Задачи нет или её не прочесть —
  // шаг пропускается: имя треда остаётся, цепочка идёт дальше, а причина
  // стоит в пометке шага.
  const renameThread = async (threadId: string): Promise<StepOutcome> => {
    const lookup = await findLinkedTask(cli(), threadId);
    switch (lookup.kind) {
      case "unavailable":
        return done(`skipped: the thread's task could not be read: ${lookup.reason}`);
      case "none":
        return done("skipped: no task is linked to the thread");
      case "found": {
        const title = threadTitleOf(lookup.task);
        if (title === null) return failed(`Task ${lookup.task.key} has no title to name the thread with.`);
        await sdk.threads.update({ threadId, title });
        return done(title);
      }
    }
  };

  // Дочерний тред, чья база — ветка родителя, сдаёт работу в дерево родителя
  // (core/parent-delivery.ts): PR и его мёрдж становятся слиянием туда, а
  // бамп, подтягивание main и обновление плагинов — делом PR родителя.
  const orIntoParent =
    (child: (delivery: ChildDelivery) => Promise<StepOutcome>, usual: (threadId: string) => Promise<StepOutcome>) =>
    async (threadId: string): Promise<StepOutcome> => {
      const delivery = await parentDeliveryOf(sdk, threadId);
      return delivery === null ? usual(threadId) : child(delivery);
    };
  const delivered = async (delivery: ParentDelivery) => DELIVERY_DETAIL[await deliverIntoParent(delivery)](delivery.parentBranch);
  const deliver = async (delivery: ParentDelivery) => done(await delivered(delivery));
  // Мёрдж волны — её последнее слово: родитель узнаёт о ней и тогда, когда
  // ветку уже влил «Открыть PR». Несказанное родителю шаг не роняет — ветка
  // влита, — а называет в деталях.
  const deliverAndTell = async (delivery: ChildDelivery) => {
    const detail = await delivered(delivery);
    const tell = ports.tell;
    if (tell === undefined) return done(detail);
    const untold = await parentHeadOf(delivery)
      .then((head) => tell(delivery.parentThreadId, parentNote({ title: delivery.title, branch: delivery.branch, parentBranch: delivery.parentBranch, head })))
      .then(
        () => null,
        (error: unknown) => messageOf(error),
      );
    return done(untold === null ? detail : `${detail}; the parent thread was not told: ${untold}`);
  };
  const notNeeded = async ({ parentBranch }: ParentDelivery) => done(`not needed — the branch goes into ${parentBranch}, the parent thread's branch`);

  const bumpStep = (level: BumpLevel) =>
    guarded(
      orIntoParent(notNeeded, async (threadId: string) => {
        const environmentId = await environmentOf(threadId);
        const outcome = bumpOutcome(await settleVersionsForMerge(await githubPullOf(sdk, settings, environmentId), level));
        // Разряд запоминается: «Смёрджить PR», догнав PR до ветки треда, выбрасывает коммит бампа и кладёт его заново.
        if (outcome.ok) await kv.set(lastBumpKey(environmentId), level);
        return outcome;
      }),
    );

  // Тема сделанного коммита; чистое дерево — `null`. Git-статус, который bb не отдал, — исключение.
  const commitIfDirty = async (threadId: string): Promise<string | null> => (await commitOffDefault(threadId)).subject;
  // Тред на ветке по умолчанию с правками сперва уходит на свою ветку: коммит не ложится в main. Чистое дерево
  // ветку не отводит — чекаут остаётся на main, и «Открыть PR» отказывает PR из самой базы понятной причиной.
  const commitOffDefault = async (threadId: string): Promise<{ branch: string | null; subject: string | null }> => {
    const environmentId = await environmentOf(threadId);
    const status = await availableStatus(sdk, environmentId);
    if (!status.workspace.workingTree.hasUncommittedChanges) return { branch: null, subject: null };
    const branch = (await ports.branchOff?.(threadId)) ?? null;
    return { branch, subject: (await sdk.environments.commit({ environmentId })).commitSubject };
  };

  // Чистое дерево — не провал: коммитить нечего, цепочка идёт дальше.
  const commitTree = async (threadId: string): Promise<StepOutcome> => {
    const { branch, subject } = await commitOffDefault(threadId);
    const committed = subject ?? "nothing to commit";
    return done(branch === null ? committed : `moved off the default branch to ${branch}; ${committed}`);
  };

  // Шаг, двигающий ветку, сперва коммитит дерево треда. Грязное дерево здесь —
  // не ошибка агента, а обычный ход цепочки: «Задача → done» перед FF, журнал
  // брифов Flow, комментарий в задачу после шага Commit. Отказ на нём ронял
  // автоматизацию до ручного коммита, а порядок шагов во flow решал, упадёт ли
  // она вовсе. Теперь порядок не важен: незакоммиченное уходит отдельным
  // коммитом той же темы, что дал бы шаг Commit.
  const afterCommit =
    (run: (threadId: string) => Promise<StepOutcome>) =>
    async (threadId: string): Promise<StepOutcome> => {
      const subject = await commitIfDirty(threadId);
      return withCommitted(await run(threadId), subject);
    };

  // Задача, рождённая в ветке, живёт без ключа, а правка из дерева треда его
  // не выдаёт. Команда Tasks+ выдаёт ключи в дереве треда, номерами после
  // наибольшего в main, который ветка только что догнала, и выданное
  // уезжает коммитом в PR. Коммитится только выданное: пустой ответ дерево
  // не трогает, а нечитаемый — провал, а не «выдавать нечего».
  const issueKeys = async (threadId: string): Promise<StepOutcome> => {
    const { projectId } = await sdk.threads.get({ threadId });
    const ran = await cli().run(issueKeysArgs(), issueKeysEnv(threadId, projectId));
    if (ran.kind === "unavailable" || ran.code !== 0) return failed(`Task keys were not issued: ${cliRunMessage(ran)}`);
    const answer = parseIssuedKeys(ran.stdout);
    if (answer.kind === "unreadable") return failed(`Task keys were not issued: unreadable answer: ${answer.text}`);
    if (answer.keys.length === 0) return done("no unnamed tasks");
    // Отказ коммита — исключение с причиной bb: его итогом делает `guarded`.
    await commitTree(threadId);
    return done(answer.keys.join(", "));
  };

  const treePlace = async (threadId: string): Promise<StepOutcome> => {
    const { environmentId } = await sdk.threads.get({ threadId });
    return done(TREE_DETAIL[treePlaceOf(environmentId === null ? null : await sdk.environments.get({ environmentId }))]);
  };

  const steps: Steps = {
    "git.tree-from-origin": guarded(treePlace),
    "bb.rename-thread": guarded(renameThread),
    "bb.tasks-plan": guarded(writePlan),
    "git.commit": guarded(commitTree),
    "git.fast-forward": guarded(
      afterCommit(async (threadId) => {
        return done(CATCH_UP_DETAIL[await catchUpBranch(sdk, kv, threadId)]);
      }),
    ),
    // Ветку дочернего треда ключами наделит шаг родителя, догнавший main:
    // своё дерево и main не видят соседних волн, и номера бы совпали.
    "bb.tasks-issue-keys": guarded(orIntoParent(notNeeded, issueKeys)),
    // Открытый PR ветки — итог этого шага, а не отказ: повтор после потерянного
    // ответа GitHub не открывает второй PR и говорит, что нашёл первый. Ветку
    // найденного PR шаг догоняет до ветки треда и говорит, сдвинул ли её.
    "git.create-pr": guarded(
      afterCommit(
        orIntoParent(deliver, async (threadId) => {
          const created = await gatherAndCreate(sdk, kv, await resolveToken(settings), threadId);
          return openedPullOutcome(created, PR_DETAIL[created.branch](created.url));
        }),
      ),
    ),
    "bb.tasks-in-review": guarded(moveTasks("in_review")),
    // Версия ставится коммитом в ветку открытого PR и считается от базовой
    // ветки: соседний PR, севший на main минуту назад, уже учтён.
    "files.bump-major": bumpStep("major"),
    "files.bump-minor": bumpStep("minor"),
    "files.bump-patch": bumpStep("patch"),
    // Состояние PR спрашивается у GitHub до мёрджа и после упавшего: уже
    // влитый PR — успех шага, закрытый — названный отказ, конфликт — названный
    // конфликт, а не «HTTP 409» (shell/pr-helpers.ts). Перед мёрджем ветка
    // PR догоняется до ветки треда: PR собран через API без пуша, и коммиты
    // после «Открыть PR» иначе в main не попадают; незакоммиченное шаг
    // сперва коммитит сам, чтобы оно тоже уехало в PR.
    // Догнанный PR теряет коммит бампа (wiring/create-pr.ts), поэтому версия
    // поднимается заново тем разрядом, что запомнил шаг бампа; не поднялась —
    // мёрджа нет: влить плагин на старой версии шаг бампа и не даёт.
    "git.merge": guarded(
      afterCommit(
        orIntoParent(deliverAndTell, async (threadId) => {
          const refreshed = await refreshPr(threadId);
          const environmentId = await environmentOf(threadId);
          const gh = await githubPullOf(sdk, settings, environmentId);
          const level = refreshed === "updated" ? await kv.get<BumpLevel>(lastBumpKey(environmentId)) : undefined;
          const rebump = level === undefined ? null : bumpOutcome(await settleVersionsForMerge(gh, level));
          if (rebump !== null && !rebump.ok) return rebump;
          await markAwaiting(sdk, environmentId, "merge");
          const outcome = await mergeWithVerdict(gh, mergeThroughHostOrGithub(sdk, gh, environmentId));
          if (outcome.ok) await kv.delete(lastBumpKey(environmentId));
          const before = refreshed === "updated" ? [MERGE_REFRESHED, ...(rebump?.ok === true && rebump.detail !== null ? [`versions raised again: ${rebump.detail}`] : [])] : [];
          const told = outcome.ok ? { ...outcome, detail: [...before, ...(outcome.detail === null ? [] : [outcome.detail])].join("; ") || null } : outcome;
          // Ссылка мёрджа — на сам PR: номер знает только GitHub, без него ссылки нет.
          return withLinks(told, mergedPullLinks(gh.ok ? gh : null));
        }),
      ),
    ),
    "git.pull-main": guarded(
      orIntoParent(notNeeded, async (threadId) => {
        const attempt = await attemptLocalMainPullRefreshing(sdk, kv, await environmentOf(threadId), { port: ports.plugins, ownPluginId: ports.ownPluginId });
        if (attempt === null) return failed("The environment has no working copy or base branch to pull main into.");
        if (!attempt.pull.ok) return failed(attempt.pull.reason);
        // Плагины из папок основной копии собираются заново здесь же, собственный — после цепочки, как у шага обновления.
        const { refreshed, problems, pendingSelf } = attempt.refresh ?? { refreshed: [], problems: [], pendingSelf: null };
        if (pendingSelf !== null) await kv.set(selfUpdatePendingKey(threadId), pendingSelf);
        const told = [
          ...(refreshed.length === 0 ? [] : [`rebuilt from the integration copy: ${refreshed.join(", ")}`]),
          ...(pendingSelf === null ? [] : [`${pendingSelf} rebuilds itself after the run`]),
          ...problems.map((problem) => `plugin not rebuilt: ${problem}`),
        ];
        return done(told.length === 0 ? null : told.join("; "));
      }),
    ),
    // Плагины переводятся на смёрдженный код по файлам самого PR. Собственный
    // плагин сюда не входит: его id уходит в kv и обновляется после цепочки.
    "bb.reinstall": guarded(
      orIntoParent(notNeeded, async (threadId) => {
        const environmentId = await environmentOf(threadId);
        const report = await reinstallAfterMerge(await githubBranchesOf(sdk, settings, environmentId), ports.plugins, ports.ownPluginId, () =>
          pluginImportsOf(sdk, environmentId),
        );
        const outcome = reinstallOutcome(report);
        // Ключ ставится только на успехе: шаг, ответивший «не обновлено»,
        // останавливает цепочку, и обновлять себя после него — значит сделать
        // ровно то, о чём владельцу только что сказали, что оно не сделано.
        if (outcome.ok && report.pendingSelfUpdate !== null) {
          await kv.set(selfUpdatePendingKey(threadId), report.pendingSelfUpdate);
        }
        return outcome;
      }),
    ),
    // Факт пишется до коммита Finalize: запись после него до main не доедет.
    "bb.tasks-fact": guarded(writeFact),
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
