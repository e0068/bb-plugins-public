/**
 * Разовое восстановление журнала решений: ответы на брифы живут в `plugin_kv` базы bb,
 * а файлы на диск не попали — см. задачу flow-zhurnal-reshenii-ne-pishetsya-na-disk-iz-za-otnositelno.
 * Оболочка вокруг чистого `backfillFiles`: читает базу, пишет файлы, ничего не решает.
 *
 *   npx vite-node tools/backfill-journal.ts -- --project <id> --out <абсолютный каталог> [--apply]
 *
 * Без `--apply` только показывает, сколько файлов получится. Уже лежащие файлы не
 * перезаписываются никогда: запись идёт флагом `wx`, а повтор узнаёт своё по содержимому
 * и молчит. Правленный руками файл по содержимому уже не свой — он уцелеет, но рядом
 * ляжет копия с суффиксом: журнал пишет плагин, и править его руками не предполагается.
 */
import Database from "better-sqlite3";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { backfillFiles, type BackfillRecord } from "../core/journal-backfill";
import type { Locale } from "../lib/i18n";
import { answerRecordSchema, decisionBriefSchema } from "../shared/contract";

const flag = (name: string, fallback?: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  const value = at === -1 ? fallback : process.argv[at + 1];
  if (value === undefined) throw new Error(`не задан --${name}`);
  // Пропущенное значение съело бы следующий флаг: `--out --apply` создало бы каталог «--apply».
  if (value.startsWith("--")) throw new Error(`у --${name} нет значения, следом идёт ${value}`);
  return value;
};

const db = new Database(flag("db", join(homedir(), ".bb", "bb.db")), { readonly: true });
const project = flag("project");
const out = flag("out");
const locale = flag("locale", "ru") as Locale;
const apply = process.argv.includes("--apply");

const rows = db
  .prepare(
    `select a.key as key, b.value as brief, a.value as answer
       from plugin_kv a
       join plugin_kv b on b.plugin_id = 'flow' and b.key = 'decision:' || substr(a.key, 17)
       join threads t on t.id = b.value ->> '$.threadId'
      where a.plugin_id = 'flow' and a.key like 'decision-answer:%' and t.project_id = ?`,
  )
  .all(project) as Array<{ key: string; brief: string; answer: string }>;

type Parsed = { record?: BackfillRecord; skipped?: string };

const parse = (row: { key: string; brief: string; answer: string }): Parsed => {
  const brief = decisionBriefSchema.safeParse(JSON.parse(row.brief));
  if (!brief.success) return { skipped: `${row.key}: бриф — ${brief.error.issues[0]?.message ?? "не разобран"}` };
  const answer = answerRecordSchema.safeParse(JSON.parse(row.answer));
  if (!answer.success) return { skipped: `${row.key}: ответ — ${answer.error.issues[0]?.message ?? "не разобран"}` };
  // Уточнение — не решение: живой журнал его тоже не пишет.
  if (brief.data.kind === "clarify") return {};
  return { record: { brief: brief.data, answer: answer.data.answer, decidedAt: answer.data.answeredAt } };
};

const parsed = rows.map(parse);
const records = parsed.flatMap((p) => (p.record === undefined ? [] : [p.record]));
const skipped = parsed.flatMap((p) => (p.skipped === undefined ? [] : [p.skipped]));

const existing = (() => {
  try {
    // Содержимое, а не только имена: уже восстановленная запись байт в байт совпадает с тем, что выдаст ядро.
    // Только файлы журнала: в каталоге попадаются и чужие подкаталоги, а чтение каталога бросает EISDIR.
    return readdirSync(out)
      .filter((name) => name.endsWith(".md"))
      .map((name) => ({ name, content: readFileSync(join(out, name), "utf8") }));
  } catch {
    return [];
  }
})();

const files = backfillFiles(records, locale, existing);
console.log(`ответов в базе: ${rows.length}, уже в каталоге: ${existing.length}, к записи: ${files.length}, пропущено по схеме: ${skipped.length}`);
for (const line of skipped) console.log(`  пропущено — ${line}`);

if (!apply) process.exit(0);

mkdirSync(out, { recursive: true });
for (const file of files) writeFileSync(join(out, file.name), file.content, { encoding: "utf8", flag: "wx" });
console.log(`записано в ${out}: ${files.length}`);
