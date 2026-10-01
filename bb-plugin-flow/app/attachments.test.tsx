// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredPool } from "./attachment-store";

/** IndexedDB окна — словарь, который переживает перезагрузку модуля картинок, как настоящая база. */
const disk = vi.hoisted(() => new Map<string, StoredPool>());
/** Задержка подъёма с диска: открытие базы не мгновенно, и вставка может прийти раньше. */
const slow = vi.hoisted(() => ({ ms: 0 }));
vi.mock("./attachment-store", () => ({
  loadPool: async (briefId: string) => {
    const stored = disk.get(briefId) ?? null;
    await new Promise((resolve) => setTimeout(resolve, slow.ms));
    return stored;
  },
  savePool: async (briefId: string, pool: StoredPool) => void disk.set(briefId, structuredClone(pool)),
  dropPool: async (briefId: string) => void disk.delete(briefId),
}));

type Module = typeof import("./attachments");
/** Свежий модуль картинок — то, что получает плагин после перезагрузки: память пуста, диск прежний. */
const reload = async (): Promise<Module> => {
  vi.resetModules();
  return import("./attachments");
};

const BRIEF = "dec_demo";
const png = (text: string) => new File([text], `${text}.png`, { type: "image/png" });

/** Поле комментария к демонстрации внутри формы брифа: вставка двух картинок разом. */
const pasteTwo = async ({ AttachmentsProvider, usePasteImages }: Module) => {
  function Comment() {
    const [value, setValue] = useState("");
    const onPaste = usePasteImages({ value, onText: setValue });
    return <textarea aria-label="Комментарий" value={value} onChange={(e) => setValue(e.target.value)} onPaste={onPaste} />;
  }
  const view = render(
    <AttachmentsProvider briefId={BRIEF}>
      <Comment />
    </AttachmentsProvider>,
  );
  const field = view.getByRole("textbox", { name: "Комментарий" }) as HTMLTextAreaElement;
  const files = [png("first"), png("second")];
  await act(async () => {
    fireEvent.paste(field, { clipboardData: { items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })), files, getData: () => "" } });
  });
  return field;
};

const decoded = (payload: Awaited<ReturnType<Module["attachmentsPayload"]>>) =>
  (payload.images ?? []).map(({ n, dataBase64 }) => ({ n, text: Buffer.from(dataBase64, "base64").toString() }));

beforeEach(() => {
  disk.clear();
  slow.ms = 0;
});
afterEach(cleanup);

describe("картинки комментария к демонстрации", () => {
  it("отправка сразу после вставки ждёт, пока обе картинки дочитаются, и уносит обе", async () => {
    const attachments = await reload();
    const field = await pasteTwo(attachments);
    await waitFor(() => expect(field.value).toBe("[картинка 1] [картинка 2]"));
    expect(decoded(await attachments.attachmentsPayload(BRIEF))).toEqual([
      { n: 1, text: "first" },
      { n: 2, text: "second" },
    ]);
  });

  it("картинки переживают перезагрузку плагина между вставкой и отправкой", async () => {
    const before = await reload();
    await pasteTwo(before);
    await before.attachmentsPayload(BRIEF);
    await waitFor(() => expect(disk.get(BRIEF)?.images).toHaveLength(2));
    cleanup();
    const after = await reload();
    expect(decoded(await after.attachmentsPayload(BRIEF))).toEqual([
      { n: 1, text: "first" },
      { n: 2, text: "second" },
    ]);
  });

  it("после перезагрузки новая картинка получает следующий номер, а не занятый", async () => {
    const before = await reload();
    await pasteTwo(before);
    await before.attachmentsPayload(BRIEF);
    cleanup();
    const after = await reload();
    await after.attachmentsPayload(BRIEF);
    const field = await pasteTwo(after);
    await waitFor(() => expect(field.value).toBe("[картинка 3] [картинка 4]"));
    expect((await after.attachmentsPayload(BRIEF)).images?.map((i) => i.n)).toEqual([1, 2, 3, 4]);
  });

  it("вставка сразу после перезагрузки, пока пул ещё поднимается с диска, не занимает номера сохранённых картинок", async () => {
    const before = await reload();
    await pasteTwo(before);
    await before.attachmentsPayload(BRIEF);
    cleanup();
    slow.ms = 50;
    const after = await reload();
    const field = await pasteTwo(after);
    await waitFor(() => expect(field.value).toBe("[картинка 3] [картинка 4]"));
    expect(decoded(await after.attachmentsPayload(BRIEF)).map(({ n, text }) => `${n}:${text}`)).toEqual(["1:first", "2:second", "3:first", "4:second"]);
  });

  it("принятый ответ стирает картинки и с диска", async () => {
    const attachments = await reload();
    await pasteTwo(attachments);
    await attachments.attachmentsPayload(BRIEF);
    attachments.clearAttachments(BRIEF);
    await waitFor(() => expect(disk.has(BRIEF)).toBe(false));
    expect(await (await reload()).attachmentsPayload(BRIEF)).toEqual({});
  });
});
