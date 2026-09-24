// Передача работы в новый тред: сосед исходного, как нативная передача bb, или
// его ребёнок, когда владелец выбрал место `child`. Тот же проект, окружение по
// выбранным дереву и ветке — место решает только, будет ли родитель; первое
// сообщение — упоминание исходного треда, ответ владельца и его картинки.
// Картинки — вложения проекта: в чужой проект они копируются до создания
// треда, иначе bb не найдёт их там по пути. Оболочка эффектов:
// ничего не бросает, сбой возвращается исходом, потому что ответ владельца к
// этому моменту уже записан.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { messages } from "../lib/messages";
import type { Locale } from "../lib/i18n";
import { legacyRoute, routeEnvironment } from "../core/places";
import type { DecisionBrief, DispatchPlace, DispatchRoute } from "../shared/contract";

export type HandoffResult = { kind: "created"; threadId: string } | { kind: "failed"; error: string };

/** `route` — дерево и ветка нового треда; без него место читается по-старому. `images` — пути вложений проекта исходного треда. */
type HandoffArgs = { brief: DecisionBrief; place: Exclude<DispatchPlace, "here">; route?: DispatchRoute; text: string; images?: readonly string[]; locale?: Locale };

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const handoff = async (bb: Pick<BbPluginApi, "sdk">, { brief, place, route, text, images = [], locale }: HandoffArgs): Promise<HandoffResult> => {
  try {
    const thread = await bb.sdk.threads.get({ threadId: brief.threadId });
    if (thread.environmentId === null) return { kind: "failed", error: "the source thread has no environment" };
    const environmentId = thread.environmentId;
    // Хост и ветка читаются только для другого дерева: тред того же дерева переиспользует окружение как есть.
    const chosen = route ?? legacyRoute(place);
    // Чужой проект заводит дерево сам — окружение треда ему не нужно; остальным маршрутам нужны хост, ветка и путь дерева.
    const target =
      place === "other"
        ? routeEnvironment(place, chosen, { environmentId, hostId: "", branchName: null })
        : await bb.sdk.environments
            .get({ environmentId })
            .then((environment) => routeEnvironment(place, chosen, { environmentId, hostId: environment.hostId, branchName: environment.branchName, path: environment.path }));
    // Работа уезжает в другой проект только местом `other` с выбранным проектом; без выбора она остаётся в своём.
    const targetProjectId = place === "other" && chosen.projectId !== undefined ? chosen.projectId : thread.projectId;
    if (images.length > 0 && targetProjectId !== thread.projectId) {
      await bb.sdk.projects.attachments.copy({ projectId: targetProjectId, sourceProjectId: thread.projectId, paths: [...images] });
    }
    const token = `@thread:${brief.threadId}`;
    const intro = messages(locale).answer.handoffFrom(token);
    const start = intro.indexOf(token);
    const mention = { start, end: start + token.length, resource: { kind: "thread" as const, projectId: thread.projectId, threadId: brief.threadId, label: thread.title ?? brief.title } };
    const created = await bb.sdk.threads.spawn({
      projectId: targetProjectId,
      // Родитель — только у дочернего треда: сосед висит рядом с исходным, а чужой проект — отдельное место, и родителя там нет.
      ...(place === "child" ? { parentThreadId: brief.threadId } : {}),
      title: brief.title,
      environment: target,
      input: [{ type: "text", text: `${intro}\n\n${text}`, mentions: [mention] }, ...images.map((path) => ({ type: "localImage" as const, path }))],
    });
    return { kind: "created", threadId: created.id };
  } catch (error) {
    return { kind: "failed", error: errorText(error) };
  }
};
