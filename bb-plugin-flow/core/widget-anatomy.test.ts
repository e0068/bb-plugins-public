// @vitest-environment node
// Состав этапа-виджета — данные: тест роняет прогон, если файл из состава удалён или переименован.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { BUILTIN_KINDS, BUILTIN_SKILLS } from "../lib/stage-constants";
import { allowedWidgetFiles, anatomyOf, pluginRootOf, WIDGET_KINDS, WIDGET_ROLES, widgetKindOf, widgetSkillFiles, widgetSubPath } from "./widget-anatomy";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("состав виджета", () => {
  it("виды — пять встроенных этапов и за ними правило", () => {
    expect(WIDGET_KINDS).toEqual([...BUILTIN_KINDS, "rule"]);
  });

  it.each(WIDGET_KINDS)("у вида %s есть пять ролей в одном порядке и в каждой хотя бы один файл", (kind) => {
    const roles = anatomyOf(kind);
    expect(roles.map((r) => r.role)).toEqual([...WIDGET_ROLES]);
    expect(roles.every((r) => r.files.length > 0)).toBe(true);
  });

  it.each(WIDGET_KINDS)("каждый файл вида %s лежит на диске", (kind) => {
    const files = [...anatomyOf(kind).flatMap((r) => r.files), ...widgetSkillFiles(kind)];
    expect(files.filter((file) => !existsSync(join(ROOT, file)))).toEqual([]);
  });

  it("навык вида — его SKILL.md и ru.md из папки навыка плагина, у правила — навык flow", () => {
    expect(BUILTIN_KINDS.map(widgetSkillFiles)).toEqual(BUILTIN_KINDS.map((k) => [`skills/${BUILTIN_SKILLS[k]}/SKILL.md`, `skills/${BUILTIN_SKILLS[k]}/ru.md`]));
    expect(widgetSkillFiles("rule")).toEqual(["skills/flow/SKILL.md"]);
  });

  it("разрешённых файлов ровно столько, сколько в составах, без повторов между ролями одного вида", () => {
    const all = WIDGET_KINDS.flatMap((k) => [...anatomyOf(k).flatMap((r) => r.files), ...widgetSkillFiles(k)]);
    expect(allowedWidgetFiles()).toEqual(new Set(all));
    WIDGET_KINDS.forEach((k) => {
      const own = anatomyOf(k).flatMap((r) => r.files);
      expect(new Set(own).size).toBe(own.length);
    });
  });
});

describe("адрес страницы виджета", () => {
  it("вид переживает путь туда и обратно", () => {
    expect(WIDGET_KINDS.map((k) => widgetKindOf(widgetSubPath(k)))).toEqual([...WIDGET_KINDS]);
  });

  it("адрес не меняется при кодировании в адресную строку браузера", () => {
    expect(WIDGET_KINDS.map((k) => encodeURIComponent(widgetSubPath(k)))).toEqual(WIDGET_KINDS.map(widgetSubPath));
  });

  it("id flow, служебные адреса и чужой вид — не виджет", () => {
    expect(["", "default", "none", "auto", "history", "widget-", "widget-skill", "widget-action"].map(widgetKindOf)).toEqual(Array(8).fill(null));
  });

  it("любая строка, не равная адресу вида, — не виджет", () => {
    const own = new Set(WIDGET_KINDS.map(widgetSubPath));
    fc.assert(fc.property(fc.string(), (s) => own.has(s) || widgetKindOf(s) === null));
  });
});

describe("корень плагина по файлу его навыка", () => {
  it("корень — всё до /skills/<имя>/SKILL.md", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^\/[a-z0-9/_-]{0,30}$/), fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/), (root, name) => {
        expect(pluginRootOf(`${root}/skills/${name}/SKILL.md`, name)).toBe(root);
      }),
    );
  });

  it.each([
    ["/p/skills/other/SKILL.md", "name"],
    ["/p/skills/name/ru.md", "name"],
    ["/p/name/SKILL.md", "name"],
    ["", "name"],
  ])("путь %s не из папки навыка %s — корня нет", (path, name) => {
    expect(pluginRootOf(path, name)).toBeNull();
  });
});
