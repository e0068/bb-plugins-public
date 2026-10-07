// @vitest-environment node
// Синхронизация с плоской папкой: вложенный flow лежит файлом в корне, и чужая правка его файла подхватывается так же, как
// правка любого другого. Папка — временный каталог.
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import type { FlowSettings, WorkStage } from "../shared/contract";
import { createFlowSettings, FLOW_SETTINGS_KEY } from "./flow-settings";
import { createFlowSync } from "./flow-sync";

const homes: string[] = [];
afterEach(async () => Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true }))));

const skill = (id: string): WorkStage => ({ id, kind: "skill", skill: "code", name: id, executors: [] });
const nested = (id: string, flowId: string): WorkStage => ({ id, kind: "skill", skill: "", name: "Nested", executors: [], flowId });
const collection = (flows: FlowSettings["flows"]): FlowSettings => ({ version: 2, flows, minButtonWidth: 170 });
const local = collection([
  { id: "flow-code", name: "Code", stages: [skill("work"), nested("review-row", "flow-review")] },
  { id: "flow-review", name: "Review", stages: [skill("check")] },
]);

const setup = async () => {
  const home = await mkdtemp(join(tmpdir(), "flow-sync-flat-"));
  homes.push(home);
  const { bb } = createFakePluginHost({ pluginId: "flow" });
  await bb.storage.kv.set(FLOW_SETTINGS_KEY, local);
  const flows = await createFlowSettings(bb.storage.kv);
  const published: string[] = [];
  const sync = await createFlowSync({ kv: bb.storage.kv, flows, home, now: () => new Date("2026-10-05T12:00:00.000Z"), published: (what) => published.push(what) });
  return { dir: join(home, ".claude", "BB Flows"), flows, sync, published };
};

const tree = async (dir: string): Promise<string[]> =>
  (await readdir(dir, { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name).slice(dir.length + 1)).sort();

/** Файл вложенного flow так, как его привёз бы Syncthing с другого компа. */
const reviewFromOtherComputer = JSON.stringify({ name: "Review", description: "с другого компа", stages: [skill("check")] });
const describeFlow = (settings: FlowSettings, name: string, description: string): FlowSettings => ({ ...settings, flows: settings.flows.map((f) => (f.name === name ? { ...f, description } : f)) });

describe("плоская папка синхронизации на диске", () => {
  it("папки нет — Flow пишет коллекцию плоско: вложенный flow — файлом в корне", async () => {
    const { sync, dir } = await setup();
    await sync.tick();
    expect(await tree(dir)).toEqual(["Code.flow.json", "Review.flow.json", "settings.json"]);
    expect(sync.state().status).toEqual({ kind: "synced", at: "2026-10-05T12:00:00.000Z" });
  });

  it("Syncthing привёз правку вложенного flow — коллекция подхватывается, открытые вкладки узнают об этом", async () => {
    const { sync, flows, dir, published } = await setup();
    await sync.tick();
    await writeFile(join(dir, "Review.flow.json"), reviewFromOtherComputer);
    await sync.tick();
    expect(flows.current().flows.find((f) => f.name === "Review")!.description).toBe("с другого компа");
    expect(published).toContain("flows");
  });

  it("Syncthing привёз новый flow и правку вложенного, а страница сохранила до опроса — всё на месте и в папке, и в коллекции", async () => {
    const { sync, flows, dir } = await setup();
    await sync.tick();
    await writeFile(join(dir, "Bug.flow.json"), JSON.stringify({ name: "Bug", stages: [skill("fix")] }));
    await writeFile(join(dir, "Review.flow.json"), reviewFromOtherComputer);
    await flows.save(describeFlow(flows.current(), "Code", "своя правка"));
    await sync.idle();
    await sync.tick();
    expect(flows.current().flows.map((f) => f.name)).toContain("Bug");
    expect(flows.current().flows.find((f) => f.name === "Review")!.description).toBe("с другого компа");
    expect(flows.current().flows.find((f) => f.name === "Code")!.description).toBe("своя правка");
    expect(await tree(dir)).toEqual(["Bug.flow.json", "Code.flow.json", "Review.flow.json", "settings.json"]);
  });

  it("Syncthing привёз flow с иконкой — иконка в коллекции", async () => {
    const { sync, flows, dir } = await setup();
    await sync.tick();
    await writeFile(join(dir, "Review.flow.json"), JSON.stringify({ name: "Review", icon: "Rocket", stages: [skill("check")] }));
    await sync.tick();
    expect(flows.current().flows.find((f) => f.name === "Review")!.icon).toBe("Rocket");
  });
});
