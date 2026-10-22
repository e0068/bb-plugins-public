import { describe, expect, it } from "vitest";
import { depsIncomplete } from "./plugin-homecoming";

/** Разобранный lock-файл npm v2/v3: пакеты под ключами `node_modules/…`. */
const lock = (packages: Record<string, { optional?: boolean }>) => ({ packages: { "": {}, ...packages } });

describe("установка без части пакетов ставится заново, даже если она свежее lock", () => {
  it("в установке нет пакета из lock — ставить", () =>
    expect(depsIncomplete(lock({ "node_modules/@get-bb/plugin-sdk": {}, "node_modules/react": {} }), lock({ "node_modules/react": {} }))).toBe(true));
  it("все пакеты lock на месте — не ставить", () =>
    expect(depsIncomplete(lock({ "node_modules/react": {} }), lock({ "node_modules/react": {} }))).toBe(false));
  it("необязательный пакет под чужую платформу не требуется", () =>
    expect(depsIncomplete(lock({ "node_modules/@esbuild/linux-x64": { optional: true } }), lock({}))).toBe(false));
  it("установки нет — ставить, lock нет — ставить нечем", () => {
    expect(depsIncomplete(lock({}), null)).toBe(true);
    expect(depsIncomplete(null, null)).toBe(false);
  });
});
