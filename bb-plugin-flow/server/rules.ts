// Правило в память или навык — директивой, как команда. Агент зовёт `propose_rule`, предложение ложится в kv,
// в сообщении остаётся строка `::rule{id="…"}`; виджет показывает правило, место и похожие места, а файл пишет
// плагин — только после «Записать» владельца, только в память и в навыки и только поверх той версии файла,
// что была при предложении. Исход уходит агенту репликой, не останавливая его ход.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { RULE_ID_PREFIX, ruleDirectiveLine } from "../core/directive";
import { appended, editedRule, memoryIndexOf, occurrences, proposalIssues, replaced, ruleTargetIssue, withRuleText } from "../core/rule";
import { messages } from "../lib/messages";
import { proposeRuleCallSchema, ruleRecordSchema, rulesRpcContract, type RuleRecord } from "../shared/contract";

export const RULE_TOOL_NAME = "propose_rule";

export const RULE_INSTRUCTIONS = `When the owner states a working rule ("always …", "never …", "from now on …") or you are about to save feedback to memory or a skill, do not write the file yourself — propose it with the ${RULE_TOOL_NAME} tool: one rule — one call. First search memory and skills for similar places and pass them in similar, marking same: true where it already says the same. When a similar place contradicts the rule or the rule rewrites it, use mode replace with that fragment in replaces instead of appending next to it: the owner sees the removed lines and the new ones. The owner sees the rule, where it goes and the similar places; on "Write" the plugin writes content into the file, and you get the outcome as a message — do not wait for it. After the call, paste the directive line from the result into your reply as a standalone line, without quotes or backticks.`;

const keyOf = (id: string): string => `rule:${id}`;

const sha256 = (content: string): string => createHash("sha256").update(content).digest("hex");

const readText = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

type Deps = {
  newId: () => string;
  now: () => string;
  home: string;
  /** Отметка своей отправки: иначе реплика плагина считается сообщением владельца и возвращает ему ждущий бриф. */
  ownSend?: (threadId: string, text: string) => void;
};

type Written = { kind: "written"; paths: string[] } | { kind: "conflict"; path: string };

/** Запись по решению владельца. Файл правила — первым: оглавление без своего файла хуже, чем файл без строки в оглавлении. */
const write = async (rule: RuleRecord, text: string): Promise<Written> => {
  const { content, index } = editedRule(rule, text);
  const path = rule.target.path;
  if (rule.mode === "create") {
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, content.endsWith("\n") ? content : `${content}\n`, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return { kind: "conflict", path };
      throw error;
    }
  } else {
    const existing = await readText(path);
    if (existing === null || sha256(existing) !== rule.baseSha256) return { kind: "conflict", path };
    const next = rule.mode === "replace" ? replaced(existing, rule.replaces ?? "", content) : appended(existing, content);
    if (next === null) return { kind: "conflict", path };
    await writeFile(path, next);
  }
  if (index === undefined) return { kind: "written", paths: [path] };
  const indexPath = memoryIndexOf(path);
  await writeFile(indexPath, appended((await readText(indexPath)) ?? "", index));
  return { kind: "written", paths: [path, indexPath] };
};

export const registerRules = (bb: Pick<BbPluginApi, "agents" | "rpc" | "storage" | "sdk">, deps: Deps): void => {
  const kv = bb.storage.kv;
  const read = async (id: string): Promise<RuleRecord | null> => {
    const parsed = ruleRecordSchema.safeParse(await kv.get(keyOf(id)));
    return parsed.success ? parsed.data : null;
  };

  bb.agents.registerTool({
    name: RULE_TOOL_NAME,
    description: "Propose a working rule for the owner to approve into a memory file or a skill; the plugin writes it on approval.",
    instructions: RULE_INSTRUCTIONS,
    presentation: { label: { pending: "Preparing a rule", completed: "Rule proposed in the thread" } },
    parameters: proposeRuleCallSchema,
    async execute(call, ctx) {
      const params = withRuleText(call);
      const refuse = (issues: string[]) => new Error(`The rule is not proposed:\n- ${issues.join("\n- ")}`);
      // Путь сверяется до диска: отказ «already exists» не должен говорить агенту, что лежит вне памяти и навыков.
      const issues = proposalIssues(params, deps.home);
      if (issues.length > 0) throw refuse(issues);
      const existing = await readText(params.target.path);
      if (params.mode === "create" && existing !== null) throw refuse([`"${params.target.path}" already exists: use mode append or replace`]);
      if (params.mode !== "create" && existing === null) throw refuse([`"${params.target.path}" does not exist: use mode create`]);
      const found = params.mode === "replace" && existing !== null ? occurrences(existing, params.replaces ?? "") : 1;
      if (found !== 1) throw refuse([`replaces must occur in "${params.target.path}" exactly once, verbatim; it occurs ${found} times`]);
      const record: RuleRecord = { ...params, id: `${RULE_ID_PREFIX}${deps.newId()}`, threadId: ctx.threadId, createdAt: deps.now(), baseSha256: existing === null ? null : sha256(existing) };
      await kv.set(keyOf(record.id), record);
      return `${ruleDirectiveLine(record.id)}\n\nPaste the line above into your reply as a standalone line — the owner sees the rule with "Write" and "Don't write" in its place. Keep working: the outcome arrives as a message.`;
    },
  });

  const reply = async (rule: RuleRecord, text: string): Promise<void> => {
    deps.ownSend?.(rule.threadId, text);
    await bb.sdk.threads.send({ threadId: rule.threadId, mode: "steer-if-active", input: [{ type: "text", text, mentions: [] }] });
  };

  bb.rpc.register(rulesRpcContract, {
    async getRule({ id }) {
      const rule = await read(id);
      return rule === null ? { kind: "not_found" as const } : { kind: "found" as const, rule };
    },
    async decideRule({ id, decision, text: edited, locale }) {
      const rule = await read(id);
      if (rule === null) return { kind: "not_found" as const };
      // Решение принимается один раз: повтор кнопки возвращает уже записанный исход и ничего не пишет.
      if (rule.decision !== undefined) return { kind: "found" as const, rule };
      // Путь сверяется снова: запись из хранилища старой версии не должна писать туда, куда новая не пустила бы.
      const issue = ruleTargetIssue(rule.target, deps.home);
      if (issue !== null) throw new Error(issue);
      const t = messages(locale).rule;
      const at = deps.now();
      const text = edited?.trim() || rule.text;
      const outcome = decision === "decline" ? ({ kind: "declined" } as const) : await write(rule, text);
      const decided: RuleRecord = {
        ...rule,
        decision: outcome.kind === "written" ? { kind: "written", at, text, paths: outcome.paths } : outcome.kind === "conflict" ? { kind: "conflict", at, path: outcome.path } : { kind: "declined", at },
      };
      await kv.set(keyOf(id), decided);
      await reply(decided, outcome.kind === "written" ? t.replyWritten(text, outcome.paths.join(", ")) : outcome.kind === "conflict" ? t.replyConflict(rule.text, outcome.path) : t.replyDeclined(rule.text));
      return { kind: "found" as const, rule: decided };
    },
  });
};
