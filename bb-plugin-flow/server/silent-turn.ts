// Немые ходы тредов с flow: на простое треда Kimi сервер читает журнал его
// сессии и, если ход там провален, держит для треда плашку с причиной, пока
// тред не начнёт следующий ход. Плашки живут в памяти: после перезапуска
// плагина старая причина уже не новость. Правило — core/silent-turn.ts.
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { KIMI_PROVIDER, kimiSessionsOf, lastKimiTurnEnd, newestTurnEnd, silentTurnOf, type SilentTurn } from "../core/silent-turn";
import { silentTurnRpcContract } from "../shared/contract";

/** Хвост журнала: конец хода — последние строки, а файл сессии растёт до мегабайтов. */
const TAIL_BYTES = 256 * 1024;

export interface SilentTurnPorts {
  /** Текст файла целиком или его хвост в `tail` байт; файла нет — `null`. */
  readText: (path: string, tail?: number) => Promise<string | null>;
  /** Папка Kimi Code: в ней session_index.jsonl и сессии. */
  kimiHome: string;
  now: () => number;
}

export interface SilentTurns {
  /** Простой треда: проверить журнал и поставить или снять плашку. */
  check: (threadId: string, thread: { providerId: string | null; workDir: string | null }) => Promise<SilentTurn | null>;
  /** Тред начал ход — старая причина больше не про него. */
  clear: (threadId: string) => void;
  get: (threadId: string) => SilentTurn | null;
}

export function createSilentTurns(ports: SilentTurnPorts): SilentTurns {
  const notices = new Map<string, SilentTurn>();
  const find = async (workDir: string): Promise<SilentTurn | null> => {
    const index = await ports.readText(join(ports.kimiHome, "session_index.jsonl"));
    if (index === null) return null;
    const ends = await Promise.all(kimiSessionsOf(index, workDir).map(async (dir) => lastKimiTurnEnd((await ports.readText(join(dir, "agents", "main", "wire.jsonl"), TAIL_BYTES)) ?? "")));
    return silentTurnOf(newestTurnEnd(ends), ports.now());
  };
  return {
    async check(threadId, { providerId, workDir }) {
      notices.delete(threadId);
      if (providerId !== KIMI_PROVIDER || workDir === null) return null;
      // Журнал не прочитался — плашки нет: ложная тревога хуже молчания, которое было и раньше.
      const silent = await find(workDir).catch(() => null);
      if (silent !== null) notices.set(threadId, silent);
      return silent;
    },
    clear: (threadId) => void notices.delete(threadId),
    get: (threadId) => notices.get(threadId) ?? null,
  };
}

/** Плашку читает баннер над композером; начатый ход её снимает. */
export function registerSilentTurns(bb: Pick<BbPluginApi, "rpc" | "events">, turns: SilentTurns): void {
  bb.rpc.register(silentTurnRpcContract, {
    async getSilentTurn({ threadId }) {
      return turns.get(threadId);
    },
  });
  bb.events.on("thread.active", ({ thread }) => turns.clear(thread.id));
}

/** Чтение с диска: хвост — последними байтами файла, без загрузки целиком. */
export const readTextFromDisk = async (path: string, tail?: number): Promise<string | null> => {
  const file = await open(path, "r").catch(() => null);
  if (file === null) return null;
  try {
    const { size } = await file.stat();
    const length = tail === undefined ? size : Math.min(size, tail);
    const buffer = Buffer.alloc(length);
    await file.read(buffer, 0, length, size - length);
    return buffer.toString("utf8");
  } finally {
    await file.close();
  }
};

export const defaultKimiHome = (): string => join(homedir(), ".kimi-code");
