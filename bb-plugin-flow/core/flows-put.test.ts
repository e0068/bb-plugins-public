// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { FlowSettings } from "../shared/contract";
import { newFlow, putFlow } from "./flows";

const settingsOf = (ids: readonly string[]): FlowSettings => ({ flows: ids.map((id) => newFlow(id, id.toUpperCase())), minButtonWidth: 170, version: 2 });

const uniqueIds = fc.uniqueArray(fc.stringMatching(/^[a-z]{1,6}$/), { minLength: 1, maxLength: 6 });

describe("putFlow", () => {
  it("новый flow без позиции встаёт в конец, с позицией 0 — первым", () => {
    const settings = settingsOf(["bug", "code"]);
    const general = newFlow("general", "General");
    expect(putFlow(settings, general).flows.map((f) => f.id)).toEqual(["bug", "code", "general"]);
    expect(putFlow(settings, general, 0).flows.map((f) => f.id)).toEqual(["general", "bug", "code"]);
  });

  it("позиция за концом списка — в конец", () => {
    expect(putFlow(settingsOf(["bug"]), newFlow("general", "General"), 99).flows.map((f) => f.id)).toEqual(["bug", "general"]);
  });

  it("flow с тем же id заменяется на своём месте, а с позицией — переезжает", () => {
    const settings = settingsOf(["bug", "code", "docs"]);
    const renamed = { ...newFlow("code", "Code v2"), stages: [] };
    expect(putFlow(settings, renamed).flows.map((f) => [f.id, f.name])).toEqual([["bug", "BUG"], ["code", "Code v2"], ["docs", "DOCS"]]);
    expect(putFlow(settings, renamed, 0).flows.map((f) => f.id)).toEqual(["code", "bug", "docs"]);
  });

  it("остальные flow и общая ширина кнопки не меняются, число flow растёт только у нового", () => {
    fc.assert(
      fc.property(uniqueIds, fc.stringMatching(/^[a-z]{1,6}$/), fc.option(fc.nat(8), { nil: undefined }), (ids, id, position) => {
        const settings = settingsOf(ids);
        const next = putFlow(settings, newFlow(id, "Put"), position);
        expect(next.minButtonWidth).toBe(settings.minButtonWidth);
        expect(next.flows.length).toBe(settings.flows.length + (ids.includes(id) ? 0 : 1));
        expect(next.flows.filter((f) => f.id !== id)).toEqual(settings.flows.filter((f) => f.id !== id));
        expect(next.flows.filter((f) => f.id === id)).toEqual([newFlow(id, "Put")]);
      }),
    );
  });
});
