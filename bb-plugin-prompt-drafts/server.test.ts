// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { DRAFTS_CHANGED } from "./core/drafts";
import { CARD_TEXT_OPTIONS } from "./core/settings";
import plugin, { rpcContract } from "./server";

/**
 * Сервер проверяется через настоящие обработчики и схемы контракта. Хост
 * узкий: ровно те поверхности, которых касается `plugin(bb)` — настройки, kv,
 * rpc и realtime. Ответ каждого вызова проходит выходную схему, как у хоста.
 */
type Handlers = Record<string, (input: unknown) => Promise<unknown>>;

async function boot(stored: Record<string, unknown> = {}) {
  const kv = new Map<string, unknown>(Object.entries(stored));
  const published: string[] = [];
  let handlers: Handlers = {};
  let descriptors: Record<string, { type: string; label: string; description?: string; default: unknown; options?: readonly string[] }> = {};
  const bb = {
    settings: {
      define: (declared: typeof descriptors) => {
        descriptors = declared;
        return { get: async () => ({}) };
      },
    },
    storage: {
      kv: {
        get: async (key: string) => kv.get(key),
        set: async (key: string, value: unknown) => void kv.set(key, JSON.parse(JSON.stringify(value))),
      },
    },
    rpc: { register: (_contract: unknown, registered: Handlers) => void (handlers = registered) },
    realtime: { publish: (channel: string) => void published.push(channel) },
  };
  await plugin(bb as never);

  const call = async <M extends keyof typeof rpcContract>(
    method: M,
    input: unknown,
  ): Promise<z.infer<(typeof rpcContract)[M]["output"]>> => {
    const contract = rpcContract[method];
    const output = await handlers[method]!(contract.input.parse(input));
    return contract.output.parse(output) as z.infer<(typeof rpcContract)[M]["output"]>;
  };
  return { call, kv, published, descriptors: () => descriptors };
}

const HOME = { threadId: null, threadTitle: null, projectId: "p_1", projectName: "bb-plugins", worktree: null, branch: null };
const THREAD = { ...HOME, threadId: "thr_1", threadTitle: "Тред", worktree: "thr_k2", branch: "bb/x" };

describe("хранилище черновиков", () => {
  it("без записей список пуст", async () => {
    const { call } = await boot();
    expect(await call("list", null)).toEqual({ drafts: [] });
  });

  it("сохранённый черновик возвращается первым, с текстом и местом как есть", async () => {
    const { call } = await boot();
    await call("save", { text: "первый", place: HOME });
    const { draft } = await call("save", { text: "**второй**\n- пункт", place: THREAD });
    const { drafts } = await call("list", null);
    expect(drafts.map((item) => item.text)).toEqual(["**второй**\n- пункт", "первый"]);
    expect(drafts[0]).toEqual(draft);
    expect(draft.place).toEqual(THREAD);
  });

  it("пустой текст не сохраняется", async () => {
    const { call } = await boot();
    await expect(call("save", { text: "  \n ", place: HOME })).rejects.toThrow();
  });

  it("обмен снимает черновик и ставит на его место текст композера", async () => {
    const { call } = await boot();
    const a = (await call("save", { text: "a", place: HOME })).draft;
    const b = (await call("save", { text: "b", place: HOME })).draft;
    const { taken } = await call("swap", { takeId: a.id, put: { text: "из композера", place: THREAD } });
    expect(taken).toEqual(a);
    const { drafts } = await call("list", null);
    expect(drafts.map((item) => item.text)).toEqual(["b", "из композера"]);
    expect(drafts[0]).toEqual(b);
  });

  it("обмен без текста композера просто снимает черновик; неизвестный id ничего не снимает", async () => {
    const { call } = await boot();
    const a = (await call("save", { text: "a", place: HOME })).draft;
    expect((await call("swap", { takeId: "zz", put: null })).taken).toBeNull();
    expect((await call("swap", { takeId: a.id, put: null })).taken).toEqual(a);
    expect(await call("list", null)).toEqual({ drafts: [] });
  });

  it("удаление убирает черновик без отправки", async () => {
    const { call } = await boot();
    const a = (await call("save", { text: "a", place: HOME })).draft;
    await call("remove", { id: a.id });
    expect(await call("list", null)).toEqual({ drafts: [] });
  });

  it("каждое изменение публикует сигнал, чтение — нет", async () => {
    const { call, published } = await boot();
    const a = (await call("save", { text: "a", place: HOME })).draft;
    await call("list", null);
    await call("swap", { takeId: a.id, put: null });
    await call("remove", { id: "zz" });
    expect(published).toEqual([DRAFTS_CHANGED, DRAFTS_CHANGED]);
  });

  it("битые записи в хранилище отбрасываются при чтении", async () => {
    const good = { id: "d1", text: "ok", createdAt: 1, place: HOME };
    const { call } = await boot({ drafts: [good, { id: 5 }, "мусор", { ...good, id: "d2", place: null }] });
    expect(await call("list", null)).toEqual({ drafts: [good] });
  });

  it("не массив в хранилище читается как пустой список", async () => {
    const { call } = await boot({ drafts: { broken: true } });
    expect(await call("list", null)).toEqual({ drafts: [] });
  });
});

