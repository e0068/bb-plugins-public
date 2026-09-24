// Запись корневого навыка flow на диск: текст собирает ядро (../core/root-skill), здесь — только файл.
// Файл пишется, только когда текст изменился: его открывают превью bb и читает Claude Code.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { rootSkillText } from "../core/root-skill";
import { ROOT_SKILL } from "../lib/stage-constants";
import type { Flow } from "../shared/contract";

export const rootSkillPath = (home: string): string => join(home, ".claude", "skills", ROOT_SKILL, "SKILL.md");

export const writeRootSkill = async (flows: readonly Flow[], home: string = homedir()): Promise<void> => {
  const path = rootSkillPath(home);
  const text = rootSkillText(flows);
  if ((await readFile(path, "utf8").catch(() => null)) === text) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
};
