// Слой 2 — чисто. Скрипты шагами встроенной автоматизации: владелец добавляет
// файл, его имя и содержимое хранятся в самой автоматизации, а шаг ссылается
// на скрипт как `script:<id>`. Здесь — добавить, убрать, найти скрипт и
// превратить итог процесса в итог шага. Запуск процесса — server/script-step.ts.
import type { StepOutcome } from "../packages/automation-steps/index";
import type { AutomationScript, AutomationStep, BuiltinAutomation } from "../shared/contract";

export { MAX_SCRIPT_CHARS } from "../lib/script-limit";

/** Сколько скрипт может идти, прежде чем Flow его остановит. */
export const SCRIPT_TIMEOUT_MINUTES = 10;

const PREFIX = "script:";
const TAIL_LINES = 10;

/** Id скрипта из id шага; шаг Flow — `null`. */
export const scriptIdOf = (step: string): string | null => (step.startsWith(PREFIX) ? step.slice(PREFIX.length) : null);

const scriptsOf = (automation: BuiltinAutomation): readonly AutomationScript[] => automation.scripts ?? [];

/** Скрипт шага в автоматизации; шаг Flow или скрипт, которого уже нет, — `null`. */
export const scriptOf = (automation: BuiltinAutomation, step: string): AutomationScript | null => {
  const id = scriptIdOf(step);
  return id === null ? null : (scriptsOf(automation).find((s) => s.id === id) ?? null);
};

/**
 * Скрипт из файла — новым шагом в конец. `id` даёт вызывающий и он не должен повторять ни один прежний:
 * прерванный прогон знает шаг только по id, и повторно выданный id запустил бы другой скрипт под старой подписью.
 */
export const addScript = (automation: BuiltinAutomation, file: { name: string; content: string }, id: string): BuiltinAutomation => ({
  ...automation,
  steps: [...automation.steps, `${PREFIX}${id}`],
  scripts: [...scriptsOf(automation), { id, ...file }],
});

/** Шаг убирается; шаг-скрипт уносит свой скрипт, чтобы в настройках не копилось содержимое без шага. */
export const removeStep = (automation: BuiltinAutomation, step: AutomationStep): BuiltinAutomation => {
  const steps = automation.steps.filter((s) => s !== step);
  const id = scriptIdOf(step);
  return id === null ? { ...automation, steps } : { ...automation, steps, scripts: scriptsOf(automation).filter((s) => s.id !== id) };
};

/** Как закончился процесс скрипта: код выхода, остановлен ли по времени, общий вывод, отказ запуска. */
export type ScriptExit = { code: number | null; timedOut: boolean; output: string; spawnError?: string };

const lines = (output: string): string[] => output.split("\n").map((l) => l.trimEnd()).filter((l) => l !== "");

/** Итог шага по выходу скрипта: успех — с последней строкой вывода, провал — с причиной и хвостом вывода. */
export const scriptOutcome = (name: string, exit: ScriptExit): StepOutcome => {
  if (exit.spawnError !== undefined) return { ok: false, error: `The script ${name} did not start: ${exit.spawnError}` };
  if (exit.timedOut) return { ok: false, error: `The script ${name} did not finish in ${SCRIPT_TIMEOUT_MINUTES} minutes and was stopped.` };
  const all = lines(exit.output);
  if (exit.code === 0) return { ok: true, detail: all.at(-1) ?? null };
  return { ok: false, error: `The script ${name} exited with code ${exit.code ?? "unknown"}:\n${all.slice(-TAIL_LINES).join("\n")}` };
};
