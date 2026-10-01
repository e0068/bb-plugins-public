// Прежний Flow писал корневой навык в ~/.claude/skills/flow/SKILL.md. Навык владельца в ~/.claude/skills важнее
// одноимённого навыка плагина, поэтому оставшийся файл перекрывает навык flow, который везёт плагин. Плагин узнаёт
// свой файл по пометке, которую тот нёс, убирает его и опустевшую папку; чужой файл с тем же именем не трогает.
import { readdir, readFile, rm, rmdir } from "node:fs/promises";
import { join } from "node:path";

/** Строка, которой начинался абзац-пометка в каждом файле корневого навыка. */
const ROOT_SKILL_MARK = "Файл пишет плагин Flow";

const readOrNull = (path: string): Promise<string | null> => readFile(path, "utf8").catch(() => null);

export const removeStaleRootSkill = async (home: string): Promise<void> => {
  const dir = join(home, ".claude", "skills", "flow");
  const file = join(dir, "SKILL.md");
  const text = await readOrNull(file);
  if (text === null || !text.includes(ROOT_SKILL_MARK)) return;
  await rm(file);
  if ((await readdir(dir)).length === 0) await rmdir(dir);
};
