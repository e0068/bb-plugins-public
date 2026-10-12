// Слой 1 — константы настроек агента flow: значения effort и скорости, как их принимает bb, и предел стартового сообщения.

/** Effort — `reasoningLevel` bb. */
export const REASONING_LEVELS = ["none", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode"] as const;

/** Скорость — `serviceTier` bb: Fast mode — `fast`. */
export const SERVICE_TIERS = ["default", "fast"] as const;

/** Стартовое сообщение агенту: вместе с правилом Flow влезает в 4096 символов инструкций сессии. */
export const MAX_START_MESSAGE_CHARS = 4000;
