// @vitest-environment node
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { beforeEach, describe, expect, it } from "vitest";

import { RULE_ID_PREFIX, ruleDirectiveLine } from "../core/directive";
import { RULE_TOOL_NAME, registerRules } from "./rules";

const textOf = (result: unknown): string =>
  typeof result === "string" ? result : ((result as { content: Array<{ text?: string }> }).content ?? []).map((p) => p.text ?? "").join("\n");

let home = "";
let memory = "";
let skill = "";

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), "flow-rules-")));
  memory = join(home, ".claude", "projects", "-Users-me-repo", "memory");
  skill = join(home, ".claude", "skills", "flow-demo");
  await mkdir(memory, { recursive: true });
  await mkdir(skill, { recursive: true });
  await writeFile(join(memory, "MEMORY.md"), "- [Старое](old.md) — было\n");
  await writeFile(join(skill, "SKILL.md"), "# flow-demo\n\nResults hold a live one.");
});

const setup = () => {
  const sent: Array<{ threadId: string; mode?: string; text: string }> = [];
  const own: string[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: {
        send: async (args) => {
          sent.push({ threadId: args.threadId, ...(args.mode === undefined ? {} : { mode: args.mode }), text: args.input.map((part) => ("text" in part ? part.text : "")).join("") });
          return {};
        },
      },
    },
  });
  let counter = 0;
  registerRules(bb, { newId: () => `R${++counter}`, now: () => "2026-10-22T12:00:00.000Z", home, ownSend: (_, text) => own.push(text) });
  return { harness, sent, own };
};

const memoryRule = () => ({
  text: "Подписи развилок — словами владельца",
  why: "Тумблер «outcome.rules» владелец не понял.",
  target: { kind: "memory", path: join(memory, "fork-labels.md") },
  mode: "create",
  content: "---\nname: fork-labels\n---\n\nПодписи развилок — словами владельца.\n",
  index: "- [Подписи развилок](fork-labels.md) — Подписи развилок — словами владельца",
  similar: [{ kind: "skill", path: join(skill, "SKILL.md"), quote: "«Подписи в голосе продукта»", note: "рядом" }],
});

const skillRule = () => ({
  text: "Прототип — двумя ссылками",
  why: "Владелец искал адрес вручную.",
  target: { kind: "skill", path: join(skill, "SKILL.md"), name: "flow-demo" },
  mode: "append",
  content: "Прототип — двумя ссылками: для окна bb и командой open.",
});

const propose = async (harness: ReturnType<typeof setup>["harness"], params: object) => textOf(await harness.callAgentTool(RULE_TOOL_NAME, params, { threadId: "thr_1" }));

describe("инструмент propose_rule", () => {
  it("кладёт предложение с тредом из контекста и возвращает строку директивы — файл не трогает", async () => {
    const { harness } = setup();
    expect(await propose(harness, memoryRule())).toContain(ruleDirectiveLine(`${RULE_ID_PREFIX}R1`));
    const found = await harness.callRpc("getRule", { id: `${RULE_ID_PREFIX}R1` });
    expect(found).toMatchObject({ kind: "found", rule: { threadId: "thr_1", baseSha256: null, similar: [{ note: "рядом" }] } });
    await expect(readFile(join(memory, "fork-labels.md"), "utf8")).rejects.toThrow();
  });

  it("путь вне памяти и навыков, create поверх существующего и append к несуществующему отбиваются", async () => {
    const { harness } = setup();
    await expect(propose(harness, { ...memoryRule(), target: { kind: "memory", path: join(home, ".zshrc.md") } })).rejects.toThrow(/memory/);
    await expect(propose(harness, { ...skillRule(), target: { kind: "skill", path: join(home, "notes", "x.md") } })).rejects.toThrow(/skills/);
    await expect(propose(harness, { ...skillRule(), mode: "create" })).rejects.toThrow(/already exists/);
    await expect(propose(harness, { ...memoryRule(), mode: "append", index: undefined })).rejects.toThrow(/does not exist/);
    await expect(propose(harness, { ...skillRule(), content: "другой текст" })).rejects.toThrow(/verbatim/);
  });

  it("замена — только куска, который стоит в файле ровно один раз", async () => {
    const { harness } = setup();
    await expect(propose(harness, { ...skillRule(), mode: "replace", replaces: "нет такого" })).rejects.toThrow(/exactly once.*0 times/s);
    await expect(propose(harness, { ...skillRule(), mode: "replace", replaces: "o" })).rejects.toThrow(/exactly once/);
    await expect(propose(harness, { ...skillRule(), mode: "replace" })).rejects.toThrow(/needs replaces/);
    await expect(propose(harness, { ...skillRule(), replaces: "flow-demo" })).rejects.toThrow(/only for mode replace/);
  });

  it("запрещённый путь отбивается до диска: отказ не говорит, есть ли там файл", async () => {
    const { harness } = setup();
    await writeFile(join(home, "secret.md"), "x");
    const refusal = propose(harness, { ...skillRule(), target: { kind: "skill", path: join(home, "secret.md") }, mode: "create" });
    await expect(refusal).rejects.toThrow(/skills/);
    await expect(refusal).rejects.not.toThrow(/already exists/);
  });

  it("инструкции по-английски и велят не писать файл самому", () => {
    const { harness } = setup();
    const tool = harness.registrations.agentTools.find((t) => t.name === RULE_TOOL_NAME);
    expect(tool?.instructions).toContain("do not write the file yourself");
    expect(tool?.instructions).toContain("mode replace");
    expect(tool?.instructions).not.toMatch(/[А-Яа-яЁё]/);
  });
});

