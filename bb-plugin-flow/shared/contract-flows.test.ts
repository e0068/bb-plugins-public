// @vitest-environment node
import { describe, expect, it } from "vitest";

import { askDecisionParamsSchema, flowPickerRpcContract, flowSettingsRpcContract, flowSettingsSchema } from "./contract";

const stage = { id: "plan", skill: "plan", name: "План", review: false, executors: [] };
const flow = (id: string, stages: unknown[] = [stage]) => ({ id, name: `Flow ${id}`, stages });
const settings = (flows: unknown[]) => ({ flows, minButtonWidth: 170 });

describe("коллекция flow в схемах", () => {
  it("коллекция из нескольких flow со своими этапами принимается", () => {
    expect(flowSettingsSchema.safeParse(settings([flow("default"), flow("quick", [])])).success).toBe(true);
  });

  it("коллекция без flow не принимается", () => {
    expect(flowSettingsSchema.safeParse(settings([])).success).toBe(false);
  });

  it("повтор id flow не принимается", () => {
    expect(flowSettingsSchema.safeParse(settings([flow("a"), flow("a")])).success).toBe(false);
  });

  it("повтор id этапа внутри flow не принимается, пустое имя flow — тоже", () => {
    expect(flowSettingsSchema.safeParse(settings([flow("a", [stage, stage])])).success).toBe(false);
    expect(flowSettingsSchema.safeParse(settings([{ ...flow("a"), name: "  " }])).success).toBe(false);
  });

  it("RPC страницы flow читает и пишет коллекцию целиком", () => {
    const valid = settings([flow("default")]);
    expect(flowSettingsRpcContract.saveFlowSettings.input.safeParse(valid).success).toBe(true);
    expect(flowSettingsRpcContract.getFlowSettings.output.safeParse(valid).success).toBe(true);
  });

  it("RPC выбора flow в композере: список flow и выбранный, запись — проект и flow", () => {
    expect(flowPickerRpcContract.getFlowChoice.input.safeParse({ projectId: "proj_1" }).success).toBe(true);
    expect(flowPickerRpcContract.getFlowChoice.output.safeParse({ flows: [{ id: "default", name: "Default" }], selected: "default" }).success).toBe(true);
    expect(flowPickerRpcContract.setFlowChoice.input.safeParse({ projectId: "proj_1", flowId: "quick" }).success).toBe(true);
    expect(flowPickerRpcContract.setFlowChoice.input.safeParse({ projectId: "proj_1", flowId: "" }).success).toBe(false);
  });
});

describe("встроенные этапы в отчёте брифа", () => {
  const params = (stages: unknown[]) => ({ title: "Этапы", setup: { stages } });

  it("сделанный встроенный этап без ссылок принимается", () => {
    expect(askDecisionParamsSchema.safeParse(params([{ id: "clarify", state: "done" }, { id: "criteria", state: "done" }])).success).toBe(true);
  });

});
