// Значок этапа в строке треда левой панели: ждущий владельца — ровный значок
// вида, идущая автоматизация или шаг Action — мерцающий значок этапа, упавшая
// автоматизация — ровный значок автоматизации в тоне ошибки. Этап со своей
// иконкой рисуется ею, а подпись называет этап. Пока идёт ход
// агента, колёсико хоста в строке треда с flow крутится логотипом провайдера.
// Контент-скрипт живёт без контекста треда, поэтому RPC зовётся обычным POST,
// язык берётся у браузера, а рисунок и мигание подменяются стилем-маской по
// подписи: в реестре хоста иконок видов нет.
import type { PluginAppBuilder, PluginContentScriptContext } from "@get-bb/plugin-sdk/app";
import { ArrangeIcon, CheckListIcon, CheckmarkBadge01Icon, MessageQuestionIcon, PlayIcon, PresentationBarChart01Icon, WorkflowCircle03Icon } from "@hugeicons/core-free-icons";

import { STAGE_ICONS } from "../components/ui/stage-icon-catalog";
import { awaitingChanges } from "../core/awaiting";
import { queuedThreadIds } from "../core/queued-threads";
import { glyphCss, type SpinnerLogo } from "../core/row-glyph-css";
import { resolveLocale } from "../lib/i18n";
import { messages } from "../lib/messages";
import type { BuiltinKind } from "../lib/stage-constants";
import type { RowStage } from "../shared/contract";
import { systemLanguages } from "./locale-context";

const POLL_MS = 10_000;

type SetStatus = NonNullable<PluginContentScriptContext["experimental_setThreadRowStatus"]>;
type IconData = ReadonlyArray<readonly [string, Readonly<Record<string, string | number>>]>;

type AwaitingKind = BuiltinKind | "automation" | "action";
/** Идёт сама автоматизация или нажатый шаг Action; этап навыка идёт ходом агента, а ход виден логотипом. */
type RunningKind = "automation" | "action";
/** Значок строки: ждущий вид или идущий этап. */
type GlyphId = AwaitingKind | `running:${RunningKind}`;

const RUNNING: readonly RunningKind[] = ["automation", "action"];
const AWAITING: readonly AwaitingKind[] = ["questions", "criteria", "select", "demo", "approve", "automation", "action"];

const ICON_DATA: Record<BuiltinKind | RunningKind, IconData> = {
  action: PlayIcon as unknown as IconData,
  questions: MessageQuestionIcon as unknown as IconData,
  criteria: CheckListIcon as unknown as IconData,
  select: WorkflowCircle03Icon as unknown as IconData,
  demo: PresentationBarChart01Icon as unknown as IconData,
  approve: CheckmarkBadge01Icon as unknown as IconData,
  automation: ArrangeIcon as unknown as IconData,
};

/** Имя иконки хоста — запасной рисунок, если стиль перестанет совпадать с разметкой. */
const FALLBACK_ICON: Record<BuiltinKind | RunningKind, string> = { action: "Play", questions: "MessageQuestion", criteria: "ListTodo", select: "Workflow", demo: "Presentation", approve: "BadgeCheck", automation: "Workflow" };

