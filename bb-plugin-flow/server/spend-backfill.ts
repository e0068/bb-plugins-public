// Команда `bb flow-spend backfill`: время и стоимость прогонов, прошедших до шага «Факт → задача», дописываются в их
// задачи. Прогоны знает прогресс Flow, задачи и запись — пакет шагов; файлы задач ложатся в дерево вызвавшего треда.
import type { BbPluginApi, PluginCliResult } from "@get-bb/plugin-sdk";

import { backfillTaskSpend, bbCliClient, spentDollars, spentMinutes, type BackfillLine, type PastRun } from "@bb-plugins/automation-steps/index";
import type { CliPorts } from "@bb-plugins/automation-steps/wiring/bb-cli-run";

export const SPEND_CLI = "flow-spend";
const USAGE = `bb ${SPEND_CLI} backfill [--dry-run] [--verbose]`;
const FLAGS = ["--dry-run", "--verbose"];

/** Отчёт команды: строка на записанную задачу, итог по всем и причины отказов. */
export const backfillReport = (lines: readonly BackfillLine[], dryRun: boolean): string => {
  const written = lines.flatMap((l) => ("written" in l ? [l] : []));
  const failed = lines.flatMap((l) => ("failed" in l ? [`failed ${l.key} (${l.run}): ${l.failed}`] : "unlisted" in l ? [`tasks of ${l.thread} not read (${l.run}): ${l.unlisted}`] : []));
  const skipped = (why: "counted" | "recorded") => lines.filter((l) => "skipped" in l && l.skipped === why).length;
  const last = new Map(written.map((l) => [l.key, l.written]));
  // Те же числа, что ушли в задачу: округление вниз — общее с записью.
  const rows = [...last].map(([key, w]) => `${key}\t${spentMinutes(w.minutes)} min\t$${spentDollars(w.cost).toFixed(2)}`);
  return [
    ...rows,
    `${dryRun ? "Would write" : "Written"}: ${last.size} tasks from ${new Set(written.map((l) => l.run)).size} runs; already counted ${skipped("counted")}, kept agent figures ${skipped("recorded")}, failed ${failed.length}.`,
    ...failed,
  ].join("\n");
};

export const registerSpendBackfill = (bb: Pick<BbPluginApi, "cli" | "storage">, pastRuns: () => Promise<PastRun[]>, cli: () => CliPorts = () => bbCliClient()): void => {
  bb.cli.register({
    name: SPEND_CLI,
    summary: "Write the time and cost of past Flow runs into their tasks",
    commands: [{ name: "backfill", summary: "Fill Actual Time and Cost of tasks from the runs that worked on them", usage: USAGE }],
    async run(argv, ctx): Promise<PluginCliResult> {
      const [command, ...flags] = argv;
      if (command !== "backfill" || flags.some((f) => !FLAGS.includes(f))) return { exitCode: 1, stderr: `Usage: ${USAGE}\n` };
      if (ctx.threadId === undefined) return { exitCode: 1, stderr: "Run it from a thread: the task files land in its tree.\n" };
      const dryRun = flags.includes("--dry-run");
      const lines = await backfillTaskSpend(cli(), bb.storage.kv, await pastRuns(), ctx.threadId, dryRun);
      const failed = lines.some((l) => "failed" in l || "unlisted" in l);
      const detail = flags.includes("--verbose") ? lines.map((l) => `${l.run}\t${"unlisted" in l ? `${l.thread}\tunlisted: ${l.unlisted}` : `${l.key}\t${"written" in l ? "written" : "skipped" in l ? l.skipped : `failed: ${l.failed}`}`}\n`).join("") : "";
      return { exitCode: failed ? 1 : 0, stdout: `${detail}${backfillReport(lines, dryRun)}\n` };
    },
  });
};
