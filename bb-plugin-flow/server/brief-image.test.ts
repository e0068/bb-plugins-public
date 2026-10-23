// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { BRIEF_IMAGE_PATH } from "../core/brief-image";
import { registerBriefImages } from "./brief-image";

const ROOT = "/w/thr_1/Shapeshift";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

type Read = { hostId?: string; rootPath?: string; path: string };

/** Тред с деревом на хосте `local`; на диске — один снимок. */
const setup = (environmentId: string | null = "env_1") => {
  const reads: Read[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: { get: async () => ({ id: "thr_1", projectId: "prj_1", environmentId, title: "Тред" }) } as never,
      environments: { get: async () => ({ id: "env_1", hostId: "local", path: ROOT }) } as never,
      files: {
        read: (async (args: Read) => {
          reads.push(args);
          if (args.path !== `${ROOT}/docs/SHA-315/1.jpg`) throw new Error("ENOENT");
          return { path: args.path, content: Buffer.from(JPEG).toString("base64"), contentEncoding: "base64", sha256: "", sizeBytes: JPEG.length };
        }) as never,
      },
    },
  });
  registerBriefImages(bb);
  const get = (query: Record<string, string>) => harness.fetchHttp("GET", `${BRIEF_IMAGE_PATH}?${new URLSearchParams(query).toString()}`);
  return { get, reads };
};

describe("маршрут снимков брифа", () => {
  it("отдаёт снимок из дерева треда байтами с типом картинки; корень дерева — граница чтения хоста", async () => {
    const { get, reads } = setup();
    const response = await get({ thread: "thr_1", src: "docs/SHA-315/1.jpg" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG);
    expect(reads).toEqual([{ hostId: "local", rootPath: ROOT, path: `${ROOT}/docs/SHA-315/1.jpg` }]);
  });

  it("нет файла — 404", async () => {
    expect((await setup().get({ thread: "thr_1", src: "docs/none.png" })).status).toBe(404);
  });

  it("путь из дерева наружу и не картинка — 404 без чтения диска", async () => {
    const { get, reads } = setup();
    expect((await get({ thread: "thr_1", src: "../../etc/a.png" })).status).toBe(404);
    expect((await get({ thread: "thr_1", src: "docs/.env" })).status).toBe(404);
    expect(reads).toEqual([]);
  });

  it("у треда нет дерева или запрос без треда — 404", async () => {
    expect((await setup(null).get({ thread: "thr_1", src: "docs/SHA-315/1.jpg" })).status).toBe(404);
    expect((await setup().get({ src: "docs/SHA-315/1.jpg" })).status).toBe(404);
  });
});

describe("маршрут снимков брифа: окружение без папки", () => {
  it("у окружения нет пути на диске — 404 без чтения диска", async () => {
    const reads: unknown[] = [];
    const { bb, harness } = createFakePluginHost({
      pluginId: "flow",
      sdk: {
        threads: { get: async () => ({ id: "thr_1", projectId: "prj_1", environmentId: "env_1", title: "Тред" }) } as never,
        environments: { get: async () => ({ id: "env_1", hostId: "local", path: null }) } as never,
        files: { read: (async (args: unknown) => reads.push(args)) as never },
      },
    });
    registerBriefImages(bb);
    const response = await harness.fetchHttp("GET", `${BRIEF_IMAGE_PATH}?${new URLSearchParams({ thread: "thr_1", src: "docs/a.png" }).toString()}`);
    expect(response.status).toBe(404);
    expect(reads).toEqual([]);
  });
});
