// Значок этапа в строке треда левой панели: ждущий владельца — ровный значок
// вида, идущий — мерцающий значок этапа (у самого агента — логотип провайдера,
// у субагента — логотип в квадрате), упавшая автоматизация — ровная молния
// в тоне ошибки. Контент-скрипт живёт без контекста треда, поэтому RPC зовётся
// обычным POST, язык берётся у браузера, а рисунок и мигание подменяются
// стилем-маской по подписи: в реестре хоста иконок видов нет.
import type { PluginAppBuilder, PluginContentScriptContext } from "@get-bb/plugin-sdk/app";
import { BotIcon, CheckListIcon, DiamondIcon, MessageQuestionIcon, PresentationBarChart01Icon, WorkflowCircle03Icon, ZapIcon } from "@hugeicons/core-free-icons";

import { awaitingChanges } from "../core/awaiting";
import { glyphCss } from "../core/row-glyph-css";
import { resolveLocale } from "../lib/i18n";
import { messages } from "../lib/messages";
import type { BuiltinKind } from "../lib/stage-constants";
import type { RunningIcon, RunningThread } from "../shared/contract";
import { systemLanguages } from "./locale-context";

const POLL_MS = 10_000;

type SetStatus = NonNullable<PluginContentScriptContext["experimental_setThreadRowStatus"]>;
type IconData = ReadonlyArray<readonly [string, Readonly<Record<string, string | number>>]>;

type AwaitingKind = BuiltinKind | "automation";
type Provider = NonNullable<RunningThread["provider"]>;
/** Значок строки: ждущий вид, идущий этап или идущий этап с логотипом провайдера. */
type GlyphId = AwaitingKind | `running:${RunningIcon}` | `running:${RunningIcon}:${string}`;

const RUNNING_ICONS: readonly RunningIcon[] = ["automation", "self", "agent", "workflow"];
const AWAITING: readonly AwaitingKind[] = ["questions", "criteria", "select", "demo", "automation"];

const ICON_DATA: Record<BuiltinKind | RunningIcon, IconData> = {
  questions: MessageQuestionIcon as unknown as IconData,
  criteria: CheckListIcon as unknown as IconData,
  select: WorkflowCircle03Icon as unknown as IconData,
  demo: PresentationBarChart01Icon as unknown as IconData,
  automation: ZapIcon as unknown as IconData,
  self: DiamondIcon as unknown as IconData,
  agent: BotIcon as unknown as IconData,
  workflow: WorkflowCircle03Icon as unknown as IconData,
};

/** Имя иконки хоста — запасной рисунок, если стиль перестанет совпадать с разметкой. */
const FALLBACK_ICON: Record<BuiltinKind | RunningIcon, string> = { questions: "MessageQuestion", criteria: "ListTodo", select: "Workflow", demo: "Presentation", automation: "Zap", self: "Diamond", agent: "Bot", workflow: "Workflow" };

