// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createHranaFake } from "../test-support/hrana-fake.js";
import { createHranaClient } from "../remote/hrana.js";
import { createDbRepo, type DbRepo } from "./db-repo.js";

/** Two links to one database, as two machines hold them. */
function twoLinks(): [DbRepo, DbRepo] {
  const fake = createHranaFake();
  const { url } = fake.addDatabase("board-me.turso.io", "t1");
  const link = () => createDbRepo(createHranaClient({ url, token: "t1", fetch: fake.fetch }), { url });
  return [link(), link()];
}

const bytesOf = (size: number): Uint8Array => Uint8Array.from({ length: size }, (_, index) => (index * 7) % 256);

describe("The files kept in a board database", () => {
  it("are read by another link exactly as written, at any size including none and several parts", async () => {
    const [writer, reader] = twoLinks();
    for (const size of [0, 1, 1024 * 1024 - 1, 1024 * 1024, 2 * 1024 * 1024 + 5]) {
      const bytes = bytesOf(size);
      await writer.blobs.write(`file-${size}`, bytes);
      expect(await reader.blobs.read(`file-${size}`)).toEqual(bytes);
    }
  });

  it("are nothing under an id never written", async () => {
    const [, reader] = twoLinks();
    expect(await reader.blobs.read("missing")).toBeNull();
  });

  it("are replaced whole when written again, a longer file by a shorter one too", async () => {
    const [writer, reader] = twoLinks();
    await writer.blobs.write("file", bytesOf(2 * 1024 * 1024 + 5));
    await writer.blobs.write("file", bytesOf(3));
    expect(await reader.blobs.read("file")).toEqual(bytesOf(3));
  });

  it("are gone for every link once removed, and other files stay", async () => {
    const [writer, reader] = twoLinks();
    await writer.blobs.write("gone", bytesOf(10));
    await writer.blobs.write("kept", bytesOf(20));
    await writer.blobs.remove("gone");
    expect(await reader.blobs.read("gone")).toBeNull();
    expect(await reader.blobs.read("kept")).toEqual(bytesOf(20));
  });
});