describe("решение владельца", () => {
  it("«Записать» новый файл памяти: файл и строка в оглавлении, агенту — реплика своей отметкой", async () => {
    const { harness, sent, own } = setup();
    await propose(harness, memoryRule());
    const result = await harness.callRpc("decideRule", { id: `${RULE_ID_PREFIX}R1`, decision: "write" });
    expect(result).toMatchObject({ kind: "found", rule: { decision: { kind: "written", paths: [join(memory, "fork-labels.md"), join(memory, "MEMORY.md")] } } });
    expect(await readFile(join(memory, "fork-labels.md"), "utf8")).toBe(memoryRule().content);
    expect(await readFile(join(memory, "MEMORY.md"), "utf8")).toBe(`- [Старое](old.md) — было\n${memoryRule().index}\n`);
    expect(sent).toEqual([{ threadId: "thr_1", mode: "steer-if-active", text: expect.stringContaining("записано") }]);
    expect(own).toEqual([sent[0]?.text]);
  });

  it("поправленный владельцем текст пишется вместо предложенного — и в файле, и в оглавлении", async () => {
    const { harness } = setup();
    await propose(harness, memoryRule());
    await harness.callRpc("decideRule", { id: `${RULE_ID_PREFIX}R1`, decision: "write", text: "Подписи — тем, что видно на экране" });
    expect(await readFile(join(memory, "fork-labels.md"), "utf8")).toContain("Подписи — тем, что видно на экране.");
    expect(await readFile(join(memory, "MEMORY.md"), "utf8")).toContain("— Подписи — тем, что видно на экране\n");
  });

  it("«Записать» в навык дописывает в конец с новой строки", async () => {
    const { harness } = setup();
    await propose(harness, skillRule());
    await harness.callRpc("decideRule", { id: `${RULE_ID_PREFIX}R1`, decision: "write" });
    expect(await readFile(join(skill, "SKILL.md"), "utf8")).toBe(`# flow-demo\n\nResults hold a live one.\n${skillRule().content}\n`);
  });

  it("«Записать» с заменой: расходящийся кусок навыка уходит, правило встаёт на его место", async () => {
    const { harness } = setup();
    await propose(harness, { ...skillRule(), mode: "replace", replaces: "Results hold a live one." });
    await harness.callRpc("decideRule", { id: `${RULE_ID_PREFIX}R1`, decision: "write" });
    expect(await readFile(join(skill, "SKILL.md"), "utf8")).toBe(`# flow-demo\n\n${skillRule().content}`);
  });

  it("файл изменился после предложения — не пишется, исход «conflict», агент узнаёт", async () => {
    const { harness, sent } = setup();
    await propose(harness, skillRule());
    await writeFile(join(skill, "SKILL.md"), "# flow-demo\n\nчужая правка\n");
    const result = await harness.callRpc("decideRule", { id: `${RULE_ID_PREFIX}R1`, decision: "write" });
    expect(result).toMatchObject({ rule: { decision: { kind: "conflict", path: join(skill, "SKILL.md") } } });
    expect(await readFile(join(skill, "SKILL.md"), "utf8")).toBe("# flow-demo\n\nчужая правка\n");
    expect(sent[0]?.text).toContain("изменился");
  });

  it("«Не записывать» файл не трогает; повтор решения ничего не пишет", async () => {
    const { harness, sent } = setup();
    await propose(harness, skillRule());
    await harness.callRpc("decideRule", { id: `${RULE_ID_PREFIX}R1`, decision: "decline" });
    const again = await harness.callRpc("decideRule", { id: `${RULE_ID_PREFIX}R1`, decision: "write" });
    expect(again).toMatchObject({ rule: { decision: { kind: "declined" } } });
    expect(await readFile(join(skill, "SKILL.md"), "utf8")).toBe("# flow-demo\n\nResults hold a live one.");
    expect(sent).toHaveLength(1);
  });

  it("неизвестное правило — not_found", async () => {
    const { harness } = setup();
    expect(await harness.callRpc("decideRule", { id: "rul_none", decision: "write" })).toEqual({ kind: "not_found" });
  });
});
