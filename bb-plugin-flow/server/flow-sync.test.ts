// @vitest-environment node
// Синхронизация flow с папкой на диске: запись после сохранения, подхват
// чужой правки, битая папка не трогает локальные flow, первая встреча с
// папкой ничего не теряет. Папка — временный каталог.
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import type { FlowSettings, WorkStage } from "../shared/contract";
import { createFlowSettings, FLOW_SETTINGS_KEY } from "./flow-settings";
import { createFlowSync, DEFAULT_SYNC_DIR, defaultSyncDir } from "./flow-sync";

const homes: string[] = [];
afterEach(async () => Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true }))));

const skill = (id: string): WorkStage => ({ id, kind: "skill", skill: "code", name: id, executors: [] });
const nested = (id: string, flowId: string): WorkStage => ({ id, kind: "skill", skill: "", name: "Nested", executors: [], flowId });
const collection = (flows: FlowSettings["flows"]): FlowSettings => ({ version: 2, flows, minButtonWidth: 170 });
const local = collection([
  { id: "flow-code", name: "Code", stages: [skill("work"), nested("review-row", "flow-review")] },
  { id: "flow-review", name: "Review", stages: [skill("check")] },
]);

const setup = async (stored: FlowSettings = local) => {
  const home = await mkdtemp(join(tmpdir(), "flow-sync-"));
  homes.push(home);
  const { bb } = createFakePluginHost({ pluginId: "flow" });
  await bb.storage.kv.set(FLOW_SETTINGS_KEY, stored);
  const flows = await createFlowSettings(bb.storage.kv);
  const published: string[] = [];
  const sync = await createFlowSync({
    kv: bb.storage.kv,
    flows,
    home,
    now: () => new Date("2026-10-05T12:00:00.000Z"),
    published: (what) => published.push(what),
  });
  const dir = join(home, ".claude", "BB Flows");
  return { home, dir, kv: bb.storage.kv, flows, sync, published };
};

