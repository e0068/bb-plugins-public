// RPC виджета. Виджет сам не пишет и не шлёт: запись ответа, реплика агенту
// и сигнал другим вкладкам идут отсюда, строго в этом порядке.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { needsAgentReply } from "../core/agent-reply";
import { answerMessageText, openQuestions } from "../core/answer-message";
import { forecast, hasForecast, scopeOf } from "../core/budget";
import { carryOf } from "../core/carry";
import { finalCriteria } from "../core/option-criteria";
import { demoVerdict } from "../core/outcome";
import { routeAllowed } from "../core/places";
import { onAnswer } from "../core/progress";
import type { Locale } from "../lib/i18n";
import { stageItems } from "../core/stages";
import { awaitingRpcContract, briefDraftRpcContract, decisionsRpcContract, dispatchRpcContract, filesRpcContract, type DecisionAnswer, type DecisionBrief, type DispatchRoute } from "../shared/contract";
import { attachmentsLine, lostImages, referencedImages, uploadAttachments } from "./attachments";
import { handoff } from "./handoff";
import type { ProgressStore } from "./progress";
import type { DecisionStore } from "./store";
import type { FlowTrigger } from "./automations";

export const ANSWERED_CHANNEL = "decisions:answered";

export const registerApi = (
  bb: Pick<BbPluginApi, "rpc" | "realtime" | "sdk">,
  store: DecisionStore,
  deps: {
    now: () => string;
    writeDecision?: (args: { brief: DecisionBrief; answer: DecisionAnswer; decidedAt: string; locale?: Locale }) => Promise<unknown>;
    /** Прогресс flow треда: ответ закрывает ждущие этапы и запоминает прогон и план, а по нему же видно, осталась ли впереди работа агента. */
    progress?: Pick<ProgressStore, "recordAnswer" | "handOver" | "get">;
    /** Сообщает Automations о событии Flow; сбой не трогает ответ (./automations.ts). */
    emit?: (trigger: FlowTrigger, threadId: string) => void;
    /** Отмечает реплику своей отправкой Flow до отправки: ход владельца по ней выбор flow не применяет (./own-sends.ts). */
    ownSend?: (threadId: string, text: string) => void;
    /** Новый тред передачи получает flow исходного; обычно его уже дало первое сообщение (./thread-start.ts), здесь — страховка. */
    carryFlow?: (fromThreadId: string, toThreadId: string) => Promise<void>;
    /** Id flow владельца: переход принимается только в один из них. */
    flowIds?: () => readonly string[];
    /** Переводит тред на flow, выбранный в Демонстрации: прежний прогон и работа снимаются, заводится пустой прогон нового (./flow-choice.ts). */
    switchFlow?: (threadId: string, flowId: string) => Promise<void>;
    /** Снимает прогон треда, чью работу переход увёл в новый тред (./flow-choice.ts). */
    releaseFlow?: (threadId: string) => Promise<void>;
    /** Flow, который получит тред передачи из этого треда вместо flow исходного (./thread-start.ts); `null` снимает запись. */
    handoffFlow?: (sourceThreadId: string, flowId: string | null) => void;
  },
): void => {
  /** Работа запущена, когда владелец взял в ближайший прогон хотя бы один этап: дальше бриф спрашивает только по делу. */
  const launchesWork = (brief: DecisionBrief, answer: DecisionAnswer): boolean =>
    stageItems(brief).length > 0 && (answer.stages ?? []).some((stage) => stage.run);

  bb.rpc.register(decisionsRpcContract, {
    async getBrief({ id }) {
      const brief = await store.getBrief(id);
      if (brief === null) return { kind: "not_found" as const };
      const answer = await store.getAnswer(id);
      // Отвеченный бриф рисуется ответом, даже если его возвращали: ответ кнопкой — последнее слово владельца.
      return { kind: "found" as const, brief, answer, ...(answer === null && (await store.isReturned(id)) ? { returned: true as const } : {}) };
    },

    async answerBrief({ id, answer, messageId, images = [], locale }) {
      const brief = await store.getBrief(id);
      if (brief === null || answer.briefId !== id) return { kind: "not_found" as const };
      const existing = await store.getAnswer(id);
      if (existing !== null) return { kind: "already_answered" as const, record: existing };
      // Невозможный маршрут отбивается до записи ответа: у чужого проекта — ещё и маршрут без выбранного проекта
      // или ответ вовсе без маршрута, иначе работа молча уехала бы в свой проект.
      const answered = answer.place ?? "here";
      if (answered === "other" && answer.route === undefined) throw new Error('the "other" place needs a route with a projectId');
      if (answer.route !== undefined && !routeAllowed(answered, answer.route))
        throw new Error(`route "${answer.route.tree}/${answer.route.branch}" is not possible for the "${answered}" place`);
      if (answer.compact === true && answered !== "here") throw new Error(`compaction is only possible for the "here" place, not "${answered}"`);
      const switched = answer.outcome?.flow;
      if (switched !== undefined && brief.outcome?.nextFlow === undefined) throw new Error(`the demo offered no flow to move to, yet the answer moves to the flow "${switched.id}"`);
      if (switched !== undefined && !(deps.flowIds?.() ?? []).includes(switched.id)) throw new Error(`the answer moves to the flow "${switched.id}", which the owner does not have`);
      const open = openQuestions(brief, answer);
      if (open.length > 0) return { kind: "incomplete" as const, questionIds: open };

      // Снимок прогноза — то, что владелец видел при отправке: отвеченный бриф рисует его, даже если формула потом изменится.
      // Картинки грузятся до записи ответа. Не принятая bb картинка ответ не роняет: реплика назовёт её несохранённой.
      const { uploaded: attached, failed } = await uploadAttachments(bb.sdk, { threadId: brief.threadId, briefId: id, images: referencedImages(answer, images, locale) });
      const predicted = hasForecast(brief) ? forecast(brief, answer, locale) : null;
      const snapshot = predicted === null ? {} : { forecast: { ...predicted, lines: [...predicted.lines] } };
      const written = await store.putAnswer(id, { answer, messageId, answeredAt: deps.now(), ...snapshot });
      if (written.kind === "already_answered") return written;
      const lost = lostImages(answer, { uploaded: attached, failed }, locale);
      const text = `${answerMessageText(brief, answer, locale)}${attachmentsLine(attached, lost, locale)}`;
      const place = answer.place ?? "here";
      let handoffThreadId: string | undefined;
      try {
        if (place === "here") {
          // Компактация — первой и до конца: реплика, поставленная раньше, попала бы в срезанный контекст.
          // Владелец её попросил, поэтому она идёт и тогда, когда реплики агенту не будет.
          if (answer.compact === true) await bb.sdk.threads.compact({ threadId: brief.threadId });
          // Переход — до реплики: ход агента, который она начнёт, уже идёт по новому flow.
          if (switched !== undefined) await deps.switchFlow?.(brief.threadId, switched.id);
          // Реплика будит агента, поэтому уходит, только когда ему есть что
          // делать: прогресс берётся уже с этим ответом — закрытые и
          // вычеркнутые им этапы в счёт не идут. В новый тред ответ уезжает
          // всегда: там вся работа впереди.
          // После перехода у агента вся работа нового flow впереди.
          const record = switched === undefined ? ((await deps.progress?.get(brief.threadId).catch(() => null)) ?? null) : null;
          const ahead = record === null ? null : onAnswer(record, brief, answer, written.record.answeredAt);
          if (switched !== undefined || needsAgentReply(brief, answer, ahead, attached.length + lost.length)) {
            deps.ownSend?.(brief.threadId, text);
            await bb.sdk.threads.send({
              threadId: brief.threadId,
              mode: brief.kind === "clarify" ? "steer-if-active" : "queue-if-active",
              input: [{ type: "text", text, mentions: [] }, ...attached.map(({ path }) => ({ type: "localImage" as const, path }))],
            });
          }
        } else {
          // Ответ уезжает целиком в новый тред: исходный остаётся с отвеченным брифом и ссылкой на него.
          if (switched !== undefined) deps.handoffFlow?.(brief.threadId, switched.id);
          const created = await handoff(bb, { brief, place, ...(answer.route === undefined ? {} : { route: answer.route }), text, images: attached.map(({ path }) => path), locale });
          if (created.kind === "failed") throw new Error(created.error);
          handoffThreadId = created.threadId;
        }
      } catch (cause) {
        // Передача не состоялась — выбранный flow не должен достаться следующей.
        if (switched !== undefined) deps.handoffFlow?.(brief.threadId, null);
        // Реплика не ушла — агент ответа не узнает. Запись снимается, чтобы
        // повторная отправка из виджета дошла, а не упёрлась в already_answered.
        await store.dropAnswer(id);
        throw cause;
      }
      // Дальше реплика уже ушла: ни один сбой ниже не снимает ответ — повтор создал бы второй тред.
      // Худшее при сбое отметки — запущенный тред ещё примет этапы; это мягче дубля треда.
      const quietly = (work: Promise<unknown>) => work.catch(() => undefined);
      if (handoffThreadId !== undefined) {
        await quietly(store.attachHandoff(id, handoffThreadId));
        // Переход начинает работу заново: новый тред решает этапы и бюджет своим первым брифом, а прогон ответа в исходном снимается.
        if (switched === undefined) await quietly(store.markLaunched(handoffThreadId));
        else await quietly(deps.releaseFlow?.(brief.threadId) ?? Promise.resolve());
      }
      // Помнится только маршрут нового треда; само место — нет: запомненный «Новый тред» переносил работу на каждом следующем ответе.
      if (brief.kind === "brief" && answer.route !== undefined) await quietly(rememberRoute(brief, answer.route));
      if (brief.kind === "brief" && launchesWork(brief, answer)) await quietly(store.markLaunched(brief.threadId));
      // Выбор владельца уходит в следующий бриф треда; уточнение первой части не несёт и перенос не трогает. Переход начинает работу с чистого листа.
      if (brief.kind === "brief" && switched === undefined) await store.putThreadCarry(brief.threadId, carryOf(brief, answer));
      // Утверждённое «Готово, когда» и объём ждут брифа посреди работы — в этом треде и в новом, куда ушла работа.
      // Бриф без своих пунктов дописывает пункты выбранного варианта к уже утверждённым.
      if (brief.kind === "brief" && brief.outcome === undefined) {
        const answered = finalCriteria(brief, answer);
        const approved = brief.setup?.criteria === undefined ? [...new Set([...(brief.approved ?? []), ...answered])] : answered;
        const scope = scopeOf(brief, answer);
        for (const threadId of [brief.threadId, ...(handoffThreadId === undefined ? [] : [handoffThreadId])]) {
          if (approved.length > 0) await quietly(store.putThreadCriteria(threadId, approved));
          if (scope !== undefined) await quietly(store.putThreadScope(threadId, scope));
        }
      }
      // Переход в другой flow прогон ответа не продолжает: тред ушёл в новый flow с пустым прогоном.
      if (brief.kind === "brief" && switched === undefined) {
        const planned = predicted === null ? undefined : { minutes: predicted.minutes, target: predicted.target, max: predicted.max };
        await quietly(deps.progress?.recordAnswer(brief, answer, written.record.answeredAt, planned) ?? Promise.resolve());
        // Работа ушла в новый тред — он ведёт дальше тот же прогон, уже с планом этого ответа, а исходный его только показывает;
        // этапы прогона ответа стоят непройденными: сделал их предшественник, а не новый тред.
        if (handoffThreadId !== undefined) {
          await quietly(deps.carryFlow?.(brief.threadId, handoffThreadId) ?? Promise.resolve());
          await quietly(deps.progress?.handOver(brief.threadId, handoffThreadId, answer.stages ?? []) ?? Promise.resolve());
        }
      }
      await quietly(store.clearAwaiting(brief.threadId, id));
      // Ответ кнопкой — последнее слово владельца: возвращённым бриф больше не считается, и черновик не нужен.
      await quietly(store.clearThreadReturned(brief.threadId, id));
      await quietly(store.dropDraft(id));
      bb.realtime.publish(ANSWERED_CHANNEL, { id });
      // Ответ уже записан и ушёл: событие для Automations — последнее и ничего не отменяет.
      const emit = (trigger: FlowTrigger) => {
        try {
          deps.emit?.(trigger, brief.threadId);
        } catch {
          // Automations недоступен — ответ владельца от этого не зависит.
        }
      };
      // Комментарий Демонстрацию не принимает: этап открыт, и автоматизациям отвечать не на что.
      // Переход в другой flow — тоже: Демонстрация не принята, и автоматизациям за ней отвечать не на что.
      const verdict = demoVerdict(answer);
      if (verdict !== "comment" && verdict !== "switch") emit("flow.brief-answered");
      if (brief.setup?.criteria !== undefined) emit("flow.criteria-approved");
      // Журнал — только для брифов: уточнение не решение. Сбой или отсутствие настройки не отменяют ни ответа, ни реплики, уже ушедших выше.
      if (brief.kind === "brief") await deps.writeDecision?.({ brief, answer, decidedAt: written.record.answeredAt, locale }).catch(() => undefined);
      return { kind: "accepted" as const, record: handoffThreadId === undefined ? written.record : { ...written.record, handoffThreadId } };
    },
  });

  async function rememberRoute(brief: DecisionBrief, route: DispatchRoute): Promise<void> {
    const thread = await bb.sdk.threads.get({ threadId: brief.threadId });
    await store.putRoute(thread.projectId, route);
  }

  bb.rpc.register(briefDraftRpcContract, {
    async saveBriefDraft({ id, draft }) {
      if ((await store.getBrief(id)) === null) return { kind: "not_found" as const };
      if ((await store.getAnswer(id)) !== null || (await store.isReturned(id))) return { kind: "closed" as const };
      await store.putDraft(id, draft);
      return { kind: "saved" as const };
    },
  });

  bb.rpc.register(awaitingRpcContract, {
    awaitingThreads: () => store.listAwaiting().then((list) => list.map(({ threadId, kind }) => ({ threadId, kind }))),
  });

  bb.rpc.register(dispatchRpcContract, {
    async listProjects({ threadId }) {
      try {
        const thread = await bb.sdk.threads.get({ threadId });
        const all: ReadonlyArray<{ id: string; name: string }> = await bb.sdk.projects.list();
        return { kind: "found" as const, projects: all.filter((project) => project.id !== thread.projectId).map(({ id, name }) => ({ id, name })) };
      } catch {
        // Список проектов — удобство выбора места: его сбой не должен ронять раскрытый выбор.
        return { kind: "unavailable" as const };
      }
    },

    // Каждый бриф открывается «в этом треде»: новый тред создаёт только выбор в самом ответе.
    async getDispatchPlace({ threadId }) {
      try {
        const thread = await bb.sdk.threads.get({ threadId });
        const route = await store.getRoute(thread.projectId);
        return route === null ? { place: "here" as const } : { place: "here" as const, route };
      } catch {
        // Проект неизвестен — виджет открывается на «в этом треде»: это безопасное значение.
        return { place: "here" as const };
      }
    },
  });

  bb.rpc.register(filesRpcContract, {
    async threadFiles({ threadId }) {
      // bb не знает треда или его хранилища — корня нет, а не ошибка: ссылка просто не откроется.
      const [environmentId, storage] = await Promise.all([
        bb.sdk.threads.get({ threadId }).then(
          (thread) => thread.environmentId,
          () => null,
        ),
        bb.sdk.threads.storageLocation({ threadId }).then(
          ({ hostId, storageRootPath }) => ({ hostId, storageRootPath }),
          () => null,
        ),
      ]);
      return { environmentId, storage };
    },
  });
};
