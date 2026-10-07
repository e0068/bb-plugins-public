// @vitest-environment node
// Ключ владельца с тем же именем, что Flow спрятал бы, — его ключ: Flow его не присваивает и не снимает.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { mergeLocalSettings, NOTHING_HIDDEN, withoutOwnerKeys, type Hidden } from "./skill-scope";

describe("ключи владельца в файле настроек", () => {
  it("имя, которое владелец уже поставил сам, Flow не пишет и потом не снимает", () => {
    const owner = { skillOverrides: { plan: "name-only" }, permissions: { deny: ["Agent(scout)"] }, enabledPlugins: { "sales@m": true } };
    const wanted: Hidden = { skills: ["plan", "spec"], agents: ["scout", "Explore"], plugins: ["sales@m", "x@m"] };
    const hidden = withoutOwnerKeys(owner, NOTHING_HIDDEN, wanted);
    expect(hidden).toEqual({ skills: ["spec"], agents: ["Explore"], plugins: ["x@m"] });
    expect(mergeLocalSettings(mergeLocalSettings(owner, NOTHING_HIDDEN, hidden), hidden, NOTHING_HIDDEN)).toEqual(owner);
  });

  it("своя прошлая запись остаётся своей", () => {
    const written: Hidden = { skills: ["plan"], agents: ["scout"], plugins: ["x@m"] };
    const file = mergeLocalSettings({}, NOTHING_HIDDEN, written);
    expect(withoutOwnerKeys(file, written, written)).toEqual(written);
  });

  it("ключи владельца переживают любые записи Flow, даже с теми же именами", () => {
    const hiddenArb = fc.record({ skills: fc.subarray(["a", "b", "mine"]), agents: fc.subarray(["x", "scout"]), plugins: fc.subarray(["p@m", "own@m"]) });
    const owner = { skillOverrides: { mine: "name-only" }, permissions: { deny: ["Agent(scout)"] }, enabledPlugins: { "own@m": true } };
    fc.assert(
      fc.property(fc.array(hiddenArb, { maxLength: 5 }), (wanted) => {
        const [last, file] = wanted.reduce<[Hidden, Record<string, unknown>]>(([previous, acc], next) => {
          const hidden = withoutOwnerKeys(acc, previous, next);
          return [hidden, mergeLocalSettings(acc, previous, hidden)];
        }, [NOTHING_HIDDEN, owner]);
        expect(mergeLocalSettings(file, last, NOTHING_HIDDEN)).toEqual(owner);
      }),
    );
  });
});
