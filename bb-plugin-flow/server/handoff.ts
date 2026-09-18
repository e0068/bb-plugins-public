// Передача работы в новый тред — соседа исходного, как нативная передача bb:
// тот же проект, без родителя, окружение по выбранным дереву и ветке, первое
// сообщение — упоминание исходного треда и ответ владельца. Оболочка эффектов:
// ничего не бросает, сбой возвращается исходом, потому что ответ владельца к
// этому моменту уже записан.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { messages } from "../lib/messages";
import type { Locale } from "../lib/i18n";
import { legacyRoute, routeEnvironment } from "../core/places";
import type { DecisionBrief, DispatchPlace, DispatchRoute } from "../shared/contract";

export type HandoffResult = { kind: "created"; threadId: string } | { kind: "failed"; error: string };

/** `route` — дерево и ветка нового треда; без него место читается по-старому. */
type HandoffArgs = { brief: DecisionBrief; place: Exclude<DispatchPlace, "here">; route?: DispatchRoute; text: string; locale?: Locale };

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const handoff = async (bb: Pick<BbPluginApi, "sdk">, { brief, place, route, text, locale }: HandoffArgs): Promise<HandoffResult> => {
  try {
    const thread = await bb.sdk.threads.get({ threadId: brief.threadId });
    if (thread.environmentId === null) return { kind: "failed", error: "the source thread has no environment" };
    const environmentId = thread.environmentId;
    // Хост и ветка читаются только для другого дерева: тред того же дерева переиспользует окружение как есть.
    const chosen = route ?? legacyRoute(place);
    const target =
      chosen.tree === "same"
        ? routeEnvironment(chosen, { environmentId, hostId: "", branchName: null })
        : await bb.sdk.environments.get({ environmentId }).then((environment) => routeEnvironment(chosen, { environmentId, hostId: environment.hostId, branchName: environment.branchName }));
    const token = `@thread:${brief.threadId}`;
    const intro = messages(locale).answer.handoffFrom(token);
    const start = intro.indexOf(token);
    const mention = { start, end: start + token.length, resource: { kind: "thread" as const, projectId: thread.projectId, threadId: brief.threadId, label: thread.title ?? brief.title } };
    const created = await bb.sdk.threads.spawn({
      projectId: thread.projectId,
      title: brief.title,
      environment: target,
      input: [{ type: "text", text: `${intro}\n\n${text}`, mentions: [mention] }],
    });
    return { kind: "created", threadId: created.id };
  } catch (error) {
    return { kind: "failed", error: errorText(error) };
  }
};