const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Иконка Hugeicons документом svg; у Выбора этапов — линия штрихом, как у пунктирной Workflow. */
const svgOf = (icon: BuiltinKind | RunningIcon): string => {
  const parts = ICON_DATA[icon].map(([tag, attrs]) => {
    const own = Object.entries(attrs).filter(([name]) => name !== "key");
    const dashed = icon === "select" ? [["strokeDasharray", "2.5 2.5"] as const] : [];
    return `<${tag} ${[...own, ...dashed].map(([name, value]) => `${kebab(name)}="${String(value).replace(/currentColor/g, "black")}"`).join(" ")}/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">${parts.join("")}</svg>`;
};

type Glyph = { icon: BuiltinKind | RunningIcon; label: string; tone: "default" | "error"; blink: boolean; logo?: { url: string; framed: boolean } };

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
const isProvider = (x: unknown): x is Provider => isRecord(x) && typeof x.name === "string" && typeof x.logoUrl === "string";
const isRunning = (x: unknown): x is RunningThread =>
  isRecord(x) && typeof x.threadId === "string" && RUNNING_ICONS.includes(x.icon as RunningIcon) && (x.provider === undefined || isProvider(x.provider));

export function registerAwaitingStatus(app: PluginAppBuilder): void {
  app.contentScripts.register({
    id: "flow-awaiting",
    mount(context) {
      const setStatus: SetStatus | undefined = context.experimental_setThreadRowStatus;
      if (setStatus === undefined) return;
      const t = messages(resolveLocale(undefined, systemLanguages()));
      const glyphs: Record<`running:${RunningIcon}` | AwaitingKind, Glyph> = {
        questions: { icon: "questions", label: `Flow — ${t.stages.questions}`, tone: "default", blink: false },
        criteria: { icon: "criteria", label: `Flow — ${t.stages.criteria}`, tone: "default", blink: false },
        select: { icon: "select", label: `Flow — ${t.stages.select}`, tone: "default", blink: false },
        demo: { icon: "demo", label: `Flow — ${t.stages.demo}`, tone: "default", blink: false },
        automation: { icon: "automation", label: `Flow — ${t.rowStatus.automationFailed}`, tone: "error", blink: false },
        "running:automation": { icon: "automation", label: `Flow — ${t.rowStatus.running(t.rowStatus.automation)}`, tone: "default", blink: true },
        "running:self": { icon: "self", label: `Flow — ${t.rowStatus.running(t.rowStatus.self)}`, tone: "default", blink: true },
        "running:agent": { icon: "agent", label: `Flow — ${t.rowStatus.running(t.rowStatus.agent)}`, tone: "default", blink: true },
        "running:workflow": { icon: "workflow", label: `Flow — ${t.rowStatus.running(t.rowStatus.workflow)}`, tone: "default", blink: true },
      };
      const style = document.createElement("style");
      style.dataset.flowRowGlyphs = "";
      // Значки с логотипом провайдера — по одному на провайдера и исполнителя, добавляются при первой встрече.
      const withLogo = new Map<string, Glyph>();
      const glyphOf = (id: GlyphId): Glyph => withLogo.get(id) ?? glyphs[id as keyof typeof glyphs];
      const paint = () => {
        style.textContent = glyphCss([...Object.values(glyphs), ...withLogo.values()].map((g) => ({ label: g.label, svg: svgOf(g.icon), blink: g.blink, ...(g.logo === undefined ? {} : { logo: g.logo }) })));
      };
      paint();
      document.head.append(style);
      /** Значок идущего этапа; логотип провайдера — своя подпись и своё правило стиля, добавленное при первой встрече. */
      const runningGlyph = (icon: RunningIcon, provider: Provider | undefined): GlyphId => {
        const plain: GlyphId = `running:${icon}`;
        if (provider === undefined) return plain;
        const id: GlyphId = `${plain}:${provider.logoUrl}`;
        if (!withLogo.has(id)) {
          withLogo.set(id, { ...glyphs[plain], label: `Flow — ${t.rowStatus.running(`${t.rowStatus[icon]} · ${provider.name}`)}`, logo: { url: provider.logoUrl, framed: icon === "agent" } });
          paint();
        }
        return id;
      };

      let shown = new Map<string, GlyphId>();
      let alive = true;
      const poll = async () => {
        const [awaiting, running] = await Promise.all([post(context.pluginId, "awaitingThreads", isAwaiting), post(context.pluginId, "runningThreads", isRunning)]);
        // Сбой опроса оставляет значки как были: пропавший значок хуже устаревшего на такт.
        if (!alive || awaiting === null) return;
        // Ждущий владельца важнее идущего: сначала идущие, поверх — ждущие.
        const next = new Map<string, GlyphId>([
          ...(running ?? []).map((entry) => [entry.threadId, runningGlyph(entry.icon, entry.provider)] as const),
          ...awaiting.map((entry) => [entry.threadId, entry.kind] as const),
        ]);
        const { set, clear } = awaitingChanges(shown, next);
        clear.forEach((threadId) => setStatus(threadId, null));
        set.forEach(([threadId, id]) => {
          const glyph = glyphOf(id);
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
