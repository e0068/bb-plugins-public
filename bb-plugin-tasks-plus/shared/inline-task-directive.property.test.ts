import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { findInlineTaskDirectives } from "./inline-task-directive.js";

/** Адрес задачи: ключ доски или слаг — без пробелов, кавычек и скобок. */
const address = fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9_-]{0,20}$/);
/** Текст вокруг директивы, в котором самой директивы нет. */
const prose = fc.string({ maxLength: 40 }).filter((text) => !text.includes("::task{"));

describe("findInlineTaskDirectives — свойства", () => {
  it("директива, вставленная в любой текст, находится со своим адресом и точным местом", () => {
    fc.assert(
      fc.property(prose, address, prose, (before, key, after) => {
        const directive = `::task{key="${key}"}`;
        const text = `${before}${directive}${after}`;
        expect(findInlineTaskDirectives(text)).toEqual([
          { start: before.length, end: before.length + directive.length, key },
        ]);
      }),
    );
  });

  it("найденные места идут по порядку, не пересекаются и каждое — целая директива", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(prose, address), { maxLength: 5 }), prose, (parts, last) => {
        const text = parts.map(([before, key]) => `${before}::task{key="${key}"}`).join("") + last;
        const found = findInlineTaskDirectives(text);
        expect(found.map(({ key }) => key)).toEqual(parts.map(([, key]) => key));
        found.forEach(({ start, end }, index) => {
          expect(text.slice(start, end)).toMatch(/^::task\{.*\}$/);
          expect(start).toBeGreaterThanOrEqual(found[index - 1]?.end ?? 0);
        });
      }),
    );
  });
});
