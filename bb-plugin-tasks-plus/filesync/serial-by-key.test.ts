import { describe, expect, it } from "vitest";
import { createSerialByKey } from "./serial-by-key.js";

describe("createSerialByKey", () => {
  it("не пускает второй вызов того же ключа внутрь первого", async () => {
    const serial = createSerialByKey();
    const trace: string[] = [];
    const slow = serial("board", async () => {
      trace.push("первый вошёл");
      await new Promise((resolve) => setTimeout(resolve, 10));
      trace.push("первый вышел");
    });
    const fast = serial("board", async () => {
      trace.push("второй вошёл");
    });

    await Promise.all([slow, fast]);
    expect(trace).toEqual(["первый вошёл", "первый вышел", "второй вошёл"]);
  });

  it("разные ключи идут параллельно — очередь у каждой доски своя", async () => {
    const serial = createSerialByKey();
    const trace: string[] = [];
    await Promise.all([
      serial("a", async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        trace.push("a");
      }),
      serial("b", async () => {
        trace.push("b");
      }),
    ]);
    expect(trace).toEqual(["b", "a"]);
  });

  it("отдаёт результат вызывающему", async () => {
    const serial = createSerialByKey();
    expect(await serial("k", async () => 42)).toBe(42);
  });

  it("упавший вызов не отравляет очередь: следующий всё равно выполняется", async () => {
    const serial = createSerialByKey();
    const failed = serial("k", async () => {
      throw new Error("упал");
    });
    await expect(failed).rejects.toThrow("упал");
    await expect(serial("k", async () => "живая")).resolves.toBe("живая");
  });
});
