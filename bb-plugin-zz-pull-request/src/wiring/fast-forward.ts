// Слой 3 (оболочка), тестируемая часть — оркестрация перемотки ветки к базе.
//
// Последовательность (fetch → merge --ff-only) и разбор кодов возврата живут
// здесь и проверяются фейковым `run` без git. Сам `run` (запуск процесса) — в
// git-client.ts, единственной точке эффекта.
import { fastForwardArgs, fetchBaseArgs } from "../core/git-commands";

export interface GitRun {
  code: number;
  stdout: string;
  stderr: string;
}

/** Единственный порт эффекта: выполнить git с argv и вернуть код и вывод. Не бросает на коде. */
export interface GitPorts {
  run(args: readonly string[]): Promise<GitRun>;
}

export async function runFastForward(ports: GitPorts, base: string): Promise<void> {
  const fetched = await ports.run(fetchBaseArgs(base));
  if (fetched.code !== 0) {
    throw new Error(`git fetch origin ${base}: ${message(fetched)}`);
  }
  const merged = await ports.run(fastForwardArgs(base));
  if (merged.code !== 0) {
    throw new Error(`не удалось перемотать на origin/${base}: ${message(merged)}`);
  }
}

function message(run: GitRun): string {
  const text = run.stderr.trim() || run.stdout.trim();
  return text === "" ? `код ${run.code}` : text;
}
