// Слой 1 — константы настроек агента flow: значения effort и скорости, как их принимает bb, и предел стартового сообщения.

/** Effort — `reasoningLevel` bb. */
export const REASONING_LEVELS = ["none", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode"] as const;

/** Скорость — `serviceTier` bb: Fast mode — `fast`. */
export const SERVICE_TIERS = ["default", "fast"] as const;

/** Стартовое сообщение агенту: вместе с правилом Flow влезает в 4096 символов инструкций сессии. */
export const MAX_START_MESSAGE_CHARS = 4000;

/** Вклад Flow в инструкции хода: всё, что длиннее, bb обрезает, и этапы за обрезом агенту неизвестны. */
export const INSTRUCTIONS_LIMIT_CHARS = 4096;

/** Строка, которую терминал владельца принимает целиком: длиннее он обрезает, и в терминал уходит кусок команды. */
export const TERMINAL_COMMAND_MAX_CHARS = 1024;
