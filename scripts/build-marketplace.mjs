#!/usr/bin/env node
// Собирает marketplace.json — витрину этого публичного репозитория для bb.
//
// Правило: плагин попадает на витрину ТОЛЬКО если в его package.json есть
//   "bbMarketplace": { "public": true, "tags"?: [...] }
// Плагин без маркера остаётся в репо как исходник для коллег, но не публикуется.
//
// id, имя, описание и иконку генератор берёт из bb-манифеста плагина —
// метаданные не дублируются. source указывает на этот же репозиторий.
//
//   node scripts/build-marketplace.mjs           перезаписать marketplace.json
//   node scripts/build-marketplace.mjs --check    упасть, если файл разошёлся со сборкой

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// Этот публичный репозиторий: bb ставит плагины отсюда.
const REPO = {
  url: "https://github.com/e0068/bb-plugins-public.git",
  ref: "main",
};

const MARKETPLACE = {
  $schema: "https://getbb.app/schemas/marketplace.schema.json",
  schemaVersion: 1,
  name: "e0068",
  displayName: "BB Plugins Public",
  description: "Публичные плагины для bb от e0068 и команды.",
};
const AUTHOR = { name: "e0068", github: "e0068" };

function iconFor(id, dir, bb) {
  const raw = bb?.branding?.icon;
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error(`${id}: у плагина нет bb.branding.icon`);
  }
  if (/^[A-Za-z][A-Za-z0-9]*$/.test(raw)) return raw; // host-icon имя
  return { url: `${dir}/${raw.replace(/^\.\//, "")}` }; // относительный путь к файлу
}

const names = readdirSync(ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name.startsWith("bb-plugin-"))
  .map((e) => e.name)
  .sort();

const marked = [];
for (const dir of names) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8"));
  } catch {
    continue;
  }
  const mk = pkg.bbMarketplace;
  if (!mk || mk.public !== true) continue; // не помечен — не публикуем

  const bb = pkg.bb || {};
  const id = pkg.name.replace(/^bb-plugin-/, "");
  marked.push({
    id,
    displayName: bb.name || id,
    description: bb.description || pkg.description || id,
    icon: iconFor(id, dir, bb),
    ...(Array.isArray(mk.tags) && mk.tags.length ? { tags: mk.tags } : {}),
    author: AUTHOR,
    source: { git: { url: REPO.url, subdir: dir, ref: REPO.ref } },
  });
}
marked.sort((a, b) => a.id.localeCompare(b.id));

const json = JSON.stringify({ ...MARKETPLACE, plugins: marked }, null, 2) + "\n";
const OUT = join(ROOT, "marketplace.json");
const list = marked.map((p) => p.id).join(", ") || "(пусто)";

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8");
  } catch {}
  if (current !== json) {
    console.error("marketplace.json разошёлся со сборкой — запусти: node scripts/build-marketplace.mjs");
    process.exit(1);
  }
  console.log("marketplace.json актуален.");
} else {
  writeFileSync(OUT, json);
  console.log(`marketplace.json: ${marked.length} плагин(ов) на витрине: ${list}`);
}
