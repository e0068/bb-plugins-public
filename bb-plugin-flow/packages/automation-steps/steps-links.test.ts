import { describe, expect, it } from "vitest";

import type { StepOutcome } from "./core/step-outcomes";
import { createSteps, retrying, type StepPorts } from "./steps";
import type { CliPorts, CliRun } from "./wiring/bb-cli-run";

const ran = (stdout: string): CliRun => ({ kind: "ran", code: 0, stdout, stderr: "" });

const ports = (cli: CliPorts): StepPorts =>
  ({
    sdk: {},
    kv: { get: async () => undefined, set: async () => undefined, delete: async () => undefined, list: async () => [] },
    settings: { get: async () => ({ githubToken: "token" }) },
    plugins: {},
    ownPluginId: "flow",
    cli,
  }) as unknown as StepPorts;

const linked: CliPorts = {
  run: async (args) => (args[1] === "current" ? ran(JSON.stringify({ tasks: [{ id: "p1:flow-ssylki", key: "BBPL-12" }, { id: "p1:mail-fix", key: "mail-fix" }] })) : ran("")),
};

describe("ссылки шагов задач", () => {
  it("«Задача → done» даёт ссылку на файл каждой переведённой задачи", async () => {
    expect(await createSteps(ports(linked))["bb.tasks-done"]("t1")).toEqual({
      ok: true,
      detail: "BBPL-12, mail-fix",
      links: [
        { label: "BBPL-12", target: "docs/tasks/done/flow-ssylki.md" },
        { label: "mail-fix", target: "docs/tasks/done/mail-fix.md" },
      ],
    });
  });

  it("«Задача → in_review» ссылок не даёт", async () => {
    expect(await createSteps(ports(linked))["bb.tasks-in-review"]("t1")).toEqual({ ok: true, detail: "BBPL-12, mail-fix" });
  });
});

describe("ссылки шага после повтора", () => {
  it("успех со второй попытки сохраняет ссылки шага", async () => {
    const link = { label: "PR #42", target: "https://github.com/o/r/pull/42" };
    const outcomes: StepOutcome[] = [{ ok: false, error: "HTTP 502" }, { ok: true, detail: null, links: [link] }];
    let call = 0;
    const outcome = await retrying(async () => undefined, async () => outcomes[call++]!)("t1");
    expect(outcome).toEqual({ ok: true, detail: "succeeded on attempt 2", links: [link] });
  });
});

describe("задача без слага", () => {
  it("задача, у которой CLI не назвал файла, ссылки не даёт — только ключ строкой", async () => {
    const bare: CliPorts = { run: async (args) => (args[1] === "current" ? ran(JSON.stringify({ tasks: [{ key: "BBPL-12" }] })) : ran("")) };
    expect(await createSteps(ports(bare))["bb.tasks-done"]("t1")).toEqual({ ok: true, detail: "BBPL-12" });
  });
});
