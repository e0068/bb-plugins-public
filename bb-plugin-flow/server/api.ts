// RPC виджета. Виджет сам не пишет и не шлёт: запись ответа, реплика агенту
// и сигнал другим вкладкам идут отсюда, строго в этом порядке.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { needsAgentReply } from "../core/agent-reply";
import { answerMessageParts, openQuestions } from "../core/answer-message";
import { forecast, hasForecast, scopeOf } from "../core/budget";
import { settleClarifyAnswer } from "../core/clarify";
import { carryOf } from "../core/carry";
import { defaultExecutionOf, providerModelsOf } from "../core/flow-agent";
import { finalCriteria } from "../core/option-criteria";
import { demoVerdict, isReport, outcomeKind } from "../core/outcome";
import { routeAllowed } from "../core/places";
import { onAnswer } from "../core/progress";
import { EMPTY_PROTOTYPE, markSent, mergeEdit, prototypeAddress, prototypeLines } from "../core/prototype";
import type { Locale } from "../lib/i18n";
import { messages } from "../lib/messages";
import { isSideChat } from "../core/side-chat";
import { stageItems } from "../core/stages";
import { answerImagesRpcContract, awaitingRpcContract, briefDraftRpcContract, decisionsRpcContract, dispatchRpcContract, filesRpcContract, prototypeRpcContract, widgetAgentRpcContract, type DecisionAnswer, type DecisionBrief, type DispatchRoute, type Execution, type WidgetAgent } from "../shared/contract";
import { attachmentInput, attachmentsLine, lostImages, readAttachments, referencedImages, uploadAttachments } from "./attachments";
import { handoff } from "./handoff";
import type { ProgressStore } from "./progress";
import type { DecisionStore } from "./store";
import type { FlowTrigger } from "./automations";

export const ANSWERED_CHANNEL = "decisions:answered";

