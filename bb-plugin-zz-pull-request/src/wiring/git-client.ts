// Слой 3 — единственная точка эффекта перемотки: запуск `git` в рабочей копии.
// Реализует порт GitPorts, не бросая на ненулевом коде: код и вывод уходят в
// оркестратор (fast-forward.ts), который и решает, успех это или ошибка.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitPorts, GitRun } from "./fast-forward";

const run = promisify(execFile);

export function gitClient(cwd: string): GitPorts {
  return {
    async run(args: readonly string[]): Promise<GitRun> {
      try {
        const { stdout, stderr } = await run("git", [...args], { cwd, timeout: 20000 });
        return { code: 0, stdout, stderr };
      } catch (error) {
        // execFile на ненулевом выходе бросает; код и потоки лежат на ошибке.
        const e = error as { code?: unknown; stdout?: string; stderr?: string };
        return {
          code: typeof e.code === "number" ? e.code : 1,
          stdout: e.stdout ?? "",
          stderr: e.stderr ?? String(error),
        };
      }
    },
  };
}
