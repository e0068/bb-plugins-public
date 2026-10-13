// Пересобирает phosphor.ts — пути всех знаков Phosphor в двух начертаниях, переписанные из установленного
// @phosphor-icons/core. Рабочий код пакета Phosphor не импортирует — см. generate.mjs. Запуск: `node generate-phosphor.mjs`
// в этой папке после `npm install`; тест phosphor.test.ts сверяет пути с SVG пакета.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, "node_modules/@phosphor-icons/core/assets");

/** Пути знака: атрибуты d всех <path> файла. */
export const pathsOf = (svg) => [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map((match) => match[1]);

/** Знаки начертания по имени без суффикса начертания, по алфавиту. */
const weight = (folder, suffix) =>
  readdirSync(join(assets, folder))
    .filter((file) => file.endsWith(".svg"))
    .map((file) => file.slice(0, -".svg".length - suffix.length))
    .sort()
    .map((name) => [name, pathsOf(readFileSync(join(assets, folder, `${name}${suffix}.svg`), "utf8"))]);

const literal = (entries) => `[\n${entries.map(([name, paths]) => `  [${JSON.stringify(name)}, ${JSON.stringify(paths)}],`).join("\n")}\n]`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(
    join(here, "phosphor.ts"),
    `// Сгенерировано generate-phosphor.mjs из @phosphor-icons/core (MIT) — не править руками.
// Знаки Phosphor по имени: пути в ящике PHOSPHOR_BOX, залитые заливкой currentColor.

/** Сторона ящика, в котором нарисованы пути Phosphor. */
export const PHOSPHOR_BOX = 256;

/** Линейные знаки (начертание regular). */
export const PHOSPHOR_LINE: ReadonlyMap<string, readonly string[]> = new Map(${literal(weight("regular", ""))});

/** Залитые знаки (начертание fill). */
export const PHOSPHOR_FILL: ReadonlyMap<string, readonly string[]> = new Map(${literal(weight("fill", "-fill"))});
`,
  );
}
