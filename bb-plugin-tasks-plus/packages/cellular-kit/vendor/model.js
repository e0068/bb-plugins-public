// kit/model.js — ESM-фасад над рантаймом темы (слой 4). Даёт киту именованные экспорты
// applyBaked/driveBaked/toDesignTokens/bake, чтобы потребитель писал `import { applyBaked } from
// "@cellular/kit"`, а не грузил рантайм отдельным <script>.
//
// Почему через globalThis, а не `export`-версия рантайма: cellular-model.js — ЗАМОРОЖЕННЫЙ UMD,
// который один и тот же файл обязан отдавать тремя способами — classic-<script> (window.CellularModel
// в public/lab.html), CommonJS require() (~12 узловых тестов) и нативный ESM-import (кит). Верхне-
// уровневый `export` — синтаксис только модуля: добавить его в UMD-файл нельзя, не сломав Лабу и
// тесты. Поэтому кит везёт БАЙТ-КОПИЮ рантайма (./cellular-model.js, гейт байт-равенства —
// test/kit/runtime-copy-sync.test.js), а этот фасад берёт его API с глобала, куда UMD его положил.
// ROOT выбирается ТОЧНО как в самом UMD (window, иначе globalThis) — иначе под jsdom (где определён
// global window) UMD пишет window.CellularModel, а чтение globalThis.CellularModel промахивается и
// весь кит перестаёт импортироваться. См. docs/decisions/kit-runtime-esm-facade.md.
import "./cellular-model.js";

const ROOT = typeof window !== "undefined" ? window : globalThis;
const M = ROOT.CellularModel;

export const applyBaked = M.applyBaked;
export const driveBaked = M.driveBaked;
export const toDesignTokens = M.toDesignTokens;
export const bake = M.bake;