/** Часть реплики, которую bb отдаёт агенту, но не рисует в ленте треда. */
const AGENT_ONLY = "agent-only" as const;

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
    /** Дошло ли окно треда до зоны предвыбора компактации (./context.ts); нет зависимости или сбой — бриф открывается без компактации. */
    compactPreselected?: (threadId: string) => Promise<boolean>;
    /** Id flow владельца: переход принимается только в один из них. */
    flowIds?: () => readonly string[];
    /** Переводит тред на flow, выбранный в Демонстрации: прежний прогон и работа снимаются, заводится пустой прогон нового (./flow-choice.ts). */
    switchFlow?: (threadId: string, flowId: string) => Promise<void>;
    /** Открытый и не слитый PR рабочего дерева треда; нет такого или bb не ответил — `null`. Не задано — PR не называется. */
    openPullRequest?: (threadId: string) => Promise<{ number: number; url: string } | null>;
    /** Снимает прогон треда, чью работу переход увёл в новый тред (./flow-choice.ts). */
    releaseFlow?: (threadId: string) => Promise<void>;
    /** Flow, который получит тред передачи из этого треда вместо flow исходного (./thread-start.ts); `null` снимает запись. */
    handoffFlow?: (sourceThreadId: string, flowId: string | null) => void;
    /** Flow владельца с их моделью — для кнопки Flow и предложения модели в ряду виджета. Не задано — пусто. */
    widgetFlows?: () => WidgetAgent["flows"];
    /** Настоящий flow треда; без flow — `null`. Не задано — `null`. */
    threadFlowId?: (threadId: string) => string | null;
  },
): void => {
  /** Работа запущена, когда владелец взял в ближайший прогон хотя бы один этап: дальше бриф спрашивает только по делу. */
  const launchesWork = (brief: DecisionBrief, answer: DecisionAnswer): boolean =>
    stageItems(brief).length > 0 && (answer.stages ?? []).some((stage) => stage.run);

  /** Комментарий к утверждению — ответ на итог вида approve с вердиктом comment: Демонстрацию и переход в другой flow он не сворачивает. */
  const foldsGroup = (brief: DecisionBrief, verdict: ReturnType<typeof demoVerdict>): boolean => verdict === "comment" && brief.outcome !== undefined && outcomeKind(brief) === "approve";

  /** Прототипы Демонстраций группы утверждения, в которых владелец что-то сделал: адрес без якоря и память. */
  const groupPrototypes = async (approval: DecisionBrief) => {
    const briefs = await Promise.all((await store.getApprovalGroup(approval.id)).map((id) => store.getBrief(id)));
    const urls = [...new Set(briefs.flatMap((member) => (member?.outcome?.prototype === undefined ? [] : [prototypeAddress(member.outcome.prototype.url)])))];
    const states = await Promise.all(urls.map(async (url) => ({ url, state: await store.getPrototype(approval.threadId, url) })));
    return states.flatMap(({ url, state }) => (state === null ? [] : [{ url, state }]));
  };

  bb.rpc.register(decisionsRpcContract, {
    async getBrief({ id }) {
      const brief = await store.getBrief(id);
      if (brief === null) return { kind: "not_found" as const };
      const answer = await store.getAnswer(id);
      // Свёрнутая группа — строка на месте утверждения; виджет, возвращённый до групп, — группа из одного.
      const fold = (await store.getFold(id)) ?? (answer === null && (await store.isReturned(id)) ? { holder: id, ids: [id] } : null);
      // Свёрнутый неотвеченный виджет раскрытая строка рисует черновиком владельца; несвёрнутый его держит окно.
      const draft = fold !== null && answer === null ? await store.getDraft(id) : null;
      // Решённым считается только неотвеченное: ответ владельца, пришедший раньше, остаётся ответом.
      const resolved = answer === null && (await store.isResolved(id));
      return { kind: "found" as const, brief, answer, ...(fold === null ? {} : { fold }), ...(draft === null ? {} : { draft }), ...(resolved ? { resolved: true as const } : {}) };
    },

    async answerBrief({ id, answer: sent, messageId, images = [], locale }) {
      const brief = await store.getBrief(id);
      if (brief === null || sent.briefId !== id) return { kind: "not_found" as const };
      const answer = settleClarifyAnswer(brief, sent);
      const existing = await store.getAnswer(id);
      if (existing !== null) return { kind: "already_answered" as const, record: existing };
      // Демонстрация — отчёт: ответа она не принимает, комментарий и переход в другой flow — на утверждении.
      if (isReport(brief)) throw new Error("a demo is a report: it takes no answer — the owner comments on the approval or writes in the chat");
      // Невозможный маршрут отбивается до записи ответа: у чужого проекта — ещё и маршрут без выбранного проекта
      // или ответ вовсе без маршрута, иначе работа молча уехала бы в свой проект.
      const answered = answer.place ?? "here";
      if (answered === "other" && answer.route === undefined) throw new Error('the "other" place needs a route with a projectId');
      if (answer.route !== undefined && !routeAllowed(answered, answer.route))
        throw new Error(`route "${answer.route.tree}/${answer.route.branch}" is not possible for the "${answered}" place`);
      if (answer.compact === true && answered !== "here") throw new Error(`compaction is only possible for the "here" place, not "${answered}"`);
      // Flow выбирают кнопкой ряда у любого виджета: у итога выбор едет в `outcome.flow`, у остальных — в `flow`.
      const switched = answer.outcome?.flow ?? answer.flow;
      if (switched !== undefined && !(deps.flowIds?.() ?? []).includes(switched.id)) throw new Error(`the answer moves to the flow "${switched.id}", which the owner does not have`);
      // Провайдера у живого треда не сменить: другой провайдер уходит только в новый тред.
      const execution = answer.execution;
      if (execution !== undefined && answered === "here" && (await bb.sdk.threads.get({ threadId: brief.threadId })).providerId !== execution.providerId)
        throw new Error(`the provider "${execution.providerId}" differs from the thread's: another provider runs only in a new thread`);
      const open = openQuestions(brief, answer);
      if (open.length > 0) return { kind: "incomplete" as const, questionIds: open };

      // Снимок прогноза — то, что владелец видел при отправке: отвеченный бриф рисует его, даже если формула потом изменится.
      // Картинки грузятся до записи ответа. Не принятая bb картинка ответ не роняет: реплика назовёт её несохранённой.
      const { uploaded: attached, failed } = await uploadAttachments(bb.sdk, { threadId: brief.threadId, briefId: id, images: referencedImages(answer, images, locale) });
      const predicted = hasForecast(brief) ? forecast(brief, answer, locale) : null;
      const snapshot = predicted === null ? {} : { forecast: { ...predicted, lines: [...predicted.lines] } };
      // Пути картинок — в запись: отвеченный бриф показывает их там, где владелец их вставил.
      const seen = attached.length === 0 ? {} : { images: attached.map(({ n, path, name }) => ({ n, path, ...(name === undefined ? {} : { name }) })) };
      const written = await store.putAnswer(id, { answer, messageId, answeredAt: deps.now(), ...snapshot, ...seen });
      if (written.kind === "already_answered") return written;
      const lost = lostImages(answer, { uploaded: attached, failed }, locale);
      const parts = answerMessageParts(brief, answer, locale);
      // Утверждение несёт агенту то, что владелец сделал в прототипах своей группы и ещё не отправлял: его слова — в его часть реплики.
      const prototypes = outcomeKind(brief) === "approve" ? await groupPrototypes(brief) : [];
      // Переход снимает прогон вместе с его слиянием: открытый PR прежнего прогона назван в реплике, иначе он висит незамеченным.
      const pr = switched === undefined ? null : ((await deps.openPullRequest?.(brief.threadId).catch(() => null)) ?? null);
      const prLine = pr === null ? [] : [messages(locale).answer.openPullRequest(pr.number, pr.url)];
      const owner = [parts.owner, ...prototypeLines(prototypes.map(({ state }) => state), locale), ...prLine].join("\n");
      const prRule = pr === null ? "" : `\n${messages(locale).answer.openPullRequestAgent(pr.number)}`;
      // Служебное агенту: прогон, бюджет, Definition of Done, что делать с открытым PR, следующий шаг и пути вложений.
      const service = `${parts.agent}${prRule}${attachmentsLine(attached, lost, locale)}`.replace(/^\n/, "");
      const text = service === "" ? owner : `${owner}\n${service}`;
      const place = answer.place ?? "here";
      let handoffThreadId: string | undefined;
      try {
        if (place === "here") {
          // Компактация — первой и до конца: реплика, поставленная раньше, попала бы в срезанный контекст.
          // Владелец её попросил, поэтому она идёт и тогда, когда реплики агенту не будет.
          if (answer.compact === true) await bb.sdk.threads.compact({ threadId: brief.threadId });
          // Переход — до реплики: ход агента, который она начнёт, уже идёт по новому flow.
          if (switched !== undefined) await deps.switchFlow?.(brief.threadId, switched.id);
          // Модель и effort — треду сразу, даже без реплики; скорость едет только репликой.
          if (execution !== undefined) await bb.sdk.threads.update({ threadId: brief.threadId, model: execution.model, reasoningLevel: execution.reasoningLevel });
          // Реплика будит агента, поэтому уходит, только когда ему есть что
          // делать: прогресс берётся уже с этим ответом — закрытые и
          // вычеркнутые им этапы в счёт не идут. В новый тред ответ уезжает
          // всегда: там вся работа впереди.
          // После перехода у агента вся работа нового flow впереди.
          const record = switched === undefined ? ((await deps.progress?.get(brief.threadId).catch(() => null)) ?? null) : null;
          const ahead = record === null ? null : onAnswer(record, brief, answer, written.record.answeredAt);
          if (switched !== undefined || needsAgentReply(brief, answer, ahead, attached.length + lost.length)) {
            // Видна ли хуку служебная часть в тексте хода — неизвестно: своей отмечаются оба варианта.
            deps.ownSend?.(brief.threadId, text);
            deps.ownSend?.(brief.threadId, owner);
            // Ответ встаёт в ленту сообщением владельца — его слова и вложения, как он их отправил, — а служебное видит только агент.
            await bb.sdk.threads.send({
              threadId: brief.threadId,
              // Уточнение агента не держит: он работает дальше, и ответ должен дойти в идущем ходе, а не после него.
              mode: brief.kind === "clarify" ? "steer-if-active" : "queue-if-active",
              ...(execution === undefined ? {} : { model: execution.model, reasoningLevel: execution.reasoningLevel, ...(execution.serviceTier === undefined ? {} : { serviceTier: execution.serviceTier }) }),
              input: [
                { type: "text", text: owner, mentions: [] },
                ...attached.map(attachmentInput),
                ...(service === "" ? [] : [{ type: "text" as const, text: service, mentions: [], visibility: AGENT_ONLY }]),
              ],
            });
          }
        } else {
          // Ответ уезжает целиком в новый тред: исходный остаётся с отвеченным брифом и ссылкой на него.
          if (switched !== undefined) deps.handoffFlow?.(brief.threadId, switched.id);
          const created = await handoff(bb, { brief, place, ...(answer.route === undefined ? {} : { route: answer.route }), ...(execution === undefined ? {} : { execution }), text, attachments: attached, locale });
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
      // Выбор и комментарии прототипов ушли агенту: следующее утверждение их не повторит.
      await quietly(Promise.all(prototypes.map(({ url }) => store.updatePrototype(brief.threadId, url, (state) => markSent(state ?? EMPTY_PROTOTYPE)))));
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
      // Утверждённое Definition of Done и объём ждут брифа посреди работы — в этом треде и в новом, куда ушла работа.
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
      // Комментарий к утверждению сворачивает все виджеты от прошлого утверждения: утверждение судится по ним, а они вернулись агенту.
      // Указатель возврата встаёт на утверждение — доработанные виджеты возьмут выбор из группы.
      const verdict = demoVerdict(answer);
      const folded = foldsGroup(brief, verdict) ? ((await store.foldGroup(brief.threadId, id).catch(() => null)) ?? [id]) : [];
      if (folded.length > 0) await quietly(store.putThreadReturned(brief.threadId, id));
      (folded.length > 0 ? folded : [id]).forEach((member) => bb.realtime.publish(ANSWERED_CHANNEL, { id: member }));
      // Журнал — только для брифов: уточнение не решение. Он ложится на диск раньше события для Automations: Commit, который оно запускает,
      // иначе проходит мимо файла этого решения. Сбой или отсутствие настройки не отменяют ни ответа, ни реплики, уже ушедших выше.
      if (brief.kind === "brief") await deps.writeDecision?.({ brief, answer, decidedAt: written.record.answeredAt, locale }).catch(() => undefined);
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
      if (verdict !== "comment" && verdict !== "switch") emit("flow.brief-answered");
      if (brief.setup?.criteria !== undefined) emit("flow.criteria-approved");
      return { kind: "accepted" as const, record: { ...written.record, ...(handoffThreadId === undefined ? {} : { handoffThreadId }) } };
    },
  });

  async function rememberRoute(brief: DecisionBrief, route: DispatchRoute): Promise<void> {
    const thread = await bb.sdk.threads.get({ threadId: brief.threadId });
    await store.putRoute(thread.projectId, route);
  }

  bb.rpc.register(answerImagesRpcContract, {
    async answerImages({ id }) {
      const [brief, record] = [await store.getBrief(id), await store.getAnswer(id)];
      if (brief === null || record === null) return { kind: "not_found" as const };
      return { kind: "found" as const, images: await readAttachments(bb.sdk, { threadId: brief.threadId, images: record.images ?? [] }) };
    },
  });

  bb.rpc.register(prototypeRpcContract, {
    getPrototype: async ({ threadId, url }) => ({ state: await store.getPrototype(threadId, prototypeAddress(url)) }),
    savePrototype: async ({ threadId, url, edit }) => ({
      state: await store.updatePrototype(threadId, prototypeAddress(url), (stored) => mergeEdit(stored ?? EMPTY_PROTOTYPE, edit)),
    }),
  });

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

  // Ряд виджета: модель треда, каталог моделей доступных провайдеров и flow владельца с их моделью. Сбой — `null`: кнопки модели
  // и Flow тогда не рисуются, а остальной виджет работает как раньше.
  bb.rpc.register(widgetAgentRpcContract, {
    async widgetAgent({ threadId }) {
      try {
        const thread = await bb.sdk.threads.get({ threadId });
        if (isSideChat(thread)) return null;
        const own = await bb.sdk.providers.models({ providerId: thread.providerId });
        const options = await bb.sdk.threads.defaultExecutionOptions({ threadId });
        const current: Execution | null =
          options === null
            ? defaultExecutionOf(own, thread.providerId)
            : { providerId: thread.providerId, model: options.model, reasoningLevel: options.reasoningLevel, ...(options.serviceTier === "fast" ? { serviceTier: "fast" as const } : {}) };
        if (current === null) return null;
        const providers: WidgetAgent["providers"] = await Promise.all(
          own.providers
            .filter((provider) => provider.available)
            .map(async (provider) => ({
              id: provider.id,
              name: provider.displayName,
              models: providerModelsOf(provider.id === thread.providerId ? own : await bb.sdk.providers.models({ providerId: provider.id }), provider.id),
            })),
        );
        return { current, currentFlowId: deps.threadFlowId?.(threadId) ?? null, providers, flows: deps.widgetFlows?.() ?? [] };
      } catch {
        return null;
      }
    },
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
    // Окно треда в зоне предвыбора — «в этом треде» открывается и с компактацией.
    async getDispatchPlace({ threadId }) {
      // Журнал треда читается параллельно с проектом; сбой предвыбора ловится на своём обещании и место не трогает.
      const preselected = deps.compactPreselected?.(threadId).catch(() => false);
      const route = await bb.sdk.threads
        .get({ threadId })
        .then((thread) => store.getRoute(thread.projectId))
        // Проект неизвестен — виджет открывается на «в этом треде» без маршрута: это безопасное значение.
        .catch(() => null);
      const base = { place: "here" as const, ...((await preselected) === true ? { compact: true } : {}) };
      return route === null ? base : { ...base, route };
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
