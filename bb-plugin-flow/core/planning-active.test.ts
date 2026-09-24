// @vitest-environment node
import { describe, expect, it } from "vitest";

import { activeMinutes } from "./planning";

const at = (timestamp: string) => JSON.stringify({ type: "assistant", timestamp, requestId: "r", message: { id: "m" } });

const FROM = Date.parse("2026-09-16T10:00:00.000Z");
const TO = Date.parse("2026-09-16T10:20:00.000Z");

describe("активные минуты окна", () => {
  it("две записи одной минуты дают одну минуту", () => {
    expect(activeMinutes([at("2026-09-16T10:00:01.000Z"), at("2026-09-16T10:00:59.000Z")], FROM, TO)).toBe(1);
  });

  it("записи соседних минут считаются по разу каждая", () => {
    expect(activeMinutes([at("2026-09-16T10:00:10.000Z"), at("2026-09-16T10:01:10.000Z"), at("2026-09-16T10:02:10.000Z")], FROM, TO)).toBe(3);
  });

  it("простой между записями в минуты не идёт", () => {
    expect(activeMinutes([at("2026-09-16T10:00:00.000Z"), at("2026-09-16T10:19:00.000Z")], FROM, TO)).toBe(2);
  });

  it("записи вне окна не считаются", () => {
    expect(activeMinutes([at("2026-09-16T09:59:00.000Z"), at("2026-09-16T10:20:00.000Z"), at("2026-09-16T10:05:00.000Z")], FROM, TO)).toBe(1);
  });

  it("строка без отметки времени и мусор пропускаются", () => {
    expect(activeMinutes(["не json", JSON.stringify({ type: "assistant" }), at("2026-09-16T10:05:00.000Z")], FROM, TO)).toBe(1);
  });

  it("окно без записей — ноль", () => {
    expect(activeMinutes([], FROM, TO)).toBe(0);
  });
});