describe("скрытый слот автосохранения", () => {
  /** Перезапуск bb: то же хранилище, новый запуск бэкенда. */
  const restart = (booted: Awaited<ReturnType<typeof boot>>) => boot(Object.fromEntries(booted.kv));

  it("набранное уходит в слот и в списке не видно, пока bb жив", async () => {
    const { call, published } = await boot();
    await call("autosave", { text: "набираю дли", place: THREAD });
    await call("autosave", { text: "набираю длинный запрос", place: THREAD });
    expect(await call("list", null)).toEqual({ drafts: [] });
    expect(published).toEqual([]);
  });

  it("слот пережившего вылет запуска всплывает карточкой с местом и пометкой auto", async () => {
    const first = await boot();
    await first.call("autosave", { text: "набранное перед вылетом", place: THREAD });
    const second = await restart(first);
    const { drafts } = await second.call("list", null);
    expect(drafts.map((item) => item.text)).toEqual(["набранное перед вылетом"]);
    expect(drafts[0]).toMatchObject({ place: THREAD, auto: true });
    expect(second.published).toEqual([DRAFTS_CHANGED]);
  });

  it("опустевший композер гасит слот — после перезапуска всплывать нечему", async () => {
    const first = await boot();
    await first.call("autosave", { text: "ушло в отправку", place: THREAD });
    await first.call("autosave", { text: "", place: THREAD });
    const second = await restart(first);
    expect(await second.call("list", null)).toEqual({ drafts: [] });
    expect(second.published).toEqual([]);
  });

  it("у каждого композера свой слот, и всплывают они оба", async () => {
    const first = await boot();
    await first.call("autosave", { text: "в треде", place: THREAD });
    await first.call("autosave", { text: "на Home", place: HOME });
    const second = await restart(first);
    expect((await second.call("list", null)).drafts.map((item) => item.text).sort()).toEqual(["в треде", "на Home"]);
  });

  it("композер забирает свою всплывшую карточку, когда bb вернул в него тот же текст", async () => {
    const first = await boot();
    await first.call("autosave", { text: "вернулось само", place: THREAD });
    const second = await restart(first);
    expect((await second.call("list", null)).drafts).toHaveLength(1);
    await second.call("autosave", { text: "вернулось само", place: THREAD });
    expect(await second.call("list", null)).toEqual({ drafts: [] });
    expect(second.published).toEqual([DRAFTS_CHANGED, DRAFTS_CHANGED]);
  });

  it("карточку, сохранённую рукой, автосохранение не забирает", async () => {
    const { call } = await boot();
    const { draft } = await call("save", { text: "отложил рукой", place: THREAD });
    await call("autosave", { text: "отложил рукой", place: THREAD });
    expect((await call("list", null)).drafts).toEqual([draft]);
  });

  it("всплывшая карточка удаляется и отправляется как обычная", async () => {
    const first = await boot();
    await first.call("autosave", { text: "всплывшее", place: HOME });
    const second = await restart(first);
    const [surfaced] = (await second.call("list", null)).drafts;
    expect((await second.call("swap", { takeId: surfaced!.id, put: null })).taken).toMatchObject({ text: "всплывшее" });
    expect(await second.call("list", null)).toEqual({ drafts: [] });
  });

  it("одна битая запись не уносит слоты остальных композеров", async () => {
    const alive = { text: "цел", place: HOME, savedAt: 5, session: "прошлый запуск" };
    const { call } = await boot({ autosave: { "home:p_1": alive, "thread:thr_1": "мусор" } });
    expect((await call("list", null)).drafts.map((item) => item.text)).toEqual(["цел"]);
  });

  it("мусор вместо карты слотов читается как пустая карта", async () => {
    const { call } = await boot({ autosave: [1, 2, 3] });
    expect(await call("list", null)).toEqual({ drafts: [] });
  });
});

