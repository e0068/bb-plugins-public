// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("навыки велят показывать виджеты по ходу работы", () => {
  it("вопрос задаётся, как возник, а останавливаться ли — решает агент", () => {
    expect(read("./skills/flow/SKILL.md")).toMatch(/decide yourself whether to stop/);
    expect(read("./skills/flow-questions/SKILL.md")).toMatch(/Ask as it arises, and decide yourself whether to stop/);
    expect(read("./skills/flow-questions/ru.md")).toMatch(/Спрашивай, как вопрос возник, и сам решай, останавливаться ли/);
  });

  it("демонстрацию присылают, когда дошли до её этапа, и не прячут в утверждение", () => {
    expect(read("./skills/flow-demo/SKILL.md")).toMatch(/the moment its stage comes/);
    expect(read("./skills/flow-demo/ru.md")).toMatch(/в тот момент, когда дошёл до её этапа/);
  });

  it("утверждение не ссылается на виджеты, которых не присылали", () => {
    expect(read("./skills/flow-approve/SKILL.md")).toMatch(/Never refer to widgets you did not send/);
    expect(read("./skills/flow-approve/ru.md")).toMatch(/Не ссылайся на виджеты, которых в этом прогоне не присылал/);
  });

  it("старые правила, противоречащие этому, из навыков убраны", () => {
    expect(read("./skills/flow-questions/SKILL.md")).not.toMatch(/only when it is unclear how to proceed/);
    expect(read("./skills/flow-questions/ru.md")).not.toMatch(/только когда без него непонятно, как действовать/);
    expect(read("./skills/flow-stage-selection/SKILL.md")).not.toMatch(/On a Demo stage, stop/);
    expect(read("./skills/flow-stage-selection/ru.md")).not.toMatch(/На этапе Демонстрация останавливаешься/);
  });
});