const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Рисунок Hugeicons документом svg; `dashed` — линия штрихом, как у пунктирной Workflow Выбора этапов. */
const svgOf = (drawing: IconData, dashed: boolean): string => {
  const parts = drawing.map(([tag, attrs]) => {
    const own = Object.entries(attrs).filter(([name]) => name !== "key");
    const dash = dashed ? [["strokeDasharray", "2.5 2.5"] as const] : [];
    return `<${tag} ${[...own, ...dash].map(([name, value]) => `${kebab(name)}="${String(value).replace(/currentColor/g, "black")}"`).join(" ")}/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">${parts.join("")}</svg>`;
};

type Glyph = { icon: BuiltinKind | RunningKind; label: string; tone: "default" | "error"; blink: boolean };

/** Значок строки: вид и, у этапа со своей иконкой, рисунок из подборки с подписью этапа. */
type Shown = { glyph: Glyph; drawing: IconData | undefined };

/** Ключ значка: смена вида, иконки или названия этапа перерисовывает строку. */
const keyOf = (id: GlyphId, stage: RowStage | undefined): string => (stage === undefined ? id : `${id}|${stage.icon}|${stage.name}`);

const post = async <T>(pluginId: string, method: string, valid: (x: unknown) => x is T): Promise<T[] | null> => {
  try {
    const res = await fetch(`/api/v1/plugins/${pluginId}/rpc/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok?: boolean; result?: unknown[] };
    return body.ok === true && Array.isArray(body.result) ? body.result.filter(valid) : null;
  } catch {
    return null;
  }
};

/**
 * Треды с сообщением в очереди хоста — ждущим отправки или не отправившимся. Это внутренний REST хоста, а не SDK:
 * список без архивных (с ними ответ в мегабайты) лёгкий. Сбой запроса — `null`: опрос держит прошлое множество,
 * иначе один неудачный такт вернул бы значок на тред, у которого хост рисует свои часики.
 */
const fetchQueuedThreadIds = async (): Promise<ReadonlySet<string> | null> => {
  try {
    const res = await fetch("/api/v1/threads?archived=false");
    return res.ok ? queuedThreadIds(await res.json()) : null;
  } catch {
    return null;
  }
};

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;
const isRowStage = (x: unknown): x is RowStage => isRecord(x) && typeof x.name === "string" && typeof x.icon === "string";
/** Своя иконка этапа в ответе; нет её или она не той формы — `undefined`, значок по виду. */
const stageOf = (x: Record<string, unknown>): RowStage | undefined => (isRowStage(x.stage) ? x.stage : undefined);
const isAwaiting = (x: unknown): x is { threadId: string; kind: AwaitingKind } => isRecord(x) && typeof x.threadId === "string" && AWAITING.includes(x.kind as AwaitingKind);
const isRunning = (x: unknown): x is { threadId: string; icon: RunningKind } => isRecord(x) && typeof x.threadId === "string" && RUNNING.includes(x.icon as RunningKind);
const isLogo = (x: unknown): x is SpinnerLogo => isRecord(x) && typeof x.threadId === "string" && typeof x.logoUrl === "string";

export function registerAwaitingStatus(app: PluginAppBuilder): void {
  app.contentScripts.register({
    id: "flow-awaiting",
    mount(context) {
      const setStatus: SetStatus | undefined = context.experimental_setThreadRowStatus;
      if (setStatus === undefined) return;
      const t = messages(resolveLocale(undefined, systemLanguages()));
      const glyphs: Record<GlyphId, Glyph> = {
        questions: { icon: "questions", label: `Flow — ${t.stages.questions}`, tone: "default", blink: false },
        criteria: { icon: "criteria", label: `Flow — ${t.stages.criteria}`, tone: "default", blink: false },
        select: { icon: "select", label: `Flow — ${t.stages.select}`, tone: "default", blink: false },
        demo: { icon: "demo", label: `Flow — ${t.stages.demo}`, tone: "default", blink: false },
        approve: { icon: "approve", label: `Flow — ${t.stages.approve}`, tone: "default", blink: false },
        automation: { icon: "automation", label: `Flow — ${t.rowStatus.automationFailed}`, tone: "error", blink: false },
        action: { icon: "action", label: `Flow — ${t.stages.action}`, tone: "default", blink: false },
        "running:action": { icon: "action", label: `Flow — ${t.rowStatus.running(t.stages.action)}`, tone: "default", blink: true },
        "running:automation": { icon: "automation", label: `Flow — ${t.rowStatus.running(t.rowStatus.automation)}`, tone: "default", blink: true },
      };
      /** Подпись значка этапа со своей иконкой: идущий — «идёт», упавшая автоматизация — «остановилась», ждущий нажатия — название. */
      const ownLabel = (id: GlyphId, name: string): string =>
        `Flow — ${id === "automation" ? t.rowStatus.failed(name) : id.startsWith("running:") ? t.rowStatus.running(name) : name}`;
      /** Значок вида, а у этапа с иконкой из подборки — её рисунок под подписью этапа; иконка вне подборки — значок вида. */
      const shownOf = (id: GlyphId, stage: RowStage | undefined): Shown => {
        const drawing = stage === undefined ? undefined : (STAGE_ICONS.get(stage.icon) as unknown as IconData | undefined);
        return drawing === undefined || stage === undefined ? { glyph: glyphs[id], drawing: undefined } : { glyph: { ...glyphs[id], label: ownLabel(id, stage.name) }, drawing };
      };
      const style = document.createElement("style");
      style.dataset.flowRowGlyphs = "";
      const overrides = Object.values(glyphs).map((g) => ({ label: g.label, svg: svgOf(ICON_DATA[g.icon], g.icon === "select"), blink: g.blink }));
      // Стиль переписывается, только когда сменился набор логотипов или своих иконок в строках.
      let painted: string | null = null;
      let logos: readonly SpinnerLogo[] = [];
      let shown = new Map<string, string>();
      // Очередь хоста с последнего удачного запроса; до него — пустая, значки как до очереди.
      let queued: ReadonlySet<string> = new Set();
      let own: readonly Shown[] = [];
      const paint = () => {
        const owned = own.map(({ glyph, drawing }) => ({ label: glyph.label, svg: svgOf(drawing ?? ICON_DATA[glyph.icon], false), blink: glyph.blink }));
        const css = glyphCss([...overrides, ...owned], logos);
        if (css !== painted) style.textContent = painted = css;
      };
      paint();
      document.head.append(style);

      let alive = true;
      const poll = async () => {
        const [awaiting, running, fetched, fetchedQueued] = await Promise.all([
          post(context.pluginId, "awaitingThreads", isAwaiting),
          post(context.pluginId, "runningThreads", isRunning),
          post(context.pluginId, "agentLogos", isLogo),
          fetchQueuedThreadIds(),
        ]);
        if (!alive) return;
        if (fetched !== null) logos = fetched;
        if (fetchedQueued !== null) queued = fetchedQueued;
        // Сбой опроса оставляет значки как были: пропавший значок хуже устаревшего на такт.
        if (awaiting === null) {
          paint();
          return;
        }
        // Ждущий владельца важнее идущего: сначала идущие, поверх — ждущие. Тред с сообщением в очереди хоста значка
        // не получает: у строки свои часики или крестик, и `awaitingChanges` сам снимает значок, поставленный раньше.
        const entries = new Map<string, { id: GlyphId; stage: RowStage | undefined }>(
          [
            ...(running ?? []).map((entry) => [entry.threadId, { id: `running:${entry.icon}` as const, stage: stageOf(entry) }] as const),
            ...awaiting.map((entry) => [entry.threadId, { id: entry.kind, stage: stageOf(entry) }] as const),
          ].filter(([threadId]) => !queued.has(threadId)),
        );
        const next = new Map([...entries].map(([threadId, { id, stage }]) => [threadId, keyOf(id, stage)] as const));
        const looks = new Map([...entries].map(([threadId, { id, stage }]) => [threadId, shownOf(id, stage)] as const));
        own = [...looks.values()].filter((look) => look.drawing !== undefined);
        paint();
        const { set, clear } = awaitingChanges(shown, next);
        clear.forEach((threadId) => setStatus(threadId, null));
        set.forEach(([threadId]) => {
          const { glyph } = looks.get(threadId)!;
          setStatus(threadId, { icon: FALLBACK_ICON[glyph.icon], label: glyph.label, tone: glyph.tone });
        });
        shown = next;
      };
      void poll();
      const timer = setInterval(() => void poll(), POLL_MS);
      return () => {
        alive = false;
        clearInterval(timer);
        style.remove();
        shown.forEach((_id, threadId) => setStatus(threadId, null));
      };
    },
  });
}
