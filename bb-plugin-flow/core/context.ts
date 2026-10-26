// Вторая полоса баннера: доля занятого окна контекста, её тон по двум порогам
// владельца и отрезки полосы, на которые эти пороги её делят. Чисто, без эффектов.
import { SELF_EXECUTOR, stageSkillOf } from "../lib/stage-constants";
import type { WorkStage } from "../shared/contract";
import { executionOf } from "./stage-execution";

/** Обычный, предупреждающий и тревожный тон заливки занятого. */
export type ContextTone = "normal" | "warn" | "alert";

/**
 * Пороги в токенах, а не в долях окна: окно у тредов разное — 200k у одной
 * модели, 1M у другой, — и один процент означал бы очень разный объём.
 */
export interface ContextThresholds {
  readonly warnTokens: number;
  readonly alertTokens: number;
}

/**
 * Значения по умолчанию объявлены здесь и читаются сервером: записанное дважды,
 * в настройке и в запасном значении, число разошлось бы молча. Каждый шаг агента
 * перечитывает весь контекст, поэтому тревожить надо рано: с 150 тысяч граница
 * этапов уже сжимает тред, а с 300 тысяч полоса краснеет.
 */
export const DEFAULT_WARN_TOKENS = 150_000;
export const DEFAULT_ALERT_TOKENS = 300_000;

export const DEFAULT_CONTEXT_THRESHOLDS: ContextThresholds = {
  warnTokens: DEFAULT_WARN_TOKENS,
  alertTokens: DEFAULT_ALERT_TOKENS,
};

const clamp = (value: number, max: number): number => Math.min(max, Math.max(0, value));

/**
 * Доля занятого окна в `0..1`. Окно не положительное или число не число —
 * делить не на что, и полосы не будет. Занятое сверх окна обрезается единицей:
 * полоса длиннее своей ячейки не бывает.
 */
export function contextShare(usedTokens: number, windowTokens: number): number | null {
  if (!Number.isFinite(usedTokens) || !Number.isFinite(windowTokens) || windowTokens <= 0) return null;
  return clamp(usedTokens / windowTokens, 1);
}

/** Процент занятого — та единица, в которой читается подпись и меряются пороги. */
export const contextPercent = (share: number): number => Math.round(clamp(Number.isFinite(share) ? share : 0, 1) * 100);

const isTokenCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Пара осмысленна, только когда жёлтый строго меньше красного, — по этому правилу сторожится и ввод. */
export const isOrderedPair = (warnTokens: number, alertTokens: number): boolean => warnTokens < alertTokens;

/**
 * Пара порогов такая, как её ввёл владелец, — либо умолчание целиком.
 * Осмысленна только пара, где жёлтый строго меньше красного; невалидную не
 * чиним и не разворачиваем, иначе полоса красится не по той подписи, которую
 * показывает. Ввод сторожит схема настройки, а это — последний рубеж на случай,
 * когда обе ручки записаны одним вызовом мимо страницы настроек.
 */
export function thresholdsOrDefault(warn: unknown, alert: unknown): ContextThresholds {
  if (!isTokenCount(warn) || !isTokenCount(alert) || !isOrderedPair(warn, alert)) return DEFAULT_CONTEXT_THRESHOLDS;
  return { warnTokens: warn, alertTokens: alert };
}

/** Тон по занятым токенам. Порог включается в свою полосу: ровно 150 000 — уже предупреждение. */
export function contextTone(usedTokens: number, thresholds: ContextThresholds): ContextTone {
  if (usedTokens >= thresholds.alertTokens) return "alert";
  if (usedTokens >= thresholds.warnTokens) return "warn";
  return "normal";
}

/** Отрезок полосы: его доля длины полосы и доля самого отрезка, залитая занятым. */
export interface ContextSegment {
  readonly size: number;
  readonly filled: number;
}

/**
 * Полоса, разрезанная порогами: граница стоит на доле «порог ÷ окно». Порог на
 * нуле или не меньше окна границы не рисует — отрезок нулевой длины не
 * отрезок. Занятое раскладывается по отрезкам слева направо, так что заливка
 * в сумме равна доле занятого окна. Окно не положительное — полосы нет.
 */
export function contextSegments(usedTokens: number, windowTokens: number, thresholds: ContextThresholds): readonly ContextSegment[] {
  const share = contextShare(usedTokens, windowTokens);
  if (share === null) return [];
  const cuts = [thresholds.warnTokens, thresholds.alertTokens].filter((tokens) => tokens > 0 && tokens < windowTokens).map((tokens) => tokens / windowTokens);
  const edges = [0, ...cuts, 1];
  return edges.slice(1).map((end, index) => {
    const start = edges[index]!;
    return { size: end - start, filled: clamp((share - start) / (end - start), 1) };
  });
}

/** Токены коротко — так же, как их пишет bb в своём «Estimated context»: 163 000 → «163k». */
export const shortTokens = (tokens: number): string => {
  if (!Number.isFinite(tokens)) return "0";
  const value = Math.max(0, Math.round(tokens));
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
  return `${Number((value / 1_000_000).toFixed(1))}M`;
};

/**
 * Когда бриф открывается с уже выбранной компактацией треда: никогда, с жёлтой
 * зоны второй полосы или только в красной. Зоны — те же пороги, что красят полосу.
 */
export type CompactPreselect = "never" | "warn" | "alert";

/** Подписи вариантов в настройке: хост показывает и хранит именно их, поэтому вариант читается обратно по подписи. */
export const COMPACT_PRESELECT_LABELS: Readonly<Record<CompactPreselect, string>> = {
  never: "Never",
  warn: "In the yellow zone",
  alert: "In the red zone",
};

