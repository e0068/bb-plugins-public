// bb-plugin-zz-pull-request — вход плагина (Слой 3, только проводка).
//
// Даёт фронту два RPC: prState (показывать ли кнопку) и createPr (открыть PR на
// GitHub через API без push). Вся логика — в слоях ниже: чистое ядро (src/core)
// и оркестратор GitHub-потока (src/wiring/create-pr). Здесь — чтение мира через
// bb.sdk и склейка.
import { defineRpcContract, type BbPluginApi, type PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { resolveBase } from "./src/core/base-branch";
import { isDeletion } from "./src/core/changed-files";
import { decideFastForward } from "./src/core/fast-forward";
import {
  configPathFromGitdir,
  originUrlFromGitConfig,
  parseGitdirPointer,
} from "./src/core/git-config";
import type { ChangedFile, RepoRef } from "./src/core/github-requests";
import {
  decideMergeReadiness,
  type ChecksState,
  type MergeIndicator,
  type PrState,
} from "./src/core/merge-readiness";
import { parseGithubRemote } from "./src/core/remote";
import { threadChangeTouchesPr } from "./src/core/thread-change";
import { chooseToken } from "./src/core/token";
import { decideVisibility, type PrPresence } from "./src/core/visibility";
import { runCreatePr } from "./src/wiring/create-pr";
import { runFastForward } from "./src/wiring/fast-forward";
import { ghAuthToken } from "./src/wiring/gh-token";
import { gitClient } from "./src/wiring/git-client";
import { githubClient } from "./src/wiring/github-client";
import { runLocalMainPull, type LocalMainPullResult } from "./src/wiring/local-main-pull";

export const rpcContract = defineRpcContract({
  prState: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({
      visible: z.boolean(),
      reason: z.string(),
      prUrl: z.string().nullable(),
    }),
  },
  createPr: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({ url: z.string(), number: z.number() }),
  },
  fastForwardState: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({ visible: z.boolean(), reason: z.string() }),
  },
  fastForward: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  mergeState: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({
      visible: z.boolean(),
      indicator: z.enum(["success", "failure", "pending", "neutral", "unknown"]),
      prUrl: z.string().nullable(),
    }),
  },
  mergePr: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  mainPullState: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({
      attempted: z.boolean(),
      ok: z.boolean(),
      reason: z.string().nullable(),
    }),
  },
});

