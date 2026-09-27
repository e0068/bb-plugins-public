// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { contextFillOf, readContextFill } from "./context";

const usage = (usedTokens: unknown, modelContextWindow: unknown) => ({
  type: "thread/contextWindowUsage/updated",
  data: { providerThreadId: "s1", contextWindowUsage: { usedTokens, modelContextWindow, estimated: true } },
});

const sourceOf = (list: (args: unknown) => Promise<unknown[]>) => ({ threads: { events: { list } } }) as never;

describe("заполненность окна из журнала треда", () => {
  it("отдаёт долю, занятое и окно последнего события", async () => {
    const fill = await readContextFill(sourceOf(async () => [usage(163_000, 900_000)]), "thr_1");
    expect(fill).toEqual({ share: 163_000 / 900_000, usedTokens: 163_000, windowTokens: 900_000 });
  });

  it("спрашивает журнал за последним событием заполненности", async () => {
    const list = vi.fn(async () => [usage(1, 2)]);
    await readContextFill(sourceOf(list), "thr_1");
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ threadId: "thr_1", types: ["thread/contextWindowUsage/updated"], order: "desc" }));
  });

  it("события ещё нет — числа нет", async () => {
    expect(await readContextFill(sourceOf(async () => []), "thr_1")).toBeNull();
  });

  it("окно не названо — делить не на что", async () => {
    expect(await readContextFill(sourceOf(async () => [usage(100, null)]), "thr_1")).toBeNull();
    expect(await readContextFill(sourceOf(async () => [usage(100, 0)]), "thr_1")).toBeNull();
  });

  it("занятое не число — числа нет", async () => {
    expect(await readContextFill(sourceOf(async () => [usage("много", 900_000)]), "thr_1")).toBeNull();
  });

  it("журнал не прочитался — баннер работает как раньше, а не падает", async () => {
    const fill = await readContextFill(sourceOf(async () => { throw new Error("kv down"); }), "thr_1");
    expect(fill).toBeNull();
  });

  it("чужие строки журнала пропускаются", async () => {
    const rows = [{ type: "thread/identity", data: { providerThreadId: "s1" } }, usage(50, 100)];
    expect(await readContextFill(sourceOf(async () => rows), "thr_1")).toMatchObject({ share: 0.5 });
  });
});

describe("пороги полосы в токенах из настроек плагина", () => {
  const withSettings = (values: Record<string, unknown>) =>
    contextFillOf(sourceOf(async () => [usage(50, 100)]), async () => values, "thr_1");

  it("правка порога доезжает до ответа", async () => {
    expect(await withSettings({ contextWarnTokens: 120_000, contextAlertTokens: 550_000 })).toEqual({
      share: 0.5,
      usedTokens: 50,
      windowTokens: 100,
      warnTokens: 120_000,
      alertTokens: 550_000,
    });
  });

  it("настройка пуста — пороги по умолчанию", async () => {
    expect(await withSettings({})).toMatchObject({ warnTokens: 250_000, alertTokens: 400_000 });
  });

  it("проценты прошлой версии в хранилище не читаются — действуют умолчания", async () => {
    expect(await withSettings({ contextWarnPercent: 10, contextAlertPercent: 20 })).toMatchObject({ warnTokens: 250_000, alertTokens: 400_000 });
  });

  it("настройки не прочитались — пороги по умолчанию, а не отсутствие полосы", async () => {
    const fill = await contextFillOf(sourceOf(async () => [usage(50, 100)]), async () => { throw new Error("нет доступа"); }, "thr_1");
    expect(fill).toMatchObject({ share: 0.5, warnTokens: 250_000, alertTokens: 400_000 });
  });

  it("чисел нет — порогов не спрашиваем и полосы не будет", async () => {
    const asked = vi.fn(async () => ({}));
    expect(await contextFillOf(sourceOf(async () => []), asked, "thr_1")).toBeNull();
    expect(asked).not.toHaveBeenCalled();
  });

  it("перевёрнутая пара сбрасывается на умолчание, а не разворачивается", async () => {
    expect(await withSettings({ contextWarnTokens: 500_000, contextAlertTokens: 300_000 })).toMatchObject({ warnTokens: 250_000, alertTokens: 400_000 });
  });

  it("не число в пороге сбрасывает пару на умолчание", async () => {
    expect(await withSettings({ contextWarnTokens: "двести", contextAlertTokens: 400_000 })).toMatchObject({ warnTokens: 250_000, alertTokens: 400_000 });
  });
});
