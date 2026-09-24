// Пишет файл решения в рабочее дерево треда — минимальные данные, без
// похода в git или Tasks+. Сбой ничего не бросает: ответ владельца и
// реплика агенту не зависят от того, лёг ли журнал на диск.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { decisionDocument, decisionFileName, journalPaths, suffixedName } from "../core/journal-doc";
import type { Locale } from "../lib/i18n";
import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import type { JournalDirStore } from "./dir-settings";

export type WriteDecisionResult =
  | { kind: "written"; path: string }
  | { kind: "skipped"; reason: "not_configured" | "no_environment" }
  | { kind: "failed"; error: string };

/** Столько раз развести имя суффиксом, прежде чем сдаться — с большим запасом от разумного числа брифов на директорию. */
const MAX_ATTEMPTS = 30;

export const writeDecision = async (
  bb: Pick<BbPluginApi, "sdk" | "log">,
  dirs: JournalDirStore,
  args: { brief: DecisionBrief; answer: DecisionAnswer; decidedAt: string; locale?: Locale },
): Promise<WriteDecisionResult> => {
  const result = await write(bb, dirs, args);
  if (result.kind === "failed") bb.log.warn(`decisions: журнал не записан для брифа ${args.brief.id}: ${result.error}`);
  return result;
};

const write = async (
  bb: Pick<BbPluginApi, "sdk">,
  dirs: JournalDirStore,
  args: { brief: DecisionBrief; answer: DecisionAnswer; decidedAt: string; locale?: Locale },
): Promise<WriteDecisionResult> => {
  try {
    const thread = await bb.sdk.threads.get({ threadId: args.brief.threadId });
    const configured = await dirs.get(thread.projectId);
    if (configured.kind !== "configured") return { kind: "skipped", reason: "not_configured" };
    if (thread.environmentId === null) return { kind: "skipped", reason: "no_environment" };
    const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId });
    if (environment.path === null) return { kind: "skipped", reason: "no_environment" };

    const base = decisionFileName(args.brief.title);
    const content = decisionDocument({ brief: args.brief, answer: args.answer, decidedAt: args.decidedAt, locale: args.locale });
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      // Хосту — абсолютный путь: `rootPath` для него граница песочницы, а не база склейки.
      const path = journalPaths(environment.path, configured.path, `${suffixedName(base, attempt)}.md`);
      const written = await bb.sdk.files.write({
        hostId: environment.hostId,
        rootPath: environment.path,
        path: path.absolute,
        content,
        contentEncoding: "utf8",
        createParents: true,
        expectedSha256: null,
      });
      if (written.outcome === "written") return { kind: "written", path: path.relative };
    }
    return { kind: "failed", error: "name collision limit reached" };
  } catch (error) {
    return { kind: "failed", error: error instanceof Error ? error.message : String(error) };
  }
};
