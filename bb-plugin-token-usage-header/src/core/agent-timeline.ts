// Types + parser + formatter mirroring the JSON contract emitted by
// tools/agent_timeline.py --json. No I/O here — the caller
// (src/service/agent-timeline-service.ts) runs the process; this module only
// ever sees a string (stdout) and pure data.
import { z } from "zod";
import { formatCost } from "./format";

/**
 * Версия формата отчёта --json, которую понимает этот бандл. Должна
 * совпадать с SCHEMA_VERSION в tools/agent_timeline.py — считалка читается
 * с диска при каждом вызове, а этот файл живёт в собранном бандле и
 * обновляется только пересборкой. Тот же приём, что EXPECTED_SCHEMA_VERSION
 * в src/core/types.ts — см. memory/decisions/token-usage-json-schema-version.md.
 *
 * 1 -> 2: assistant-сообщения несут опциональные tokens/cost — см.
 * memory/decisions/token-usage-cost-on-messages.md.
 *
 * 2 -> 3: agent несёт requestFull/requestFullTruncated/responseFull/
 * responseFullTruncated — необрезанные (в пределах FULL_TEXT_MAX
 * tools/agent_timeline.py) текст запроса и ответа агента целиком, поверх
 * коротких превью-фрагментов events[].text.
 *
 * 3 -> 4: каждое message-событие несёт fullText/fullTextTruncated — полный
 * текст ИМЕННО ЭТОГО сообщения, чтобы раскрытие любой строки хронологии
 * показывало её целиком, а не только первого запроса/последнего ответа
 * агента (agent.requestFull/responseFull).
 */
export const EXPECTED_AGENT_TIMELINE_SCHEMA_VERSION = 4;

const toolEventSchema = z
  .object({
    ts: z.string(),
    kind: z.literal("tool"),
    /** Название инструмента из блока tool_use: Read/Glob/Grep/Skill/Bash/Task/Edit/Write/… */
    name: z.string(),
    /** Один осмысленный аргумент вызова (file_path/pattern/command/…), либо null. */
    target: z.string().nullable(),
  })
  .strict();

const hookEventSchema = z
  .object({
    ts: z.string(),
    kind: z.literal("hook"),
    hookName: z.string().nullable(),
    hookEvent: z.string().nullable(),
  })
  .strict();

const messageEventSchema = z
  .object({
    ts: z.string(),
    kind: z.literal("message"),
    role: z.enum(["user", "assistant"]),
    /** Краткий отрывок текста — уже обрезан скриптом, не полное сообщение. */
    text: z.string(),
    /**
     * Полный текст этого сообщения (в пределах FULL_TEXT_MAX символов
     * tools/agent_timeline.py), не только превью в `text` — для раскрытой
     * строки хронологии.
     */
    fullText: z.string(),
    fullTextTruncated: z.boolean(),
    /**
     * Цена вызова модели, породившего это сообщение — тарифицируется на
     * assistant-запись целиком (решение владельца: не на отдельные
     * tool_use-строки внутри неё). Присутствует только у role:"assistant"
     * записей с usage в транскрипте; у user-сообщений и записей без usage —
     * отсутствует, не null (см. tools/agent_timeline.py::message_event).
     */
    tokens: z.number().finite().optional(),
    cost: z.number().finite().optional(),
  })
  .strict();

export const agentTimelineEventSchema = z.discriminatedUnion("kind", [
  toolEventSchema,
  hookEventSchema,
  messageEventSchema,
]);

export type AgentTimelineToolEvent = z.infer<typeof toolEventSchema>;
export type AgentTimelineHookEvent = z.infer<typeof hookEventSchema>;
export type AgentTimelineMessageEvent = z.infer<typeof messageEventSchema>;
export type AgentTimelineEvent = z.infer<typeof agentTimelineEventSchema>;

const agentTimelineAgentInfoSchema = z
  .object({
    /** "main" для главного агента, "agent-<hash>" для субагента. */
    key: z.string(),
    agentType: z.string().nullable(),
    description: z.string().nullable(),
    model: z.string().nullable(),
    spawnDepth: z.number().nullable(),
    /** Отрывок prompt, которым субагент был запущен; null для главного агента. */
    promptExcerpt: z.string().nullable(),
    /**
     * Полный (в пределах FULL_TEXT_MAX символов) текст первого настоящего
     * user-сообщения этого агента — вход, которым его запустили, целиком, а
     * не 300-символьный promptExcerpt. Читается из СОБСТВЕННОГО транскрипта
     * агента, поэтому работает и там, где promptExcerpt не может (у
     * субагентов workflow-прогонов нет toolUseId, чтобы найти запись в
     * основном транскрипте). null, если такой записи нет.
     */
    requestFull: z.string().nullable(),
    requestFullTruncated: z.boolean(),
    /**
     * Полный текст последнего assistant-сообщения — финальный ответ агента
     * целиком. Последняя запись побеждает, включая пустую: транскрипт,
     * оборвавшийся на голом tool_use, даёт null, а не устаревший ответ.
     */
    responseFull: z.string().nullable(),
    responseFullTruncated: z.boolean(),
  })
  .strict();

