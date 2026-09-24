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

describe("пороги полосы из настроек плагина", () => {
  it("правка порога доезжает до ответа", async () => {
    const fill = await contextFillOf(sourceOf(async () => [usage(50, 100)]), async () => ({ contextWarnPercent: 12, contextAlertPercent: 55 }), "thr_1");
    expect(fill).toEqual({ share: 0.5, usedTokens: 50, windowTokens: 100, warnPercent: 12, alertPercent: 55 });
  });

  it("настройка пуста — пороги по умолчанию", async () => {
    const fill = await contextFillOf(sourceOf(async () => [usage(50, 100)]), async () => ({}), "thr_1");
    expect(fill).toMatchObject({ warnPercent: 25, alertPercent: 40 });
  });

  it("настройки не прочитались — пороги по умолчанию, а не отсутствие полосы", async () => {
    const fill = await contextFillOf(sourceOf(async () => [usage(50, 100)]), async () => { throw new Error("нет доступа"); }, "thr_1");
    expect(fill).toMatchObject({ share: 0.5, warnPercent: 25, alertPercent: 40 });
  });

  it("чисел нет — порогов не спрашиваем и полосы не будет", async () => {
    const asked = vi.fn(async () => ({}));
    expect(await contextFillOf(sourceOf(async () => []), asked, "thr_1")).toBeNull();
    expect(asked).not.toHaveBeenCalled();
  });
});

describe("бессмысленная пара порогов не доезжает до полосы", () => {
  const withSettings = (values: Record<string, unknown>) =>
    contextFillOf(sourceOf(async () => [usage(50, 100)]), async () => values, "thr_1");

  it("перевёрнутая пара сбрасывается на умолчание — подсказка и цвет говорят одно", async () => {
    expect(await withSettings({ contextWarnPercent: 40, contextAlertPercent: 25 })).toMatchObject({ warnPercent: 25, alertPercent: 40 });
  });

  it("порог за пределами шкалы сбрасывает пару на умолчание", async () => {
    expect(await withSettings({ contextWarnPercent: -10, contextAlertPercent: 300 })).toMatchObject({ warnPercent: 25, alertPercent: 40 });
  });

  it("не число в пороге сбрасывает пару на умолчание", async () => {
    expect(await withSettings({ contextWarnPercent: "двадцать", contextAlertPercent: 40 })).toMatchObject({ warnPercent: 25, alertPercent: 40 });
  });
});

describe("пара, записанная прошлой версией, не доезжает до полосы развёрнутой", () => {
  it("50 и 30 в хранилище — полоса по умолчанию, а не по 30 и 50", async () => {
    const fill = await contextFillOf(sourceOf(async () => [usage(50, 100)]), async () => ({ contextWarnPercent: 50, contextAlertPercent: 30 }), "thr_1");
    expect(fill).toMatchObject({ warnPercent: 25, alertPercent: 40 });
  });
});
