// RPC виджета. Виджет сам не пишет и не шлёт: запись ответа, реплика агенту
// и сигнал другим вкладкам идут отсюда, строго в этом порядке.
import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";

import { idleAfter, needsAgentReply } from "../core/agent-reply";
import { awaitingStageId, ownStageIcon } from "../core/awaiting";
import { answeredLines, answerMessageParts, openQuestions } from "../core/answer-message";
import { forecast, hasForecast, scopeOf } from "../core/budget";
import { settleClarifyAnswer, turnOf, type ThreadStatus } from "../core/clarify";
import { carryOf } from "../core/carry";
import { defaultExecutionOf, providerModelsOf } from "../core/flow-agent";
import { finalCriteria } from "../core/option-criteria";
import { demoVerdict, isReport, outcomeKind } from "../core/outcome";
import { routeAllowed } from "../core/places";
import { onAnswer } from "../core/progress";
import { EMPTY_PROTOTYPE, markSent, mergeEdit, prototypeAddress, prototypeLines } from "../core/prototype";
import type { Locale } from "../lib/i18n";
import { messages } from "../lib/messages";
import { sendFailureOf } from "../core/send-failure";
import { isSideChat } from "../core/side-chat";
import { stageItems } from "../core/stages";
import { checklistOf, checklistRule } from "../core/checklist";
import { recommendedAnswer } from "../core/settle";
import { answerImagesRpcContract, approvalGroupRpcContract, awaitingRpcContract, briefDraftRpcContract, decisionsRpcContract, dispatchRpcContract, filesRpcContract, prototypeRpcContract, turnRpcContract, widgetAgentRpcContract, type AgentTurn, type DecisionAnswer, type DecisionBrief, type DispatchRoute, type Execution, type GroupAnswer, type WidgetAgent, type WorkStage } from "../shared/contract";
import { attachmentInput, attachmentsLine, lostImages, readAttachments, referencedImages, uploadAttachments } from "./attachments";
import { handoff } from "./handoff";
import type { ProgressStore } from "./progress";
import type { DecisionStore } from "./store";
import type { FlowTrigger } from "./automations";

/** Виджет группы Утверждения: бриф с ответом из черновика или Демонстрация со своим комментарием. */
type Member = { member: DecisionBrief; answer?: DecisionAnswer; note?: string };

export const ANSWERED_CHANNEL = "decisions:answered";
/** Ход агента в треде сменился: `{ threadId, turn }` — открытое уточнение показывает или прячет сжатие. */
export const TURN_CHANNEL = "decisions:turn";

/** Часть реплики, которую bb отдаёт агенту, но не рисует в ленте треда. */
const AGENT_ONLY = "agent-only" as const;