type Sdk = BbPluginApi["sdk"];
type FileRead = { content: string; contentEncoding: "base64" | "utf8" };

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    githubToken: {
      type: "string",
      // По умолчанию токен берётся из `gh auth token` на машине bb; настройка —
      // необязательный override (например, если gh не залогинен).
      label: "GitHub-токен (необязательно; по умолчанию из gh auth token)",
      secret: true,
    },
  });

  // Толкаем фронт перечитать prState на двух источниках правды:
  // - environment:changed — коммит/смена ветки/git-refs меняют git-статус;
  // - thread:changed(environment-changed) — bb опознал/сменил PR у треда;
  //   без этой подписки строчка оживала бы только по перезагрузке интерфейса.
  const republish = () => bb.realtime.publish("changed", {});

  // Мутирующие RPC (createPr/fastForward/mergePr) зовут не голый republish(), а
  // republishAfterMutation(): сразу после мутации `sdk.environments.pullRequest`/
  // `status` на СТОРОНЕ bb ещё не догнали GitHub (bb сам узнаёт об изменении не
  // мгновенно, см. memory/wiki/pr-plugin-live-refresh-event.md) — первый рефетч
  // часто читает то же устаревшее состояние, и без подстраховки кнопка ждала
  // следующего события или до POLL_INTERVAL_MS (20 с) в app.tsx, из-за чего
  // переключение PR → Merge растягивалось секунд на 30 (см.
  // memory/decisions/republish-catchup-burst-after-mutation.md). Вместо того
  // чтобы держать общий поллинг коротким для всех простаивающих тредов, шлём
  // короткую серию повторных republish() именно в те секунды, когда САМИ знаем,
  // что состояние вот-вот догонит.
  const REPUBLISH_CATCHUP_DELAYS_MS = [1000, 3000, 6000, 12000];
  const pendingCatchupTimers = new Set<ReturnType<typeof setTimeout>>();
  function republishAfterMutation(): void {
    republish();
    for (const delay of REPUBLISH_CATCHUP_DELAYS_MS) {
      const timer = setTimeout(() => {
        pendingCatchupTimers.delete(timer);
        republish();
      }, delay);
      timer.unref?.();
      pendingCatchupTimers.add(timer);
    }
  }
  bb.onDispose(() => {
    for (const timer of pendingCatchupTimers) clearTimeout(timer);
    pendingCatchupTimers.clear();
  });

  bb.rpc.register(rpcContract, {
    async prState({ threadId }) {
      return computePrState(bb.sdk, bb.storage.kv, threadId);
    },
    async createPr({ threadId }) {
      const token = await resolveToken(settings);
      const result = await gatherAndCreate(bb.sdk, bb.storage.kv, token, threadId);
      republishAfterMutation();
      return result;
    },
    async fastForwardState({ threadId }) {
      return computeFastForwardState(bb.sdk, threadId);
    },
    async fastForward({ threadId }) {
      const result = await fastForwardBranch(bb.sdk, threadId);
      republishAfterMutation();
      return result;
    },
    async mergeState({ threadId }) {
      return computeMergeState(bb.sdk, threadId);
    },
    async mergePr({ threadId }) {
      const result = await mergePullRequest(bb.sdk, bb.storage.kv, threadId);
      republishAfterMutation();
      return result;
    },
    async mainPullState({ threadId }) {
      return computeMainPullState(bb.sdk, bb.storage.kv, threadId);
    },
  });

  const unsubscribeEnv = bb.sdk.subscribe({
    event: "environment:changed",
    callback: republish,
  });
  const unsubscribeThread = bb.sdk.subscribe({
    event: "thread:changed",
    callback: (event) => {
      if (threadChangeTouchesPr(event.changes)) republish();
    },
  });
  bb.onDispose(unsubscribeEnv);
  bb.onDispose(unsubscribeThread);

  bb.log.info("pull-request загружен");
}

async function computePrState(
  sdk: Sdk,
  kv: PluginKvStorage,
  threadId: string,
): Promise<{ visible: boolean; reason: string; prUrl: string | null }> {
  const environmentId = await environmentIdOf(sdk, threadId);
  if (!environmentId) return { visible: false, reason: "no-environment", prUrl: null };

  const env = await sdk.environments.get({ environmentId });
  const base = resolveBase(env);
  if (!base) return { visible: false, reason: "no-base-branch", prUrl: null };

  // Без явной базы bb не считает mergeBase (а с ним aheadCount) — тогда кнопка
  // всегда пряталась бы как «нечего пиарить». Считаем против УДАЛЁННОЙ базы
  // (base.statusBase), иначе устаревший локальный main даёт фантомный ahead.
  const status = await sdk.environments.status({
    environmentId,
    mergeBaseBranch: base.statusBase,
  });
  if (status.outcome !== "available") {
    return { visible: false, reason: `status-${status.outcome}`, prUrl: null };
  }

  const pr = await lookupPullRequest(sdk, environmentId);
  const { workingTree, mergeBase } = status.workspace;
  const decision = decideVisibility({
    hasUncommittedChanges: workingTree.hasUncommittedChanges,
    aheadCount: mergeBase?.aheadCount ?? 0,
    pr: pr.presence,
    headAlreadyMerged: await wasHeadAlreadyMerged(
      kv,
      environmentId,
      checkoutHeadSha(status.workspace.checkout),
    ),
  });
  return { visible: decision.visible, reason: decision.reason, prUrl: pr.url };
}

async function computeFastForwardState(
  sdk: Sdk,
  threadId: string,
): Promise<{ visible: boolean; reason: string }> {
  const environmentId = await environmentIdOf(sdk, threadId);
  if (!environmentId) return { visible: false, reason: "no-environment" };

  const env = await sdk.environments.get({ environmentId });
  const base = resolveBase(env);
  if (!base) return { visible: false, reason: "no-base-branch" };

  const status = await sdk.environments.status({
    environmentId,
    mergeBaseBranch: base.statusBase,
  });
  if (status.outcome !== "available") {
    return { visible: false, reason: `status-${status.outcome}` };
  }

  const { workingTree, mergeBase } = status.workspace;
  const decision = decideFastForward({
    behindCount: mergeBase?.behindCount ?? 0,
    aheadCount: mergeBase?.aheadCount ?? 0,
    hasUncommittedChanges: workingTree.hasUncommittedChanges,
  });
  return { visible: decision.visible, reason: decision.reason };
}

