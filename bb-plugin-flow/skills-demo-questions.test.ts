// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { stageInstructions } from "./core/stages";
import { builtinStage } from "./lib/stage-constants";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("вопрос по демо задаётся в самом демо", () => {
  it("навык велит класть вопрос в questions демонстрации и переносить неотвеченное уточнение через resolves", () => {
    expect(read("./skills/flow-demo/SKILL.md")).toMatch(/A question about the demo goes in the demo/);
    expect(read("./skills/flow-demo/SKILL.md")).toMatch(/close the old one with `resolves`/);
    expect(read("./skills/flow-demo/ru.md")).toMatch(/Вопрос по демо задаётся в самом демо/);
    expect(read("./skills/flow-demo/ru.md")).toMatch(/старое закрой через `resolves`/);
  });

  it("демонстрация без кнопок; вопросы и поле комментария — только когда впереди Утверждение", () => {
    expect(read("./skills/flow-demo/SKILL.md")).toMatch(/The demo widget is the report: no buttons\. When an approval stands ahead, it has the demo's questions, if any, and a comment field/);
    expect(read("./skills/flow-demo/ru.md")).toMatch(/кнопок нет\. Когда впереди Утверждение, у него есть вопросы демонстрации, если они заданы, и поле комментария/);
  });

  it("навык не обещает отказа вопросам там, где впереди Утверждение", () => {
    expect(read("./skills/flow-demo/SKILL.md")).not.toMatch(/no `questions` and no `nextFlow`/);
    expect(read("./skills/flow-demo/ru.md")).not.toMatch(/без `questions` и без `nextFlow`/);
  });

  it("строка этапа Демонстрация в инструкциях агенту говорит то же", () => {
    const line = stageInstructions([{ ...builtinStage("demo", []), name: "Демонстрация" }]);
    expect(line).toMatch(/with an approval ahead a question about it goes in its own questions, not in a separate widget/);
  });
});
