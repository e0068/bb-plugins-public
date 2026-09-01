import { describe, expect, it } from "vitest";
import { runFastForward, type GitPorts, type GitRun } from "./fast-forward";

// Фейковый run: очередь ответов по argv + запись обращений. Ответ выбирается
// функцией по первому аргументу (fetch/merge), без запуска git.
function fakePorts(
  reply: (args: readonly string[]) => GitRun,
): { ports: GitPorts; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    ports: {
      async run(args) {
        calls.push([...args]);
        return reply(args);
      },
    },
  };
}

const ok: GitRun = { code: 0, stdout: "", stderr: "" };

describe("runFastForward", () => {
  it("успех: fetch затем merge --ff-only, в этом порядке", async () => {
    const { ports, calls } = fakePorts(() => ok);
    await runFastForward(ports, "main");
    expect(calls).toEqual([
      ["fetch", "origin", "main"],
      ["merge", "--ff-only", "origin/main"],
    ]);
  });

  it("fetch упал → бросает и merge не запускается", async () => {
    const { ports, calls } = fakePorts((args) =>
      args[0] === "fetch" ? { code: 1, stdout: "", stderr: "нет сети" } : ok,
    );
    await expect(runFastForward(ports, "main")).rejects.toThrow("нет сети");
    expect(calls).toEqual([["fetch", "origin", "main"]]);
  });

  it("merge не перемотка (расхождение) → бросает с текстом git", async () => {
    const { ports } = fakePorts((args) =>
      args[0] === "merge"
        ? { code: 128, stdout: "", stderr: "Not possible to fast-forward, aborting." }
        : ok,
    );
    await expect(runFastForward(ports, "main")).rejects.toThrow(
      "Not possible to fast-forward",
    );
  });

  it("без stderr берёт stdout, иначе код возврата", async () => {
    const { ports } = fakePorts((args) =>
      args[0] === "merge" ? { code: 128, stdout: "", stderr: "" } : ok,
    );
    await expect(runFastForward(ports, "main")).rejects.toThrow("код 128");
  });
});