async function gatherAndCreate(
  sdk: Sdk,
  kv: PluginKvStorage,
  token: string,
  threadId: string,
): Promise<{ url: string; number: number }> {
  const environmentId = await environmentIdOf(sdk, threadId);
  if (!environmentId) throw new Error("У треда нет окружения с git.");

  const env = await sdk.environments.get({ environmentId });
  const base = resolveBase(env);
  if (!base) throw new Error("У окружения не удалось определить базовую ветку.");

  const status = await sdk.environments.status({
    environmentId,
    mergeBaseBranch: base.statusBase,
  });
  if (status.outcome !== "available") {
    throw new Error(`git-статус окружения недоступен (${status.outcome}).`);
  }

  const pr = await lookupPullRequest(sdk, environmentId);
  const { workingTree, mergeBase } = status.workspace;
  const decision = decideVisibility({
    hasUncommittedChanges: workingTree.hasUncommittedChanges,
    aheadCount: mergeBase?.aheadCount ?? 0,
    pr: pr.presence,
    headAlreadyMerged: await wasHeadAlreadyMerged(
      kv,
      environmentId,
      checkoutHeadSha(status.workspace.checkout),
    ),
  });
  if (!decision.visible || !mergeBase) {
    throw new Error(`Сейчас PR открыть нельзя (${decision.reason}).`);
  }

  const path = env.path;
  if (!path) throw new Error("У окружения нет рабочей копии на диске.");
  const headBranch = env.branchName;
  if (!headBranch) throw new Error("У окружения нет текущей ветки.");

  const repo = await readOrigin(sdk, env.hostId, path);
  const files = await buildChangedFiles(sdk, env.hostId, path, mergeBase.files);
  const title =
    mergeBase.commits.length === 1 ? mergeBase.commits[0].subject : headBranch;

  return runCreatePr(githubClient(token), {
    repo,
    baseBranch: base.githubBase,
    headBranch,
    files,
    title,
    body: prBody(mergeBase.commits),
  });
}

async function fastForwardBranch(
  sdk: Sdk,
  threadId: string,
): Promise<{ ok: boolean }> {
  const environmentId = await environmentIdOf(sdk, threadId);
  if (!environmentId) throw new Error("У треда нет окружения с git.");

  const env = await sdk.environments.get({ environmentId });
  const base = resolveBase(env);
  if (!base) throw new Error("У окружения не удалось определить базовую ветку.");

  const status = await sdk.environments.status({
    environmentId,
    mergeBaseBranch: base.statusBase,
  });
  if (status.outcome !== "available") {
    throw new Error(`git-статус окружения недоступен (${status.outcome}).`);
  }

  const { workingTree, mergeBase } = status.workspace;
  const decision = decideFastForward({
    behindCount: mergeBase?.behindCount ?? 0,
    aheadCount: mergeBase?.aheadCount ?? 0,
    hasUncommittedChanges: workingTree.hasUncommittedChanges,
  });
  if (!decision.visible) {
    throw new Error(`Перемотка сейчас невозможна (${decision.reason}).`);
  }

  const path = env.path;
  if (!path) throw new Error("У окружения нет рабочей копии на диске.");

  await runFastForward(gitClient(path), base.githubBase);
  return { ok: true };
}

async function computeMergeState(
  sdk: Sdk,
  threadId: string,
): Promise<{ visible: boolean; indicator: MergeIndicator; prUrl: string | null }> {
  const environmentId = await environmentIdOf(sdk, threadId);
  if (!environmentId) return { visible: false, indicator: "unknown", prUrl: null };

  const pr = await lookupPullRequest(sdk, environmentId);
  if (pr.state === null || pr.checksState === null) {
    return { visible: false, indicator: "unknown", prUrl: pr.url };
  }
  const decision = decideMergeReadiness({ prState: pr.state, checksState: pr.checksState });
  return { visible: decision.visible, indicator: decision.indicator, prUrl: pr.url };
}