describe("настройки", () => {
  it("объявлены автосохранение с умолчанием true и размер текста карточки списком вариантов", async () => {
    const { descriptors } = await boot();
    const declared = descriptors();
    expect(declared.autosave).toMatchObject({ type: "boolean", default: true, label: "Autosave drafts" });
    expect(declared.autosave?.description).toMatch(/Drafts/);
    expect(declared.cardTextSize).toMatchObject({ type: "select", default: CARD_TEXT_OPTIONS[0] });
    expect(declared.cardTextSize?.options).toEqual([...CARD_TEXT_OPTIONS]);
  });

  it("объявлены строки, ширина и показ в тредах с умолчаниями 6, 240 и true", async () => {
    const { descriptors } = await boot();
    const declared = descriptors();
    expect(declared.cardLines).toMatchObject({ type: "number", default: 6 });
    expect(declared.cardWidth).toMatchObject({ type: "number", default: 240 });
    expect(declared.showInThreads).toMatchObject({ type: "boolean", default: true, label: "Show drafts in threads" });
    expect(declared.showInThreads?.description).toMatch(/Home/);
  });
});

describe("очередь записей", () => {
  it("одновременные сохранения и обмены не теряют ни одной записи", async () => {
    const { call } = await boot();
    const seeded = await Promise.all(Array.from({ length: 5 }, (_, index) => call("save", { text: `s${index}`, place: HOME })));
    await Promise.all([
      ...Array.from({ length: 5 }, (_, index) => call("save", { text: `p${index}`, place: HOME })),
      ...seeded.map(({ draft }, index) => call("swap", { takeId: draft.id, put: { text: `w${index}`, place: HOME } })),
    ]);
    const texts = (await call("list", null)).drafts.map((item) => item.text).sort();
    expect(texts).toEqual(["p0", "p1", "p2", "p3", "p4", "w0", "w1", "w2", "w3", "w4"]);
  });

  it("сбой записи в хранилище не останавливает следующие вызовы", async () => {
    const booted = await boot();
    const failing = booted.kv;
    const original = failing.set.bind(failing);
    let failOnce = true;
    failing.set = (key: string, value: unknown) => {
      if (key === "drafts" && failOnce) {
        failOnce = false;
        throw new Error("disk full");
      }
      return original(key, value);
    };
    await expect(booted.call("save", { text: "a", place: HOME })).rejects.toThrow(/disk full/);
    await booted.call("save", { text: "b", place: HOME });
    expect((await booted.call("list", null)).drafts.map((item) => item.text)).toEqual(["b"]);
  });

  it("записи, которые текущая версия не понимает, переживают правку списка", async () => {
    const future = { id: "f1", text: "из новой версии", createdAt: 1, place: { kind: "somewhere" } };
    const { call, kv } = await boot({ drafts: [future] });
    await call("save", { text: "a", place: HOME });
    expect(kv.get("drafts")).toContainEqual(future);
  });
});
