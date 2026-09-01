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
const aheadZero: GitRun = { code: 0, stdout: "0\n", stderr: "" };

describe("runFastForward", () => {
  it("успех: fetch → живой ahead=0 → merge --ff-only, в этом порядке", async () => {
    const { ports, calls } = fakePorts((args) =>
      args[0] === "rev-list" ? aheadZero : ok,
    );
    await runFastForward(ports, "main");
    expect(calls).toEqual([
      ["fetch", "origin", "main"],
      ["rev-list", "--count", "origin/main..HEAD"],
      ["merge", "--ff-only", "origin/main"],
    ]);
  });

  it("fetch упал → бросает и дальше ничего не запускается", async () => {
    const { ports, calls } = fakePorts((args) =>
      args[0] === "fetch" ? { code: 1, stdout: "", stderr: "нет сети" } : ok,
    );
    await expect(runFastForward(ports, "main")).rejects.toThrow("нет сети");
    expect(calls).toEqual([["fetch", "origin", "main"]]);
  });

  it("живой ahead > 0 → читаемый отказ плагина, merge не запускается", async () => {
    const { ports, calls } = fakePorts((args) =>
      args[0] === "rev-list" ? { code: 0, stdout: "2\n", stderr: "" } : ok,
    );
    await expect(runFastForward(ports, "main")).rejects.toThrow(
      "Перемотка сейчас невозможна (diverged).",
    );
    expect(calls).toEqual([
      ["fetch", "origin", "main"],
      ["rev-list", "--count", "origin/main..HEAD"],
    ]);
  });

  it("rev-list упал или дал не число → не блокирует, идём в merge как раньше", async () => {
    const { ports, calls } = fakePorts((args) =>
      args[0] === "rev-list" ? { code: 1, stdout: "", stderr: "boom" } : ok,
    );
    await runFastForward(ports, "main");
    expect(calls).toEqual([
      ["fetch", "origin", "main"],
      ["rev-list", "--count", "origin/main..HEAD"],
      ["merge", "--ff-only", "origin/main"],
    ]);
  });

  it("merge не перемотка (расхождение, живая проверка его не поймала) → бросает с текстом git", async () => {
    const { ports } = fakePorts((args) => {
      if (args[0] === "rev-list") return aheadZero;
      if (args[0] === "merge") {
        return { code: 128, stdout: "", stderr: "Not possible to fast-forward, aborting." };
      }
      return ok;
    });
    await expect(runFastForward(ports, "main")).rejects.toThrow(
      "Not possible to fast-forward",
    );
  });

  it("без stderr берёт stdout, иначе код возврата", async () => {
    const { ports } = fakePorts((args) => {
      if (args[0] === "rev-list") return aheadZero;
      if (args[0] === "merge") return { code: 128, stdout: "", stderr: "" };
      return ok;
    });
    await expect(runFastForward(ports, "main")).rejects.toThrow("код 128");
  });
});