// Мёржим тем же способом (squash), которым в проекте уже принято доводить
// ветку до main — см. memory/decisions/fast-forward-ff-only-safe.md. bb сам
// делает запрос к GitHub (sdk.environments.mergePullRequest), плагину не нужно
// собирать его руками, как для createPr.
const MERGE_METHOD = "squash";

async function mergePullRequest(
  sdk: Sdk,
  kv: PluginKvStorage,
  threadId: string,
): Promise<{ ok: boolean }> {
  const environmentId = await environmentIdOf(sdk, threadId);
  if (!environmentId) throw new Error("У треда нет окружения с git.");

  // HEAD берём ДО мёржа: сам мёрдж — только запрос к GitHub API, локальный git
  // он не трогает, поэтому HEAD не сдвигается. Squash-мёрдж создаёт на GitHub
  // новый коммит с другим SHA — старые коммиты локальной ветки навсегда
  // остаются «впереди» базовой по счётчику (aheadCount), хотя по содержимому
  // уже целиком влиты. Запоминаем ровно этот HEAD как «уже смёржен нами»:
  // decideVisibility в src/core/visibility.ts прячет по нему кнопку PR, пока
  // не появится новый коммит (см. wasHeadAlreadyMerged).
  const headSha = await currentHeadSha(sdk, environmentId);
  await sdk.environments.mergePullRequest({ environmentId, method: MERGE_METHOD });
  if (headSha) await kv.set(mergedHeadKey(environmentId), headSha);

  // Мёрдж на GitHub уже прошёл — подтяжка локального main дальше best-effort:
  // неудача (реф занят в другом worktree/разошёлся) не должна ронять mergePr,
  // только лечь в KV, чтобы фронт показал причину на месте кнопки Merge.
  // См. memory/decisions/local-main-pull-after-merge.md.
  const env = await sdk.environments.get({ environmentId });
  const base = resolveBase(env);
  if (base && env.path) {
    const pull = await runLocalMainPull(gitClient(env.path), base.githubBase);
    await kv.set(localMainPullKey(environmentId), pull);
  }

  return { ok: true };
}

async function computeMainPullState(
  sdk: Sdk,
  kv: PluginKvStorage,
  threadId: string,
): Promise<{ attempted: boolean; ok: boolean; reason: string | null }> {
  const environmentId = await environmentIdOf(sdk, threadId);
  if (!environmentId) return { attempted: false, ok: true, reason: null };

  const stored = await kv.get<LocalMainPullResult>(localMainPullKey(environmentId));
  if (!stored) return { attempted: false, ok: true, reason: null };
  return stored.ok
    ? { attempted: true, ok: true, reason: null }
    : { attempted: true, ok: false, reason: stored.reason };
}

async function currentHeadSha(sdk: Sdk, environmentId: string): Promise<string | null> {
  const status = await sdk.environments.status({ environmentId });
  return status.outcome === "available" ? checkoutHeadSha(status.workspace.checkout) : null;
}

// «unborn» (репозиторий без коммитов) и «unknown» (не удалось определить) не
// несут SHA вовсе — им нечего сравнивать с сохранённым «уже смёржено».
type WorkspaceCheckout =
  | { kind: "branch"; headSha: string | null }
  | { kind: "detached"; headSha: string | null }
  | { kind: "unborn" }
  | { kind: "unknown" };

function checkoutHeadSha(checkout: WorkspaceCheckout): string | null {
  switch (checkout.kind) {
    case "branch":
    case "detached":
      return checkout.headSha;
    case "unborn":
    case "unknown":
      return null;
  }
}

function mergedHeadKey(environmentId: string): string {
  return `merged-head:${environmentId}`;
}

function localMainPullKey(environmentId: string): string {
  return `local-main-pull:${environmentId}`;
}

async function wasHeadAlreadyMerged(
  kv: PluginKvStorage,
  environmentId: string,
  headSha: string | null,
): Promise<boolean> {
  if (!headSha) return false;
  const mergedSha = await kv.get<string>(mergedHeadKey(environmentId));
  return mergedSha === headSha;
}

async function environmentIdOf(sdk: Sdk, threadId: string): Promise<string | null> {
  const thread = await sdk.threads.get({ threadId });
  return thread.environmentId;
}