/** Обработчики RPC брифов, но сбой ответа на бриф пишется в журнал, прежде чем уйти виджету. */
const warnOnAnswerFailure = (warn: ((message: string) => void) | undefined, handlers: PluginRpcHandlers<typeof decisionsRpcContract>): PluginRpcHandlers<typeof decisionsRpcContract> => ({
  ...handlers,
  answerBrief: async (input) => {
    try {
      return await handlers.answerBrief(input);
    } catch (error) {
      warn?.(`answerBrief ${input.id}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  },
});

export const registerApi = (
  bb: Pick<BbPluginApi, "events" | "rpc" | "realtime" | "sdk">,
  store: DecisionStore,
  deps: {
    now: () => string;
    /** Этапы flow треда: по ним ждущая автоматизация берёт свою иконку для строки треда; не задано — значок по виду. */
    stages?: (threadId: string) => readonly WorkStage[];
    /** Журнал Flow; не задан — сбои не пишутся. */
    warn?: (message: string) => void;
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
): { recordDecided: (brief: DecisionBrief) => Promise<void> } => {
  /** Ход агента в треде; bb не ответил — ход считается идущим: лишнее сжатие хуже пропущенного. */
  const agentTurnOf = (threadId: string): Promise<AgentTurn> =>
    bb.sdk.threads.get({ threadId }).then(
      (thread) => turnOf(thread.status),
      () => "running" as const,
    );

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


  /** Виджеты группы Утверждения, ещё копящие ответ до него: с меткой `approval`, без ответа и не ушедшие с прошлым, — по порядку группы. */
  const pendingMembers = async (approvalId: string): Promise<DecisionBrief[]> => {
    const ids = (await store.getApprovalGroup(approvalId)).filter((member) => member !== approvalId);
    const briefs = await Promise.all(
      ids.map(async (id) => ((await store.getAnswer(id)) === null && (await store.getSentWith(id)) === null ? await store.getBrief(id) : null)),
    );
    return briefs.filter((brief): brief is DecisionBrief => brief !== null && brief.settle === "approval");
  };

  /**
   * Ответы виджетов группы из присланного: бриф — ответ из черновика, Демонстрация — комментарий. Виджет, которого клиент не прислал, —
   * отказ, а не молчаливая потеря: его правки иначе не дошли бы до агента и не попали бы и в следующее Утверждение.
   */
  const groupOf = async (approval: DecisionBrief, sent: readonly GroupAnswer[]): Promise<Member[]> => {
    const pending = await pendingMembers(approval.id);
    const missing = pending.filter((member) => !sent.some((e) => e.id === member.id) || (member.outcome === undefined && sent.find((e) => e.id === member.id)?.answer?.briefId !== member.id));
    if (missing.length > 0) throw new Error(`the approval carries no answers of its group widgets ${missing.map((member) => member.id).join(", ")}: reload the approval and send it again`);
    return pending.map((member) => {
      const entry = sent.find((e) => e.id === member.id)!;
      const answer = member.outcome === undefined ? entry.answer : undefined;
      return { member, ...(answer === undefined ? {} : { answer }), ...(entry.note === undefined ? {} : { note: entry.note }) };
    });
  };

  /** Части реплики от группы: владельцу — ответы виджетов и комментарии к ним, агенту — служебное ответов. */
  const memberParts = (members: readonly Member[], locale: Locale | undefined): { owner: string[]; agent: string[] } => {
    const m = messages(locale).answer;
    const parts = members.map(({ member, answer, note }) => {
      const comment = answer?.note ?? note;
      const comments = comment === undefined || comment.trim() === "" ? [] : [m.commentOn(member.title, comment.trim())];
      if (answer === undefined) return { owner: comments, agent: [] };
      // Комментарий виджета уходит пунктом чек-листа, а не строкой «ко всем вопросам».
      const { note: _, ...plain } = answer;
      const own = answerMessageParts(member, plain, locale);
      return { owner: [own.owner, ...comments], agent: own.agent === "" ? [] : [own.agent] };
    });
    return { owner: parts.flatMap((p) => p.owner), agent: parts.flatMap((p) => p.agent) };
  };

  /** Утверждённое Definition of Done и объём ждут брифа посреди работы — в треде ответа и в новом, куда ушла работа. Бриф без своих пунктов дописывает пункты выбранного варианта к уже утверждённым. */
  const keepCriteria = async (brief: DecisionBrief, answer: DecisionAnswer, threadIds: readonly string[], locale?: Locale) => {
    // Ответы на Вопросы — для строки этапа в баннере: бриф без вопросов прежние не стирает.
    const lines = brief.questions.length === 0 ? [] : answeredLines(brief, answer, locale);
    const answered = finalCriteria(brief, answer);
    const approved = brief.setup?.criteria === undefined ? [...new Set([...(brief.approved ?? []), ...answered])] : answered;
    const scope = scopeOf(brief, answer);
    for (const threadId of threadIds) {
      if (lines.length > 0) await store.putThreadAnswers(threadId, lines).catch(() => undefined);
      if (approved.length > 0) await store.putThreadCriteria(threadId, approved).catch(() => undefined);
      if (scope !== undefined) await store.putThreadScope(threadId, scope).catch(() => undefined);
    }
  };

  /** Ответ виджета группы ложится, как ответ его собственной кнопкой «в этом треде»: запись, запуск, перенос, пункты, прогон, журнал. */
  const recordMember = async (member: DecisionBrief, answer: DecisionAnswer, messageId: string, locale: Locale | undefined, threadIds: readonly string[]) => {
    const at = deps.now();
    const predicted = hasForecast(member) ? forecast(member, answer, locale) : null;
    const written = await store.putAnswer(member.id, { answer, messageId, answeredAt: at, ...(predicted === null ? {} : { forecast: { ...predicted, lines: [...predicted.lines] } }) });
    if (written.kind === "already_answered") return;
    if (launchesWork(member, answer)) await store.markLaunched(member.threadId);
    await store.putThreadCarry(member.threadId, carryOf(member, answer));
    await keepCriteria(member, answer, threadIds, locale);
    const planned = predicted === null ? undefined : { minutes: predicted.minutes, target: predicted.target, max: predicted.max };
    await deps.progress?.recordAnswer(member, answer, at, planned).catch(() => undefined);
    await store.clearAwaiting(member.threadId, member.id);
    await store.dropDraft(member.id);
    await deps.writeDecision?.({ brief: member, answer, decidedAt: at, locale }).catch(() => undefined);
    if (member.setup?.criteria !== undefined) deps.emit?.("flow.criteria-approved", member.threadId);
  };

  bb.rpc.register(approvalGroupRpcContract, {
    approvalMembers: async ({ id }) => ({ members: await pendingMembers(id) }),
  });

  // Ответ, который не ушёл, пишется в журнал Flow: виджет показывает владельцу только причину.
  bb.rpc.register(decisionsRpcContract, warnOnAnswerFailure(deps.warn, {
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
      // Прогон читается только для неотвеченного утверждения: признак нужен ячейке «Исполнять», которой у ответа нет.
      const quiet = answer === null && brief.outcome !== undefined && idleAfter(brief, (await deps.progress?.get(brief.threadId).catch(() => null)) ?? null);
      // Чек-лист по комментариям к виджетам — карточкой под ответом Утверждения, которое его завело.
      // Работа ушла в новый тред — чек-лист ведёт он.
      const checklist = answer !== null && outcomeKind(brief) === "approve" ? await store.getChecklist(answer.handoffThreadId ?? brief.threadId) : null;
      const items = checklist?.approvalId === id ? checklist.items : null;
      const sentWith = answer === null ? await store.getSentWith(id) : null;
      return {
        kind: "found" as const,
        brief,
        answer,
        ...(fold === null ? {} : { fold }),
        ...(draft === null ? {} : { draft }),
        ...(resolved ? { resolved: true as const } : {}),
        ...(quiet ? { idleAfter: true as const } : {}),
        ...(items === null ? {} : { checklist: items }),
        ...(sentWith === null ? {} : { sentWith }),
      };
    },

    async answerBrief({ id, answer: sent, messageId, images = [], locale, group = [] }) {
      const brief = await store.getBrief(id);
      if (brief === null || sent.briefId !== id) return { kind: "not_found" as const };
      // Ход треда спрашивается, только когда от него что-то зависит: уточнение с выбранным сжатием.
      const turn = brief.kind === "clarify" && sent.compact === true ? await agentTurnOf(brief.threadId) : "running";
      const answer = settleClarifyAnswer(brief, sent, turn);
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
      // Утверждение без комментария отвечает и за виджеты своей группы, копившие ответ черновиком: их ответы и комментарии едут с ним.
      // С комментарием группа сворачивается, как раньше, и черновики остаются черновиками — агент покажет виджеты заново.
      const members = outcomeKind(brief) === "approve" && demoVerdict(answer) === "continue" ? await groupOf(brief, group) : [];
      const membersOpen = members.flatMap((m) => (m.answer === undefined ? [] : openQuestions(m.member, m.answer)));
      if (membersOpen.length > 0) return { kind: "incomplete" as const, questionIds: membersOpen };
      const checklist = checklistOf(members.map((m) => ({ where: m.member.title, text: m.answer?.note ?? m.note })));

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
      const grouped = memberParts(members, locale);
      const owner = [parts.owner, ...grouped.owner, ...prototypeLines(prototypes.map(({ state }) => state), locale), ...prLine].join("\n");
      const prRule = pr === null ? "" : `\n${messages(locale).answer.openPullRequestAgent(pr.number)}`;
      // Служебное агенту: прогон, бюджет, Definition of Done, что делать с открытым PR, следующий шаг и пути вложений.
      const groupRule = [...grouped.agent, ...(checklist.length === 0 ? [] : [checklistRule(checklist)])].map((line) => `\n${line}`).join("");
      const service = `${parts.agent}${groupRule}${prRule}${attachmentsLine(attached, lost, locale)}`.replace(/^\n/, "");
      const text = service === "" ? owner : `${owner}\n${service}`;
      const place = answer.place ?? "here";
      // Чек-лист — до реплики: разбуженный ею агент сразу зовёт flow_checklist и flow_stage. У передачи он ложится в новый тред после её создания.
      const checklistHere = checklist.length > 0 && place === "here";
      // Прежний чек-лист помнится: сорвалась реплика — открытые пункты прошлого Утверждения возвращаются.
      const previousChecklist = checklistHere ? await store.getChecklist(brief.threadId) : null;
      if (checklistHere) await store.putChecklist(brief.threadId, { approvalId: id, items: checklist });
      let handoffThreadId: string | undefined;
      // Реплика агенту ушла в bb: её таймаут не говорит, дошла ли она.
      let delivering = false;
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
          if (switched !== undefined || grouped.owner.length > 0 || grouped.agent.length > 0 || needsAgentReply(brief, answer, ahead, attached.length + lost.length)) {
            // Видна ли хуку служебная часть в тексте хода — неизвестно: своей отмечаются оба варианта.
            deps.ownSend?.(brief.threadId, text);
            deps.ownSend?.(brief.threadId, owner);
            // Ответ встаёт в ленту сообщением владельца — его слова и вложения, как он их отправил, — а служебное видит только агент.
            delivering = true;
            await bb.sdk.threads.send({
              threadId: brief.threadId,
              // Уточнение агента не держит: он работает дальше, и ответ должен дойти в идущем ходе, а не после него.
              // Уточнение со сжатием пришло после хода: вливаться не во что, и ответ не должен попасть в ход самого сжатия.
              mode: brief.kind === "clarify" && answer.compact !== true ? "steer-if-active" : "queue-if-active",
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
          // Создание треда не подтвердилось — ответ остаётся принятым: повтор открыл бы второй тред.
          if (created.kind === "unconfirmed") deps.warn?.(`answerBrief ${id}: bb did not confirm the new thread, the answer is kept (${created.error})`);
          else handoffThreadId = created.threadId;
        }
      } catch (cause) {
        // Таймаут самой реплики — исход неизвестен: она могла дойти. Ответ остаётся принятым, иначе повтор из виджета
        // доставил бы его агенту второй раз. Таймаут шагов до реплики — сжатия, смены flow — снимает ответ.
        if (delivering && sendFailureOf(cause).kind === "timeout") deps.warn?.(`answerBrief ${id}: bb did not confirm delivery, the answer is kept (${cause instanceof Error ? cause.message : String(cause)})`);
        else {
          // Передача не состоялась — выбранный flow не должен достаться следующей.
          if (switched !== undefined) deps.handoffFlow?.(brief.threadId, null);
          // Реплика не ушла — агент ответа не узнает. Запись снимается, чтобы
          // повторная отправка из виджета дошла, а не упёрлась в already_answered.
          await store.dropAnswer(id);
          if (checklistHere) await (previousChecklist === null ? store.dropChecklist(brief.threadId) : store.putChecklist(brief.threadId, previousChecklist)).catch(() => undefined);
          throw cause;
        }
      }
      // Дальше реплика уже ушла: ни один сбой ниже не снимает ответ — повтор создал бы второй тред.
      // Худшее при сбое отметки — запущенный тред ещё примет этапы; это мягче дубля треда.
      const quietly = (work: Promise<unknown>) => work.catch(() => undefined);
      // Ответы группы записываются, когда реплика уже ушла: каждый виджет — как отвеченный своей кнопкой, Демонстрация — без ответа, она отчёт.
      // Пункты Definition of Done и ответы едут и в новый тред, куда ушла работа, как у брифа, отвеченного своей кнопкой.
      const workThreads = [brief.threadId, ...(handoffThreadId === undefined ? [] : [handoffThreadId])];
      for (const m of members) {
        if (m.answer !== undefined) await quietly(recordMember(m.member, m.answer, messageId, locale, workThreads));
        else await quietly(Promise.all([store.dropDraft(m.member.id), store.markSentWith(m.member.id, id)]));
        bb.realtime.publish(ANSWERED_CHANNEL, { id: m.member.id });
      }
      if (checklist.length > 0 && handoffThreadId !== undefined) await quietly(store.putChecklist(handoffThreadId, { approvalId: id, items: checklist }));
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
      if (brief.kind === "brief" && brief.outcome === undefined) await keepCriteria(brief, answer, [brief.threadId, ...(handoffThreadId === undefined ? [] : [handoffThreadId])], locale);
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
  }));

  /**
   * Бриф, по которому агент решил сам — Утверждения впереди нет: его рекомендации ложатся, как ответ кнопкой, — пункты, ответы
   * для баннера, перенос выбора, журнал и события. Прогон не трогается: снять этап по предложению агента может только владелец.
   */
  async function recordDecided(brief: DecisionBrief): Promise<void> {
    const answer = recommendedAnswer(brief);
    const at = deps.now();
    await store.putThreadCarry(brief.threadId, carryOf(brief, answer)).catch(() => undefined);
    await keepCriteria(brief, answer, [brief.threadId]);
    await deps.writeDecision?.({ brief, answer, decidedAt: at }).catch(() => undefined);
    deps.emit?.("flow.brief-answered", brief.threadId);
    if (brief.setup?.criteria !== undefined) deps.emit?.("flow.criteria-approved", brief.threadId);
  }

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
    awaitingThreads: () =>
      store.listAwaiting().then((list) =>
        list.map((entry) => {
          const stageId = awaitingStageId(entry);
          const own = stageId === null ? undefined : ownStageIcon(deps.stages?.(entry.threadId).find((stage) => stage.id === stageId));
          return { threadId: entry.threadId, kind: entry.kind, ...(own === undefined ? {} : { stage: own }) };
        }),
      ),
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

  bb.rpc.register(turnRpcContract, {
    async agentTurn({ threadId }) {
      return { turn: await agentTurnOf(threadId) };
    },
  });
  // Смена хода — открытым уточнениям сразу: сжатие появляется и пропадает без опроса.
  const publishTurn = ({ thread }: { thread: { id: string; status: ThreadStatus } }) => void bb.realtime.publish(TURN_CHANNEL, { threadId: thread.id, turn: turnOf(thread.status) });
  bb.events.on("thread.active", publishTurn);
  bb.events.on("thread.idle", publishTurn);
  bb.events.on("thread.failed", publishTurn);

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

  return { recordDecided };
};
