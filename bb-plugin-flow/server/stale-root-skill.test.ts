// @vitest-environment node
// Корневой навык, который прежний Flow писал в ~/.claude/skills/flow, перекрывает навык flow из плагина — плагин его убирает, чужой файл не трогает.
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { removeStaleRootSkill } from "./stale-root-skill";

const OLD_ROOT_SKILL = "---\nname: flow\ndescription: Корневой навык Flow\n---\n\n# Выбор flow\n\nФайл пишет плагин Flow из названий и описаний flow на странице Flow — правка руками затрётся при следующем сохранении flow.\n";

const homeWith = async (content: string | null) => {
  const home = await mkdtemp(join(tmpdir(), "flow-home-"));
  const dir = join(home, ".claude", "skills", "flow");
  if (content !== null) {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), content);
  }
  return { home, dir };
};

const exists = (path: string) => stat(path).then(() => true, () => false);

describe("устаревший корневой навык", () => {
  it("файл, написанный прежним Flow, удаляется вместе с опустевшей папкой", async () => {
    const { home, dir } = await homeWith(OLD_ROOT_SKILL);
    await removeStaleRootSkill(home);
    expect(await exists(dir)).toBe(false);
  });

  it("свой навык владельца с тем же именем остаётся", async () => {
    const own = "---\nname: flow\ndescription: Мой навык\n---\n\nТекст.\n";
    const { home, dir } = await homeWith(own);
    await removeStaleRootSkill(home);
    expect(await readFile(join(dir, "SKILL.md"), "utf8")).toBe(own);
  });

  it("рядом с файлом Flow лежит чужое — файл уходит, папка с чужим остаётся", async () => {
    const { home, dir } = await homeWith(OLD_ROOT_SKILL);
    await writeFile(join(dir, "notes.md"), "моё");
    await removeStaleRootSkill(home);
    expect(await exists(join(dir, "SKILL.md"))).toBe(false);
    expect(await readFile(join(dir, "notes.md"), "utf8")).toBe("моё");
  });

  it("файла нет — запуск проходит без ошибки", async () => {
    const { home } = await homeWith(null);
    await expect(removeStaleRootSkill(home)).resolves.toBeUndefined();
  });
});
