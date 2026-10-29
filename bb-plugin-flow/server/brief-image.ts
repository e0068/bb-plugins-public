// Маршрут снимков из текста брифа: `GET /brief-image?thread=<id>&src=<путь>`. Путь от корня дерева ищется в дереве
// треда, абсолютный — в дереве и в хранилище треда. Файл читается у хоста корня, корень — граница чтения и для хоста.
// Нет треда, корня, файла или путь не картинка внутри корня — 404: картинка не грузится, и текст брифа ставит на её
// место плашку с подписью (MdText).
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { absoluteImage, BRIEF_IMAGE_PATH, inTree, treeImage, underRoot, type TreeImage } from "../core/brief-image";

export type BriefImageSdk = Pick<BbPluginApi["sdk"], "threads" | "environments" | "files">;

export type BriefImage = { type: string; bytes: Uint8Array<ArrayBuffer> };

/** Корень файлов треда на хосте. */
type Root = { hostId: string; rootPath: string };

/** Дерево треда; у треда нет дерева или bb его не знает — `null`. */
const treeRoot = async (sdk: BriefImageSdk, threadId: string): Promise<Root | null> => {
  try {
    const { environmentId } = await sdk.threads.get({ threadId });
    if (environmentId === null) return null;
    const { hostId, path } = await sdk.environments.get({ environmentId });
    return path === null ? null : { hostId, rootPath: path };
  } catch {
    return null;
  }
};

/** Хранилище треда; bb его не знает — `null`. */
const storageRoot = async (sdk: BriefImageSdk, threadId: string): Promise<Root | null> => {
  try {
    const { hostId, storageRootPath } = await sdk.threads.storageLocation({ threadId });
    return { hostId, rootPath: storageRootPath };
  } catch {
    return null;
  }
};

/** Снимок в корне: путь от корня дерева — только в дереве, абсолютный — в дереве или хранилище, если лежит внутри. */
const locate = async (sdk: BriefImageSdk, threadId: string, src: string): Promise<{ root: Root; image: TreeImage } | null> => {
  const relative = treeImage(src);
  if (relative !== null) {
    const root = await treeRoot(sdk, threadId);
    return root === null ? null : { root, image: relative };
  }
  const absolute = absoluteImage(src);
  if (absolute === null) return null;
  const roots = await Promise.all([treeRoot(sdk, threadId), storageRoot(sdk, threadId)]);
  for (const root of roots) {
    const image = root === null ? null : underRoot(root.rootPath, absolute);
    if (root !== null && image !== null) return { root, image };
  }
  return null;
};

/** Снимок из корней треда; путь не снимок внутри корня — без чтения диска, любой отказ bb или хоста — `null`. */
export const readBriefImage = async (sdk: BriefImageSdk, threadId: string, src: string): Promise<BriefImage | null> => {
  const found = await locate(sdk, threadId, src);
  const path = found === null ? null : inTree(found.root.rootPath, found.image);
  if (found === null || path === null) return null;
  try {
    const file = await sdk.files.read({ hostId: found.root.hostId, rootPath: found.root.rootPath, path });
    return { type: found.image.type, bytes: Uint8Array.from(Buffer.from(file.content, file.contentEncoding)) };
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
