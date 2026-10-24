// bb 0.47.1 больше не отдаёт PR окружения через SDK, и его сигнал всегда «неизвестно». Шаг «Открыть PR» решает по живому
// ответу GitHub: он сильнее сигнала bb, а без него решает сигнал bb, как раньше.
import { describe, expect, it } from "vitest";

import { decideVisibility, presenceForCreate, type PrPresence } from "./visibility";

const PRESENCES: readonly PrPresence[] = ["absent", "open", "settled", "unknown"];

describe("presenceForCreate", () => {
  it("GitHub ответил, что открытого PR у ветки нет, — PR можно открывать при любом сигнале bb", () => {
    for (const host of PRESENCES) expect(presenceForCreate(host, { asked: true, open: false })).toBe("absent");
  });

  it("GitHub нашёл открытый PR — он открыт при любом сигнале bb", () => {
    for (const host of PRESENCES) expect(presenceForCreate(host, { asked: true, open: true })).toBe("open");
  });

  it("GitHub спросить не вышло — решает сигнал bb", () => {
    for (const host of PRESENCES) expect(presenceForCreate(host, { asked: false })).toBe(host);
  });

  it("неизвестный сигнал bb больше не запирает ветку с коммитами, когда GitHub ответил «PR нет»", () => {
    const pr = presenceForCreate("unknown", { asked: true, open: false });
    expect(decideVisibility({ hasUncommittedChanges: false, aheadCount: 2, pr })).toEqual({ visible: true, reason: "ready" });
  });
});
