// Вход пакета для плагинов, которые исполняют шаги набора Pull Request сами.
// Automations берёт помощники напрямую из shell/pr-helpers.ts: он строит на них
// ещё и состояние своих кнопок.
export { isStepId, STEP_IDS, STEP_LABELS, type StepId } from "./catalog";
export { createSteps, selfUpdatePendingKey, SELF_UPDATE_PENDING_PREFIX, type StepOutcome, type StepPorts, type Steps } from "./steps";
// Порт плагинов хоста — его передаёт плагин-исполнитель в `StepPorts`, поэтому он живёт на той же поверхности, что и шаги.
export type { PluginsPort, ReinstallReport } from "./wiring/plugin-reinstall";
