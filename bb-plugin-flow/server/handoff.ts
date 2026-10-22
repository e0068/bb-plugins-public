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
import { legacyRoute, projectHost, routeEnvironment } from "../core/places";
import { sendFailureOf } from "../core/send-failure";
import type { DecisionBrief, DispatchPlace, DispatchRoute, Execution } from "../shared/contract";
import { attachmentInput, type UploadedImage } from "./attachments";

/** `unconfirmed` — bb не дождался создания треда: тред мог появиться, и повтор открыл бы второй. */
export type HandoffResult = { kind: "created"; threadId: string } | { kind: "unconfirmed"; error: string } | { kind: "failed"; error: string };

/**
 * `route` — дерево и ветка нового треда; без него место читается по-старому. `images` — пути картинок-вложений проекта
 * исходного треда; `attachments` — вложения с типом: картинки уходят картинкой, остальное — файлом.
 */
/** `execution` — провайдер, модель, effort и скорость нового треда из ряда виджета; нет — как у bb по умолчанию. */
type HandoffArgs = { brief: DecisionBrief; place: Exclude<DispatchPlace, "here">; route?: DispatchRoute; text: string; images?: readonly string[]; attachments?: readonly UploadedImage[]; locale?: Locale; execution?: Execution };

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

type TargetArgs = { place: Exclude<DispatchPlace, "here">; route: DispatchRoute; environmentId: string; projectId: string };

type Target = { kind: "ready"; environment: ReturnType<typeof routeEnvironment> } | { kind: "failed"; error: string };

/** Окружение нового треда: чужому проекту нужен только хост самого проекта, остальным маршрутам — хост, ветка и путь дерева треда. */
const targetEnvironment = async (sdk: BbPluginApi["sdk"], { place, route, environmentId, projectId }: TargetArgs): Promise<Target> => {
  if (place === "other") {
    const hostId = projectHost((await sdk.projects.get({ projectId })).sources);
    return hostId === undefined
      ? { kind: "failed", error: `the project "${projectId}" has no source to host the new thread` }
      : { kind: "ready", environment: routeEnvironment(place, route, { environmentId, hostId, branchName: null }) };
  }
  const environment = await sdk.environments.get({ environmentId });
  return { kind: "ready", environment: routeEnvironment(place, route, { environmentId, hostId: environment.hostId, branchName: environment.branchName, path: environment.path }) };
};

export const handoff = async (bb: Pick<BbPluginApi, "sdk">, { brief, place, route, text, images = [], attachments = [], locale, execution }: HandoffArgs): Promise<HandoffResult> => {
  const files = [...images.map((path) => ({ type: "localImage" as const, path })), ...attachments.map(attachmentInput)];
  try {
    const thread = await bb.sdk.threads.get({ threadId: brief.threadId });
    if (thread.environmentId === null) return { kind: "failed", error: "the source thread has no environment" };
    const environmentId = thread.environmentId;
    const chosen = route ?? legacyRoute(place);
    // Работа уезжает в другой проект только местом `other` с выбранным проектом; без выбора она остаётся в своём.
    const targetProjectId = place === "other" && chosen.projectId !== undefined ? chosen.projectId : thread.projectId;
    const target = await targetEnvironment(bb.sdk, { place, route: chosen, environmentId, projectId: targetProjectId });
    if (target.kind === "failed") return target;
    if (files.length > 0 && targetProjectId !== thread.projectId) {
      await bb.sdk.projects.attachments.copy({ projectId: targetProjectId, sourceProjectId: thread.projectId, paths: files.map(({ path }) => path) });
    }
    const token = `@thread:${brief.threadId}`;
    const intro = messages(locale).answer.handoffFrom(token);
    const start = intro.indexOf(token);
    const mention = { start, end: start + token.length, resource: { kind: "thread" as const, projectId: thread.projectId, threadId: brief.threadId, label: thread.title ?? brief.title } };
    // Таймаут самого создания — исход неизвестен; таймаут шагов до него оставляет тред несозданным, это `failed`.
    return await bb.sdk.threads.spawn({
      projectId: targetProjectId,
      // Родитель — только у дочернего треда: сосед висит рядом с исходным, а чужой проект — отдельное место, и родителя там нет.
      ...(place === "child" ? { parentThreadId: brief.threadId } : {}),
      title: brief.title,
      environment: target.environment,
      ...(execution === undefined ? {} : { providerId: execution.providerId, model: execution.model, reasoningLevel: execution.reasoningLevel, ...(execution.serviceTier === undefined ? {} : { serviceTier: execution.serviceTier }) }),
      input: [{ type: "text", text: `${intro}\n\n${text}`, mentions: [mention] }, ...files],
    }).then(
      (created): HandoffResult => ({ kind: "created", threadId: created.id }),
      (error: unknown): HandoffResult => ({ kind: sendFailureOf(error).kind === "timeout" ? "unconfirmed" : "failed", error: errorText(error) }),
    );
  } catch (error) {
    return { kind: "failed", error: errorText(error) };
  }
};
