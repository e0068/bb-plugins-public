// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readSourceFiles } from "@bb-plugins/layer-guard/index.js";
import { compareBaseline, formatReport, styleViolations, type Baseline } from "@bb-plugins/style-guard/index.js";

/**
 * Flow берёт готовые компоненты и не пишет стили сам. Проверяется интерфейс — `app/` и `app.tsx`; `components/ui` —
 * слой готовых компонентов, стили живут там. Нынешние нарушения записаны в style-baseline.json и могут только
 * уменьшаться: убрал нарушение — уменьши число в списке.
 */
const ROOT = fileURLToPath(new URL(".", import.meta.url));
const baseline: Baseline = JSON.parse(readFileSync(new URL("style-baseline.json", import.meta.url), "utf8"));
const checked = readSourceFiles(ROOT, { extensions: [".ts", ".tsx", ".css"] }).filter((file) => /^(app\/|app\.tsx$)/.test(file.path));

describe("свои стили во Flow", () => {
  it("интерфейс проверяется по файлам", () => {
    expect(checked.length).toBeGreaterThan(0);
  });

  it("новых своих стилей и самодельных контролов нет, а список нынешних не отстаёт от кода", () => {
    expect(formatReport(compareBaseline(checked.flatMap(styleViolations), baseline))).toBe("");
  });

  it("виджет «Прототип» собран только из готовых компонентов: в списке у него нет записей", () => {
    expect(Object.keys(baseline).filter((path) => path.startsWith("app/prototype-widget"))).toEqual([]);
  });
});
