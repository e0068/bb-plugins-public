// Каналы realtime между сервером Flow и страницей: имя одно на обе стороны,
// а фронт не берёт значений из серверных модулей.

/** Коллекция flow поменялась на сервере — со страницы, от агента или из папки синхронизации. Имя — со времён Decisions. */
export const STAGE_SETTINGS_CHANNEL = "decisions:stage-settings";

/** Поменялся итог сверки папки синхронизации или сама папка. */
export const FLOW_SYNC_CHANNEL = "flow:sync";