const tree = async (dir: string): Promise<string[]> =>
  (await readdir(dir, { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name).slice(dir.length + 1)).sort();

const names = (settings: FlowSettings) => settings.flows.map((f) => f.name);

describe("папка синхронизации по умолчанию", () => {
  it("— BB Flows в папке ~/.claude, которую уже возит Syncthing", async () => {
    const { sync } = await setup();
    expect(DEFAULT_SYNC_DIR).toBe("~/.claude/BB Flows");
    expect(sync.state()).toEqual({ dir: "~/.claude/BB Flows", status: { kind: "pending" } });
  });
});

describe("первая встреча с папкой", () => {
  it("папки нет — Flow пишет туда локальную коллекцию раскладкой по ссылкам", async () => {
    const { sync, dir } = await setup();
    await sync.tick();
    expect(await tree(dir)).toEqual(["Code.flow.json", "Review/Review.flow.json", "settings.json"]);
    expect(sync.state().status).toEqual({ kind: "synced", at: "2026-10-05T12:00:00.000Z" });
  });

  it("в папке уже есть flow — коллекция из папки, а локальные flow с новыми именами дописываются и уезжают в папку", async () => {
    const other = await setup(collection([{ id: "x-bug", name: "Bug", stages: [skill("fix")] }, { id: "x-code", name: "Code", stages: [skill("from-other")] }]));
    await other.sync.tick();
    const { sync, flows, dir, home } = await setup();
    await rm(dir, { recursive: true, force: true });
    await mkdir(join(home, ".claude"), { recursive: true });
    await import("node:fs/promises").then((fs) => fs.cp(other.dir, dir, { recursive: true }));
    await sync.tick();
    expect(names(flows.current())).toEqual(["Bug", "Code", "Review"]);
    expect(flows.current().flows.find((f) => f.name === "Code")!.id).toBe("flow-code");
    expect(flows.current().flows.find((f) => f.name === "Code")!.stages.map((s) => s.id)).toEqual(["from-other"]);
    expect(await tree(dir)).toEqual(["Bug.flow.json", "Code.flow.json", "Review.flow.json", "settings.json"]);
  });
});

describe("после первой встречи", () => {
  it("сохранение коллекции переписывает папку: новый flow — новый файл, удалённый — файл убран, чужие файлы целы", async () => {
    const { sync, flows, dir } = await setup();
    await sync.tick();
    await writeFile(join(dir, "README.md"), "мой файл\n");
    await flows.save(collection([{ id: "flow-code", name: "Code", stages: [skill("work")] }, { id: "flow-bug", name: "Bug", stages: [skill("fix")] }]));
    await sync.idle();
    expect(await tree(dir)).toEqual(["Bug.flow.json", "Code.flow.json", "README.md", "settings.json"]);
  });

  it("Syncthing привёз правку — коллекция подхватывается, открытые вкладки узнают об этом", async () => {
    const { sync, flows, dir, published } = await setup();
    await sync.tick();
    const file = JSON.parse(await readFile(join(dir, "Review/Review.flow.json"), "utf8"));
    await writeFile(join(dir, "Review/Review.flow.json"), JSON.stringify({ ...file, description: "с другого компа" }));
    await sync.tick();
    expect(flows.current().flows.find((f) => f.name === "Review")!.description).toBe("с другого компа");
    expect(published).toContain("flows");
  });

  it("своя же запись не перечитывается и не пересохраняется", async () => {
    const { sync, flows } = await setup();
    await sync.tick();
    let saves = 0;
    flows.onSaved(() => saves++);
    await sync.tick();
    await sync.tick();
    expect(saves).toBe(0);
  });

  it("битый файл не трогает локальные flow, ошибка с путём видна, починенный файл подхватывается", async () => {
    const { sync, flows, dir } = await setup();
    await sync.tick();
    const before = flows.current();
    await writeFile(join(dir, "Code.flow.json"), "{ недописано");
    await sync.tick();
    expect(flows.current()).toBe(before);
    expect(sync.state().status).toEqual({ kind: "error", message: expect.stringContaining("Code.flow.json"), at: "2026-10-05T12:00:00.000Z" });
    await writeFile(join(dir, "Code.flow.json"), JSON.stringify({ name: "Code", stages: [skill("fixed")] }));
    await sync.tick();
    expect(flows.current().flows.find((f) => f.name === "Code")!.stages.map((s) => s.id)).toEqual(["fixed"]);
    expect(sync.state().status.kind).toBe("synced");
  });

  it("недоехавший flow, на который ссылаются, — ошибка, локальные flow целы", async () => {
    const { sync, flows, dir } = await setup();
    await sync.tick();
    const before = flows.current();
    await rm(join(dir, "Review"), { recursive: true });
    await sync.tick();
    expect(flows.current()).toBe(before);
    expect(sync.state().status).toEqual({ kind: "error", message: expect.stringContaining("Review"), at: expect.any(String) });
  });

  it("файл, не прошедший схему коллекции, — ошибка, локальные flow целы", async () => {
    const { sync, flows, dir } = await setup();
    await sync.tick();
    const before = flows.current();
    await writeFile(join(dir, "Code.flow.json"), JSON.stringify({ name: "Code", stages: [{ id: "x", kind: "nonsense" }] }));
    await sync.tick();
    expect(flows.current()).toBe(before);
    expect(sync.state().status.kind).toBe("error");
  });

  it("копии конфликтов и временные файлы Syncthing не читаются", async () => {
    const { sync, flows, dir } = await setup();
    await sync.tick();
    const before = flows.current();
    await writeFile(join(dir, "Code.sync-conflict-20261005-120000-ABCDEFG.flow.json"), JSON.stringify({ name: "Code", stages: [skill("conflict")] }));
    await writeFile(join(dir, ".syncthing.Code.flow.json.tmp"), "{ полфайла");
    await mkdir(join(dir, ".stversions"), { recursive: true });
    await writeFile(join(dir, ".stversions", "Old.flow.json"), JSON.stringify({ name: "Old", stages: [] }));
    await sync.tick();
    expect(flows.current()).toBe(before);
    expect(sync.state().status.kind).toBe("synced");
  });
});

describe("папка из настройки", () => {
  it("пустая папка выключает синхронизацию: сохранения файлов не пишут", async () => {
    const { sync, flows, home } = await setup();
    expect(await sync.setDir("")).toEqual({ dir: "", status: { kind: "off" } });
    await flows.save(collection([{ id: "flow-code", name: "Code", stages: [skill("work")] }]));
    await sync.idle();
    await expect(readdir(join(home, ".claude", "BB Flows"))).rejects.toThrow();
  });

  it("новая папка — первая встреча с ней: туда пишется коллекция, о смене узнают вкладки", async () => {
    const { sync, home, published } = await setup();
    const state = await sync.setDir("~/Sync/Flows");
    expect(state).toEqual({ dir: "~/Sync/Flows", status: { kind: "synced", at: expect.any(String) } });
    expect(await tree(join(home, "Sync", "Flows"))).toContain("Code.flow.json");
    expect(published).toContain("sync");
  });

  it("папка помнится между запусками", async () => {
    const first = await setup();
    await first.sync.setDir("~/Elsewhere");
    const again = await createFlowSync({ kv: first.kv, flows: first.flows, home: first.home, now: () => new Date(), published: () => undefined });
    expect(again.state().dir).toBe("~/Elsewhere");
  });
});

describe("папка по умолчанию из окружения", () => {
  it("BB_FLOW_SYNC_DIR задаёт папку, пустая — выключает, без неё — ~/.claude/BB Flows", () => {
    expect(defaultSyncDir({ BB_FLOW_SYNC_DIR: "~/Flows" })).toBe("~/Flows");
    expect(defaultSyncDir({ BB_FLOW_SYNC_DIR: "" })).toBe("");
    expect(defaultSyncDir({})).toBe("~/.claude/BB Flows");
  });
});

describe("своя запись не затирает привезённое другим компом", () => {
  const withDescription = (settings: FlowSettings, name: string, description: string): FlowSettings => ({ ...settings, flows: settings.flows.map((f) => (f.name === name ? { ...f, description } : f)) });

  it("Syncthing привёз новый flow и правку, а страница сохранила до опроса — всё на месте и в папке, и в коллекции", async () => {
    const { sync, flows, dir } = await setup();
    await sync.tick();
    await writeFile(join(dir, "Bug.flow.json"), JSON.stringify({ name: "Bug", stages: [skill("fix")] }));
    const review = JSON.parse(await readFile(join(dir, "Review/Review.flow.json"), "utf8"));
    await writeFile(join(dir, "Review/Review.flow.json"), JSON.stringify({ ...review, description: "с другого компа" }));
    await flows.save(withDescription(flows.current(), "Code", "своя правка"));
    await sync.idle();
    await sync.tick();
    expect(names(flows.current())).toContain("Bug");
    expect(flows.current().flows.find((f) => f.name === "Review")!.description).toBe("с другого компа");
    expect(flows.current().flows.find((f) => f.name === "Code")!.description).toBe("своя правка");
    expect(await tree(dir)).toContain("Bug.flow.json");
  });

  it("папка в ошибке — сохранение со страницы не убирает недоехавший flow", async () => {
    const { sync, flows, dir } = await setup();
    await sync.tick();
    await writeFile(join(dir, "New.flow.json"), JSON.stringify({ name: "New", stages: [{ ...skill("x"), flow: "Missing" }] }));
    await sync.tick();
    expect(sync.state().status.kind).toBe("error");
    await flows.save(withDescription(flows.current(), "Code", "своя правка"));
    await sync.idle();
    expect(await tree(dir)).toContain("New.flow.json");
  });

  it("последняя сверка помнится между запусками: чужой файл, приехавший до первого опроса, не убирается", async () => {
    const first = await setup();
    await first.sync.tick();
    const again = await createFlowSync({ kv: first.kv, flows: first.flows, home: first.home, now: () => new Date(), published: () => undefined });
    await writeFile(join(first.dir, "Bug.flow.json"), JSON.stringify({ name: "Bug", stages: [skill("fix")] }));
    await first.flows.save(withDescription(first.flows.current(), "Code", "своя правка"));
    await again.idle();
    await first.sync.idle();
    expect(await tree(first.dir)).toContain("Bug.flow.json");
  });

  it("переименование только регистром не теряет flow", async () => {
    const { sync, flows, dir } = await setup(collection([{ id: "flow-code", name: "code", stages: [skill("work")] }]));
    await sync.tick();
    await flows.save(collection([{ id: "flow-code", name: "Code", stages: [skill("work")] }]));
    await sync.idle();
    await sync.tick();
    expect(names(flows.current())).toEqual(["Code"]);
    expect((await tree(dir)).filter((p) => p.endsWith(".flow.json"))).toEqual(["Code.flow.json"]);
  });
});

describe("чужая папка", () => {
  it("папка со своим settings.json не становится папкой Flow: файл цел, пустые папки целы, ошибка видна", async () => {
    const { sync, home } = await setup();
    const foreign = join(home, "project");
    await mkdir(join(foreign, "src"), { recursive: true });
    await writeFile(join(foreign, "settings.json"), '{"theme":"dark"}');
    const state = await sync.setDir("~/project");
    expect(state.status.kind).toBe("error");
    expect(await readFile(join(foreign, "settings.json"), "utf8")).toBe('{"theme":"dark"}');
    expect(await readdir(foreign)).toEqual(["settings.json", "src"]);
  });

  it("относительный путь, домашняя папка и корень диска не принимаются, папка остаётся прежней", async () => {
    const { sync } = await setup();
    for (const bad of ["flows", "~", "/"]) {
      const state = await sync.setDir(bad);
      expect(state.dir).toBe("~/.claude/BB Flows");
      expect(state.status.kind).toBe("error");
    }
  });

  it("битая папка при первой встрече не дёргает вкладки на каждом опросе", async () => {
    const { sync, dir, published } = await setup();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "Code.flow.json"), "{ полфайла");
    await sync.tick();
    const after = published.length;
    await sync.tick();
    await sync.tick();
    expect(published.length).toBe(after);
  });
});

describe("после перезапуска bb", () => {
  it("папка совпадает с последней сверкой — итог «синхронизировано», а не вечное «сверяю»", async () => {
    const first = await setup();
    await first.sync.tick();
    const again = await createFlowSync({ kv: first.kv, flows: first.flows, home: first.home, now: () => new Date("2026-10-05T13:00:00.000Z"), published: () => undefined });
    await again.tick();
    expect(again.state().status).toEqual({ kind: "synced", at: "2026-10-05T13:00:00.000Z" });
  });
});
