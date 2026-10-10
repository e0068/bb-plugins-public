// Значок этапа в строке треда левой панели: ждущий владельца — ровный значок
// вида, идущая автоматизация или шаг Action — мерцающий значок этапа, упавшая
// автоматизация — ровный значок автоматизации в тоне ошибки. Пока идёт ход
// агента, колёсико хоста в строке треда с flow крутится логотипом провайдера.
// Контент-скрипт живёт без контекста треда, поэтому RPC зовётся обычным POST,
// язык берётся у браузера, а рисунок и мигание подменяются стилем-маской по
// подписи: в реестре хоста иконок видов нет.
import type { PluginAppBuilder, PluginContentScriptContext } from "@get-bb/plugin-sdk/app";
import { ArrangeIcon, CheckListIcon, CheckmarkBadge01Icon, MessageQuestionIcon, PlayIcon, PresentationBarChart01Icon, WorkflowCircle03Icon } from "@hugeicons/core-free-icons";

import { awaitingChanges } from "../core/awaiting";
import { glyphCss, type SpinnerLogo } from "../core/row-glyph-css";
import { resolveLocale } from "../lib/i18n";
import { messages } from "../lib/messages";
import type { BuiltinKind } from "../lib/stage-constants";
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

/** Иконка Hugeicons документом svg; у Выбора этапов — линия штрихом, как у пунктирной Workflow. */
const svgOf = (icon: BuiltinKind | RunningKind): string => {
  const parts = ICON_DATA[icon].map(([tag, attrs]) => {
    const own = Object.entries(attrs).filter(([name]) => name !== "key");
    const dashed = icon === "select" ? [["strokeDasharray", "2.5 2.5"] as const] : [];
    return `<${tag} ${[...own, ...dashed].map(([name, value]) => `${kebab(name)}="${String(value).replace(/currentColor/g, "black")}"`).join(" ")}/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">${parts.join("")}</svg>`;
};

type Glyph = { icon: BuiltinKind | RunningKind; label: string; tone: "default" | "error"; blink: boolean };

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

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;
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
      const style = document.createElement("style");
      style.dataset.flowRowGlyphs = "";
      const overrides = Object.values(glyphs).map((g) => ({ label: g.label, svg: svgOf(g.icon), blink: g.blink }));
      // Стиль переписывается, только когда набор логотипов сменился.
      let painted: string | null = null;
      const paint = (logos: readonly SpinnerLogo[]) => {
        const css = glyphCss(overrides, logos);
        if (css !== painted) style.textContent = painted = css;
      };
      paint([]);
      document.head.append(style);

      let shown = new Map<string, GlyphId>();
      let alive = true;
      const poll = async () => {
        const [awaiting, running, logos] = await Promise.all([
          post(context.pluginId, "awaitingThreads", isAwaiting),
          post(context.pluginId, "runningThreads", isRunning),
          post(context.pluginId, "agentLogos", isLogo),
        ]);
        if (!alive) return;
        if (logos !== null) paint(logos);
        // Сбой опроса оставляет значки как были: пропавший значок хуже устаревшего на такт.
        if (awaiting === null) return;
        // Ждущий владельца важнее идущего: сначала идущие, поверх — ждущие.
        const next = new Map<string, GlyphId>([
          ...(running ?? []).map((entry) => [entry.threadId, `running:${entry.icon}` as const] as const),
          ...awaiting.map((entry) => [entry.threadId, entry.kind] as const),
        ]);
        const { set, clear } = awaitingChanges(shown, next);
        clear.forEach((threadId) => setStatus(threadId, null));
        set.forEach(([threadId, id]) => {
          const glyph = glyphs[id];
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
