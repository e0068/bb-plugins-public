// @vitest-environment node
import { describe, expect, it } from "vitest";

import { flowSettingsSchema, type FlowSettings } from "../shared/contract";
import { limitFlow } from "./flows";
import { limitsOf } from "./skill-scope";

const settings: FlowSettings = {
  flows: [
    { id: "a", name: "A", stages: [] },
    { id: "b", name: "B", stages: [] },
  ],
  minButtonWidth: 120,
};

describe("переключатели ограничений flow", () => {
  it("flow без полей читается как раньше и ничего не ограничивает", () => {
    const parsed = flowSettingsSchema.parse(settings);
    expect(parsed.flows[0]).toEqual({ id: "a", name: "A", stages: [] });
    expect(limitsOf(parsed.flows[0]!)).toEqual({ skills: false, agents: false });
  });

  it("включённый переключатель сохраняется у своего flow, остальные flow не меняются", () => {
    const next = limitFlow(limitFlow(settings, "a", { limitSkills: true }), "a", { limitAgents: true });
    expect(flowSettingsSchema.parse(next).flows).toEqual([{ id: "a", name: "A", stages: [], limitSkills: true, limitAgents: true }, settings.flows[1]]);
    expect(limitsOf(next.flows[0]!)).toEqual({ skills: true, agents: true });
  });

  it("выключенный переключатель снимает поле, а не пишет false", () => {
    const next = limitFlow(limitFlow(settings, "a", { limitSkills: true, limitAgents: true }), "a", { limitSkills: false });
    expect(next.flows[0]).toEqual({ id: "a", name: "A", stages: [], limitAgents: true });
  });
});
