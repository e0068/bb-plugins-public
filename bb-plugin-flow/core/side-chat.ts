// Слой 1 — чисто. Side chat — тред, который bb заводит встроенным плагином side-chat для вопроса сбоку от основного
// чата. Flow такой тред не ведёт: ни flow, ни прогона, ни своих виджетов в его композере.

export const SIDE_CHAT_PLUGIN_ID = "side-chat";

/** Тред создан плагином Side chat. */
export const isSideChat = (thread: { originPluginId?: string | null }): boolean => thread.originPluginId === SIDE_CHAT_PLUGIN_ID;
