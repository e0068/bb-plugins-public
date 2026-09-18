// @vitest-environment node
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import { stageLabel } from "./stages";

const names = { questions: "Вопросы", criteria: "Критерии", select: "Выбор этапов", demo: "Демонстрация" };

describe("подпись встроенного этапа", () => {
  it("имя по умолчанию — по языку интерфейса, переименованный владельцем — своим именем", () => {
    expect(stageLabel(builtinStage("demo", []), names)).toBe("Демонстрация");
    expect(stageLabel({ ...builtinStage("demo", []), name: "Показ заказчику" }, names)).toBe("Показ заказчику");
  });
});
