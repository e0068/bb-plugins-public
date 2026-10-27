// Шаг-скрипт: Flow кладёт содержимое скрипта во временный файл и запускает его
// в рабочем дереве треда. Скрипт с shebang идёт своим интерпретатором, без
// shebang — через sh. Треду и окружению скрипт видит id в BB_THREAD_ID и
// BB_ENVIRONMENT_ID. Итог процесса в итог шага переводит core/automation-scripts.ts.
// Выбор flow до хода (./auto-choice.ts) запускает свой скрипт тем же путём: со входом
// в stdin и своими переменными окружения.
import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BbPluginApi } from "@get-bb/plugin-sdk";

import type { StepOutcome } from "@bb-plugins/automation-steps/index";
import { STOPPED_ERROR } from "../core/automation-run";
import { SCRIPT_TIMEOUT_MINUTES, scriptOutcome, type ScriptExit } from "../core/automation-scripts";
import type { AutomationScript } from "../shared/contract";

/** Сколько вывода держать: итогу нужен только хвост. */
const OUTPUT_KEEP = 64_000;
/** Сколько дочитывать вывод после выхода скрипта: фоновый процесс, унаследовавший вывод, не должен держать шаг. */
const DRAIN_MS = 200;

type Place = { cwd: string; threadId: string; environmentId: string };
export type RunOptions = {
  timeoutMs?: number;
  /** Вход скрипта в stdin; нет — stdin закрыт. */
  input?: string;
  /** Переменные окружения сверх BB_THREAD_ID и BB_ENVIRONMENT_ID. */
  env?: Readonly<Record<string, string>>;
  /** Сигнал отмены: владелец нажал «Стоп» — вся группа процессов скрипта гаснет сразу, итог — {@link STOPPED_ERROR}. Снятый заранее сигнал скрипт не запускает. */
  signal?: AbortSignal;
};

/** Чем кончился запуск: процесс вышел сам или его оборвал сигнал. */
type Ended = { kind: "exit"; exit: ScriptExit } | { kind: "stopped" };

/** Сигнал всей группе процессов скрипта; группы уже нет — нечего останавливать. */
const killGroup = (pid: number | undefined) => {
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // группа уже завершилась
  }
};

const exitOf = (file: string, shebang: boolean, place: Place, timeoutMs: number, { input, env, signal }: RunOptions): Promise<Ended> =>
  new Promise((resolve) => {
    if (signal?.aborted === true) return resolve({ kind: "stopped" });
    let output = "";
    let timedOut = false;
    let settled = false;
    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-OUTPUT_KEEP);
    };
    // Своя группа процессов (detached): таймаут останавливает и то, что скрипт запустил в фоне.
    const child = spawn(shebang ? file : "/bin/sh", shebang ? [] : [file], {
      cwd: place.cwd,
      env: { ...process.env, ...env, BB_THREAD_ID: place.threadId, BB_ENVIRONMENT_ID: place.environmentId },
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      detached: true,
    });
    const finish = (ended: Ended) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve(ended);
    };
    const done = (exit: ScriptExit) => finish({ kind: "exit", exit });
    // «Стоп»: убиваем всю группу и отвечаем сразу, не дожидаясь, пока дочитается вывод.
    const onAbort = () => {
      killGroup(child.pid);
      finish({ kind: "stopped" });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child.pid);
    }, timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    // Скрипт, который не дочитал вход, закрывает stdin раньше: запись не должна ронять сервер.
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(input);
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    child.on("error", (error) => done({ code: null, timedOut: false, output, spawnError: error.message }));
    child.on("close", (code) => done({ code, timedOut, output }));
    // Итог — по выходу самого скрипта: close ждёт, пока закроют вывод все, кто его унаследовал.
    child.on("exit", (code) => {
      if (timedOut) killGroup(child.pid);
      setTimeout(() => done({ code, timedOut, output }), DRAIN_MS);
    });
  });

/** Запускает скрипт в `place.cwd` и отвечает итогом шага; временный файл удаляется в любом исходе. */
export async function runScript(script: Pick<AutomationScript, "name" | "content">, place: Place, options: RunOptions = {}): Promise<StepOutcome> {
  if (options.signal?.aborted === true) return { ok: false, error: STOPPED_ERROR };
  const dir = await mkdtemp(join(tmpdir(), "flow-script-"));
  try {
    // Имя файла владельца — только подпись шага: на диске скрипт всегда `script`, путь из имени сюда не попадает.
    const file = join(dir, "script");
    await writeFile(file, script.content, "utf8");
    await chmod(file, 0o700);
    const timeoutMs = options.timeoutMs ?? SCRIPT_TIMEOUT_MINUTES * 60_000;
    const ended = await exitOf(file, script.content.startsWith("#!"), place, timeoutMs, options);
    return ended.kind === "stopped" ? { ok: false, error: STOPPED_ERROR } : scriptOutcome(script.name, ended.exit, timeoutMs);
  } catch (error) {
    return { ok: false, error: `The script ${script.name} did not start: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Шаг-скрипт треда: рабочее дерево окружения треда — место запуска. */
export const scriptStep =
  (sdk: Pick<BbPluginApi["sdk"], "threads" | "environments">) =>
  async (threadId: string, script: AutomationScript, signal?: AbortSignal): Promise<StepOutcome> => {
    try {
      const { environmentId } = await sdk.threads.get({ threadId });
      const env = environmentId === null ? null : await sdk.environments.get({ environmentId });
      if (env === null || !env.path) return { ok: false, error: "The thread has no working copy on disk to run the script in." };
      return await runScript(script, { cwd: env.path, threadId, environmentId: env.id }, { signal });
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
