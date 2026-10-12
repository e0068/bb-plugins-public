// @vitest-environment node
// Откуда слот Flow берёт содержимое левой панели: список flow, `Original` от хоста, встроенный список bb или запасной.
import { describe, expect, it } from "vitest";

import { chooseThreadListSource, type BuiltinListStatus, type ThreadListSource } from "./thread-list-source";

type Case = { subPath: string | null; enabled: boolean; hostOriginal: boolean; builtin: BuiltinListStatus; expected: ThreadListSource };

const cases: readonly Case[] = [
  { subPath: "quick", enabled: true, hostOriginal: false, builtin: "loading", expected: { kind: "flows", subPath: "quick" } },
  { subPath: "", enabled: true, hostOriginal: true, builtin: "ready", expected: { kind: "flows", subPath: "" } },
  { subPath: "quick", enabled: false, hostOriginal: false, builtin: "ready", expected: { kind: "builtin" } },
  { subPath: null, enabled: true, hostOriginal: false, builtin: "ready", expected: { kind: "builtin" } },
  { subPath: null, enabled: false, hostOriginal: true, builtin: "ready", expected: { kind: "original" } },
  { subPath: null, enabled: true, hostOriginal: true, builtin: "failed", expected: { kind: "original" } },
  { subPath: null, enabled: true, hostOriginal: false, builtin: "loading", expected: { kind: "pending" } },
  { subPath: null, enabled: true, hostOriginal: false, builtin: "failed", expected: { kind: "fallback" } },
  { subPath: "quick", enabled: false, hostOriginal: false, builtin: "failed", expected: { kind: "fallback" } },
];

describe("chooseThreadListSource", () => {
  it.each(cases)(
    "хвост адреса Flow: $subPath, настройка: $enabled, Original от хоста: $hostOriginal, встроенный список: $builtin → $expected",
    ({ expected, ...input }) => {
      expect(chooseThreadListSource(input)).toEqual(expected);
    },
  );
});