export type AgentTimelineAgentInfo = z.infer<typeof agentTimelineAgentInfoSchema>;

const agentTimelineSchema = z
  .object({
    schemaVersion: z.number(),
    agent: agentTimelineAgentInfoSchema,
    events: z.array(agentTimelineEventSchema),
  })
  .strict();

export type AgentTimeline = z.infer<typeof agentTimelineSchema>;

export type AgentTimelineParseFailureReason =
  | "invalid_json"
  | "invalid_shape"
  | "script_error"
  | "schema_version_mismatch";

export interface AgentTimelineParseSuccess {
  ok: true;
  data: AgentTimeline;
}

export interface AgentTimelineParseFailure {
  ok: false;
  reason: AgentTimelineParseFailureReason;
  message: string;
}

export type AgentTimelineParseResult = AgentTimelineParseSuccess | AgentTimelineParseFailure;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fail(reason: AgentTimelineParseFailureReason, message: string): AgentTimelineParseFailure {
  return { ok: false, reason, message };
}

/**
 * Parses the stdout of `tools/agent_timeline.py --json`. Never throws —
 * malformed input from an external process is an expected case, not a bug.
 */
export function parseAgentTimeline(raw: string): AgentTimelineParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return fail("invalid_json", "empty output");
  }

  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch (e) {
    return fail("invalid_json", `not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!isRecord(json)) {
    return fail("invalid_shape", "expected a JSON object at the top level");
  }

  // agent_timeline.py's own top-level exception handler prints
  // {"error": "..."} and nothing else — distinguish that from a malformed
  // real report (mirrors isScriptError in src/core/parse.ts).
  if (typeof json.error === "string" && !("events" in json)) {
    return fail("script_error", json.error);
  }

  // Проверяется раньше events/agent и чего угодно ещё, тем же приёмом, что
  // и parseTokensOutput в src/core/parse.ts.
  if (json.schemaVersion !== EXPECTED_AGENT_TIMELINE_SCHEMA_VERSION) {
    const got =
      json.schemaVersion === undefined
        ? "поле версии схемы отсутствует"
        : `получена версия ${JSON.stringify(json.schemaVersion)}`;
    const remedy =
      typeof json.schemaVersion === "number" && json.schemaVersion > EXPECTED_AGENT_TIMELINE_SCHEMA_VERSION
        ? "Нужна пересборка плагина."
        : "Пересборка плагина не поможет: обновите установку плагина или проверьте, из какого дерева берётся tools/agent_timeline.py.";
    return fail(
      "schema_version_mismatch",
      `Плагин собран под другую версию считалки tools/agent_timeline.py: ожидается версия схемы ${EXPECTED_AGENT_TIMELINE_SCHEMA_VERSION}, ${got}. ${remedy}`,
    );
  }

  const parsed = agentTimelineSchema.safeParse(json);
  if (!parsed.success) {
    return fail("invalid_shape", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }

  return { ok: true, data: parsed.data };
}

/** True when a parsed JSON value looks like agent_timeline.py's `{"error": "..."}` output. */
export function isAgentTimelineScriptError(json: unknown): json is { error: string } {
  return isRecord(json) && typeof json.error === "string" && !("events" in json);
}

const TOOL_KIND_LABEL = "Инструмент";
const HOOK_KIND_LABEL = "Хук";
const USER_LABEL = "Пользователь";
const ASSISTANT_LABEL = "Ассистент";

function truncate(raw: string, maxLength: number): string {
  if (raw.length <= maxLength) return raw;
  if (maxLength <= 1) return raw.slice(0, Math.max(maxLength, 0));
  return `${raw.slice(0, maxLength - 1)}…`;
}

/**
 * Единственное место, где событие хронологии превращается в подпись для UI:
 * тип-словом (что заменяет иконку в тексте) плюс человекочитаемая цель.
 * Клиент рисует готовую строку и не собирает её заново — тот же приём, что
 * formatBucketDisplay в src/core/format.ts (см.
 * memory/decisions/token-usage-one-caption-source.md).
 */
export function formatEventLabel(event: AgentTimelineEvent, maxLength = 80): string {
  switch (event.kind) {
    case "tool": {
      const base = `${TOOL_KIND_LABEL} ${event.name}`;
      return event.target ? truncate(`${base}: ${event.target}`, maxLength) : base;
    }
    case "hook": {
      const name = event.hookName ?? "?";
      const hookEvent = event.hookEvent ?? "?";
      return `${HOOK_KIND_LABEL} ${name} (${hookEvent})`;
    }
    case "message": {
      const roleLabel = event.role === "user" ? USER_LABEL : ASSISTANT_LABEL;
      // Цена — только у assistant-сообщений с usage (см. messageEventSchema);
      // отсутствие поля, а не 0, значит "цены нет" — суффикс не показывается.
      const prefix = event.cost !== undefined ? `${roleLabel} (${formatCost(event.cost)})` : roleLabel;
      return event.text ? truncate(`${prefix}: ${event.text}`, maxLength) : prefix;
    }
    default: {
      // Exhaustiveness guard — a new event kind added to the discriminated
      // union without updating this switch fails to compile here.
      const _never: never = event;
      return String(_never);
    }
  }
}
