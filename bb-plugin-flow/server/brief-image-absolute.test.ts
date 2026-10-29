// @vitest-environment node
// Снимок, вставленный в текст брифа абсолютным путём — из хранилища треда или из его дерева. Маршрут отдаёт его, если
// путь лежит внутри одного из этих корней, и читает файл у хоста с этим корнем как границей; любой другой путь — 404.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { BRIEF_IMAGE_PATH } from "../core/brief-image";
import { registerBriefImages } from "./brief-image";

const TREE = "/w/thr_1/Shapeshift";
const STORAGE = "/Users/me/.bb/thread-storage/thr_1";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const FILES = [`${TREE}/docs/a.png`, `${STORAGE}/shots/b.png`];

type Read = { hostId?: string; rootPath?: string; path: string };

const setup = (environmentId: string | null = "env_1") => {
  const reads: Read[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: {
        get: async () => ({ id: "thr_1", projectId: "prj_1", environmentId, title: "Тред" }),
        storageLocation: async () => ({ threadId: "thr_1", hostId: "storage-host", storageRootPath: STORAGE }),
      } as never,
      environments: { get: async () => ({ id: "env_1", hostId: "local", path: TREE }) } as never,
      files: {
        read: (async (args: Read) => {
          reads.push(args);
          if (!FILES.includes(args.path)) throw new Error("ENOENT");
          return { path: args.path, content: Buffer.from(PNG).toString("base64"), contentEncoding: "base64", sha256: "", sizeBytes: PNG.length };
        }) as never,
      },
    },
  });
  registerBriefImages(bb);
  const get = (src: string) => harness.fetchHttp("GET", `${BRIEF_IMAGE_PATH}?${new URLSearchParams({ thread: "thr_1", src }).toString()}`);
  return { get, reads };
};

describe("маршрут снимков брифа: абсолютный путь", () => {
  it("снимок из хранилища треда — байтами картинки; хранилище — граница чтения хоста", async () => {
    const { get, reads } = setup();
    const response = await get(`${STORAGE}/shots/b.png`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
    expect(reads).toEqual([{ hostId: "storage-host", rootPath: STORAGE, path: `${STORAGE}/shots/b.png` }]);
  });

  it("снимок по абсолютному пути внутри дерева треда — байтами картинки; дерево — граница чтения хоста", async () => {
    const { get, reads } = setup();
    const response = await get(`${TREE}/docs/./a.png`);
    expect(response.status).toBe(200);
    expect(reads).toEqual([{ hostId: "local", rootPath: TREE, path: `${TREE}/docs/a.png` }]);
  });

  it("у треда нет дерева — снимок хранилища всё равно отдаётся", async () => {
    expect((await setup(null).get(`${STORAGE}/shots/b.png`)).status).toBe(200);
  });

  it("путь вне корней треда, выход из корня через «..», соседняя папка с тем же началом имени — 404 без чтения диска", async () => {
    const { get, reads } = setup();
    for (const src of ["/etc/a.png", `${TREE}/../other/a.png`, `${TREE}-evil/a.png`, `${STORAGE}/../../x.png`, `${STORAGE}/notes.md`])
      expect((await get(src)).status, src).toBe(404);
    expect(reads).toEqual([]);
  });
});
