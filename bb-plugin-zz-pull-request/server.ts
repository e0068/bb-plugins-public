// bb-plugin-zz-pull-request — вход плагина (Слой 3, только проводка).
//
// Даёт фронту два RPC: prState (показывать ли кнопку) и createPr (открыть PR на
// GitHub через API без push). Вся логика — в слоях ниже: чистое ядро (src/core)
// и оркестратор GitHub-потока (src/wiring/create-pr). Здесь — чтение мира через
// bb.sdk и склейка.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { resolveBase } from "./src/core/base-branch";
import { isDeletion } from "./src/core/changed-files";
import {
  configPathFromGitdir,
  originUrlFromGitConfig,
  parseGitdirPointer,
} from "./src/core/git-config";
import type { ChangedFile, RepoRef } from "./src/core/github-requests";
import { parseGithubRemote } from "./src/core/remote";
import { threadChangeTouchesPr } from "./src/core/thread-change";
import { chooseToken } from "./src/core/token";
import { decideVisibility, type PrLookupOutcome } from "./src/core/visibility";
import { runCreatePr } from "./src/wiring/create-pr";
import { ghAuthToken } from "./src/wiring/gh-token";
import { githubClient } from "./src/wiring/github-client";

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

  bb.rpc.register(rpcContract, {
    async prState({ threadId }) {
      return computePrState(bb.sdk, threadId);
    },
    async createPr({ threadId }) {
      const token = await resolveToken(settings);
      return gatherAndCreate(bb.sdk, token, threadId);
    },
  });

  // Толкаем фронт перечитать prState на двух источниках правды:
  // - environment:changed — коммит/смена ветки/git-refs меняют git-статус;
  // - thread:changed(environment-changed) — bb опознал/сменил PR у треда;
  //   без этой подписки строчка оживала бы только по перезагрузке интерфейса.
  const republish = () => bb.realtime.publish("changed", {});
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
    pr: pr.outcome,
  });
  return { visible: decision.visible, reason: decision.reason, prUrl: pr.url };
}

async function gatherAndCreate(
  sdk: Sdk,
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
    pr: pr.outcome,
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

async function environmentIdOf(sdk: Sdk, threadId: string): Promise<string | null> {
  const thread = await sdk.threads.get({ threadId });
  return thread.environmentId;
}

// environments.pullRequest бросает 409 для персональных/не-git/удалённых
// окружений — это не наша ошибка, а «PR тут неоткуда взяться». Глушим в
// «unavailable», чтобы не ронять prState на каждом таком треде.
async function lookupPullRequest(
  sdk: Sdk,
  environmentId: string,
): Promise<{ outcome: PrLookupOutcome; url: string | null }> {
  try {
    const pr = await sdk.environments.pullRequest({ environmentId });
    if (pr.outcome === "available") {
      return { outcome: "available", url: pr.pullRequest.url };
    }
    return { outcome: pr.outcome, url: null };
  } catch {
    return { outcome: "unavailable", url: null };
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
