// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { dropPool, loadPool, savePool } from "./attachment-store";

describe("картинки черновика без IndexedDB", () => {
  it("окно без IndexedDB — пула на диске нет, запись и удаление не падают", async () => {
    expect(globalThis.indexedDB).toBeUndefined();
    await expect(savePool("dec_1", { next: 2, images: [{ n: 1, mimeType: "image/png", dataBase64: "AA==", weight: 4 }] })).resolves.toBeUndefined();
    expect(await loadPool("dec_1")).toBeNull();
    await expect(dropPool("dec_1")).resolves.toBeUndefined();
  });
});
