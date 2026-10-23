// Маршрут снимков из текста брифа: `GET /brief-image?thread=<id>&src=<путь от корня дерева>`. Файл читается у хоста
// окружения треда, корень дерева — граница чтения и для хоста. Нет треда, дерева, файла или путь не картинка в
// дереве — 404: картинка не грузится, и текст брифа ставит на её место плашку с подписью (MdText).
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { BRIEF_IMAGE_PATH, inTree, treeImage } from "../core/brief-image";

export type BriefImageSdk = Pick<BbPluginApi["sdk"], "threads" | "environments" | "files">;

export type BriefImage = { type: string; bytes: Uint8Array<ArrayBuffer> };

/** Снимок из дерева треда; путь не снимок в дереве — без запросов к bb, любой отказ bb или хоста — `null`. */
export const readBriefImage = async (sdk: BriefImageSdk, threadId: string, src: string): Promise<BriefImage | null> => {
  const image = treeImage(src);
  if (image === null) return null;
  try {
    const { environmentId } = await sdk.threads.get({ threadId });
    if (environmentId === null) return null;
    const { hostId, path: rootPath } = await sdk.environments.get({ environmentId });
    const path = rootPath === null ? null : inTree(rootPath, image);
    if (rootPath === null || path === null) return null;
    const file = await sdk.files.read({ hostId, rootPath, path });
    return { type: image.type, bytes: Uint8Array.from(Buffer.from(file.content, file.contentEncoding)) };
  } catch {
    return null;
  }
};

export function registerBriefImages(bb: Pick<BbPluginApi, "http" | "sdk">): void {
  bb.http.route("GET", BRIEF_IMAGE_PATH, async (c) => {
    const threadId = c.req.query("thread") ?? "";
    const src = c.req.query("src") ?? "";
    const image = threadId === "" || src === "" ? null : await readBriefImage(bb.sdk, threadId, src);
    if (image === null) return c.json({ error: "image not found" }, 404);
    return new Response(image.bytes, {
      headers: {
        "Content-Type": image.type,
        "Content-Length": String(image.bytes.byteLength),
        "Cache-Control": "private, no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