// environments.pullRequest бросает 409 для персональных/не-git/удалённых
// окружений — это не наша ошибка, а «PR тут неоткуда взяться». Глушим в
// «unknown», чтобы не ронять prState на каждом таком треде.
//
// Живой PR (open/draft) блокирует кнопку; слитый/закрытый (merged/closed) —
// нет: на новый коммит поверх слитого можно открыть новый PR.
async function lookupPullRequest(
  sdk: Sdk,
  environmentId: string,
): Promise<{
  presence: PrPresence;
  url: string | null;
  state: PrState | null;
  checksState: ChecksState | null;
}> {
  try {
    const pr = await sdk.environments.pullRequest({ environmentId });
    if (pr.outcome === "available") {
      const { state, url, checks } = pr.pullRequest;
      const presence: PrPresence =
        state === "open" || state === "draft" ? "open" : "settled";
      return { presence, url, state, checksState: checks.state };
    }
    if (pr.outcome === "absent") {
      return { presence: "absent", url: null, state: null, checksState: null };
    }
    return { presence: "unknown", url: null, state: null, checksState: null };
  } catch {
    return { presence: "unknown", url: null, state: null, checksState: null };
  }
}

// Токен по умолчанию — из gh на машине bb; gh дёргаем только когда настройка
// пуста, чтобы не запускать процесс без нужды.
async function resolveToken(settings: {
  get(): Promise<{ githubToken: string | undefined }>;
}): Promise<string> {
  const { githubToken } = await settings.get();
  const ghToken = githubToken?.trim() ? null : await ghAuthToken();
  const token = chooseToken(githubToken, ghToken);
  if (!token) {
    throw new Error(
      "Нет GitHub-токена: gh не авторизован и токен не задан в настройках. " +
        "Выполни `gh auth login` либо укажи токен в настройках плагина.",
    );
  }
  return token;
}

async function readOrigin(
  sdk: Sdk,
  hostId: string,
  path: string,
): Promise<RepoRef> {
  const configText = await readGitConfig(sdk, hostId, path);
  const originUrl = originUrlFromGitConfig(configText);
  if (!originUrl) throw new Error("В git-config нет ремоута origin.");
  const repo = parseGithubRemote(originUrl);
  if (!repo) throw new Error(`origin не на github.com: ${originUrl}`);
  return repo;
}

// У воркри `<path>/.git` — файл-указатель на общий gitdir; у обычного чекаута
// это директория, тогда config лежит прямо в `<path>/.git/config`.
async function readGitConfig(
  sdk: Sdk,
  hostId: string,
  path: string,
): Promise<string> {
  try {
    const pointer = decode(await sdk.files.read({ path: `${path}/.git`, hostId }));
    const gitdir = parseGitdirPointer(pointer);
    if (gitdir) {
      return decode(
        await sdk.files.read({ path: configPathFromGitdir(gitdir), hostId }),
      );
    }
  } catch {
    // `.git` — директория: падаем в чтение config напрямую ниже.
  }
  return decode(await sdk.files.read({ path: `${path}/.git/config`, hostId }));
}

async function buildChangedFiles(
  sdk: Sdk,
  hostId: string,
  path: string,
  files: readonly { path: string; status: Parameters<typeof isDeletion>[0] }[],
): Promise<ChangedFile[]> {
  const result: ChangedFile[] = [];
  for (const file of files) {
    if (isDeletion(file.status)) {
      result.push({ kind: "delete", path: file.path });
      continue;
    }
    const read = (await sdk.files.read({
      path: `${path}/${file.path}`,
      hostId,
    })) as FileRead;
    // Содержимое отдаём GitHub как есть: utf8 → blob utf-8, base64 → base64.
    result.push({
      kind: "upsert",
      path: file.path,
      content: read.content,
      encoding: read.contentEncoding === "base64" ? "base64" : "utf-8",
    });
  }
  return result;
}

function prBody(commits: readonly { subject: string }[]): string {
  if (commits.length === 0) return "Открыто из bb.";
  return commits.map((commit) => `- ${commit.subject}`).join("\n");
}

function decode(file: FileRead): string {
  return file.contentEncoding === "base64"
    ? Buffer.from(file.content, "base64").toString("utf8")
    : file.content;
}
