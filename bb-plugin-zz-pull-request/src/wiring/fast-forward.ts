// Слой 3 (оболочка), тестируемая часть — оркестрация перемотки ветки к базе.
//
// Последовательность (fetch → живая перепроверка ahead → merge --ff-only) и
// разбор кодов возврата живут здесь и проверяются фейковым `run` без git. Сам
// `run` (запуск процесса) — в git-client.ts, единственной точке эффекта.
//
// Между тем, как фронт решил показать кнопку, и кликом по ней вызывающая
// сторона (server.ts) уже опиралась на `sdk.environments.status` — кэш bb,
// который может не подхватить свежий коммит вовремя (см.
// memory/tasks/in_progress/fast-forward-stale-ahead-status.md). `--ff-only`
// сам по себе безопасен и на расхождении просто откажет, но сырым текстом
// git. Поэтому сразу после `fetch` (когда `origin/<base>` уже свежий) сами
// живьём считаем `ahead` — и, если он положительный, отказываем читаемым
// текстом плагина раньше, чем это сделает git.
import { aheadCountArgs, fastForwardArgs, fetchBaseArgs } from "../core/git-commands";
import { gitRunMessage, type GitPorts, type GitRun } from "./git-run";

export type { GitPorts, GitRun };

export async function runFastForward(ports: GitPorts, base: string): Promise<void> {
  const fetched = await ports.run(fetchBaseArgs(base));
  if (fetched.code !== 0) {
    throw new Error(`git fetch origin ${base}: ${gitRunMessage(fetched)}`);
  }
  if (await hasLiveAheadCommits(ports, base)) {
    throw new Error("Перемотка сейчас невозможна (diverged).");
  }
  const merged = await ports.run(fastForwardArgs(base));
  if (merged.code !== 0) {
    throw new Error(`не удалось перемотать на origin/${base}: ${gitRunMessage(merged)}`);
  }
}

// Код возврата или нечисловой вывод не блокируют перемотку: `--ff-only`
// и сам по себе безопасен, живая проверка — только чтобы отказать раньше
// и понятнее в заведомо расхождённом случае, а не единственная линия защиты.
async function hasLiveAheadCommits(ports: GitPorts, base: string): Promise<boolean> {
  const counted = await ports.run(aheadCountArgs(base));
  if (counted.code !== 0) return false;
  const count = Number.parseInt(counted.stdout.trim(), 10);
  return Number.isInteger(count) && count > 0;
}