/** Умолчание — с жёлтой зоны: компактировать стоит раньше, чем окно подойдёт к концу. */
export const DEFAULT_COMPACT_PRESELECT: CompactPreselect = "warn";

/** Вариант по значению настройки; непонятное значение — умолчание. */
export const compactPreselectOf = (value: unknown): CompactPreselect =>
  (Object.keys(COMPACT_PRESELECT_LABELS) as CompactPreselect[]).find((preselect) => COMPACT_PRESELECT_LABELS[preselect] === value) ?? DEFAULT_COMPACT_PRESELECT;

/** Предвыбрана ли компактация при таком тоне полосы: жёлтая зона включает и красную. */
export function preselectsCompact(preselect: CompactPreselect, tone: ContextTone): boolean {
  switch (preselect) {
    case "never":
      return false;
    case "warn":
      return tone !== "normal";
    case "alert":
      return tone === "alert";
  }
}

/** Кэш провайдера живёт час без вызовов: после паузы дольше часа следующий шаг записывает весь контекст заново, по двойной цене. */
export const CACHE_TTL_MS = 3_600_000;

/**
 * Прошёл ли с `createdAt` больше часа. Время, которое не читается, кэш не истекает: сжатие само не включается.
 * Ровно час — ещё жив; «сейчас» приходит аргументом, мир ядро не читает.
 */
export function cacheExpired(createdAt: string, now: Date): boolean {
  const created = Date.parse(createdAt);
  return Number.isFinite(created) && now.getTime() - created > CACHE_TTL_MS;
}

/** Роль модели этапа: Sonnet тянет реализацию и тесты, Opus — остальную работу агента. */
export type ModelRole = "sonnet" | "opus";

/** Навыки, этапы которых ведёт Sonnet: реализация и тестирование. */
const SONNET_SKILLS: readonly string[] = ["code-standards-fp", "testing-tdd"];

/** Роль модели этапа; у автоматизации и действия, которые исполняет сам Flow, модели нет. */
export function stageModelRole(stage: WorkStage): ModelRole | null {
  const execution = executionOf(stage);
  if (execution.kind === "script" || execution.kind === "external") return null;
  return SONNET_SKILLS.includes(stageSkillOf(stage)) ? "sonnet" : "opus";
}

/** Первая модель каталога провайдера, чей id содержит имя роли; такой нет — `null`, и модель треда не трогается. */
export const modelFor = (role: ModelRole, models: ReadonlyArray<{ readonly model: string }>): string | null =>
  models.find((entry) => entry.model.toLowerCase().includes(role))?.model ?? null;

/**
 * Модель, на которую надо поставить тред для роли: уже стоящая модель этой роли остаётся — менять одну Sonnet на другую
 * незачем. Иначе та, что стояла у треда до перехода на другую роль (`remembered`), если она есть в каталоге и подходит роли;
 * иначе первая из каталога.
 */
export const wantedModel = (role: ModelRole, currentModel: string | null, models: ReadonlyArray<{ readonly model: string }>, remembered: string | null = null): string | null => {
  const fits = (model: string): boolean => model.toLowerCase().includes(role);
  if (currentModel !== null && fits(currentModel)) return currentModel;
  return remembered !== null && fits(remembered) && models.some((entry) => entry.model === remembered) ? remembered : modelFor(role, models);
};

/** Что сделать с тредом на границе этапов: сжать контекст и/или поставить модель следующего этапа. */
export interface BoundaryPlan {
  readonly compact: boolean;
  readonly model: string | null;
}

/** Сжимать велит жёлтый тон и выше; модель ставится, когда нужная известна и отличается от стоящей. Нечего делать — `null`. */
export function boundaryPlan(input: { readonly tone: ContextTone; readonly currentModel: string | null; readonly wantedModel: string | null }): BoundaryPlan | null {
  const compact = input.tone !== "normal";
  const model = input.wantedModel !== null && input.wantedModel !== input.currentModel ? input.wantedModel : null;
  return compact || model !== null ? { compact, model } : null;
}

/** Множитель агента-исполнителя, который советует бриф: субагент работает в своём контексте и обходится дешевле главного агента. */
export const SUBAGENT_FACTOR = { factor: 0.7, risk: 0 } as const;

/**
 * Совет о субагенте в отчётах брифа. Контекст не обычный — каждый шаг главного агента перечитывает его весь, — поэтому у
 * несделанного этапа реализации или тестов (роль Sonnet), который агент оставил себе, а во flow у него есть агент-исполнитель,
 * рекомендуется первый такой агент; нет у этапа множителя этого агента — ставится `SUBAGENT_FACTOR`. Остальное не трогается.
 */
export function withSubagents<R extends { id: string; state: string; executor: string; factors?: Record<string, { factor: number; risk: number }> | undefined }>(
  reports: readonly R[],
  stages: readonly WorkStage[],
  tone: ContextTone,
): R[] {
  if (tone === "normal") return [...reports];
  return reports.map((report) => {
    const stage = stages.find((s) => s.id === report.id);
    const agent = stage === undefined ? undefined : stage.executors.find((e) => e.kind === "agent");
    if (stage === undefined || agent === undefined || report.state !== "todo" || report.executor !== SELF_EXECUTOR || stageModelRole(stage) !== "sonnet") return report;
    return { ...report, executor: agent.id, factors: { ...report.factors, ...(report.factors?.[agent.id] === undefined ? { [agent.id]: SUBAGENT_FACTOR } : {}) } };
  });
}
