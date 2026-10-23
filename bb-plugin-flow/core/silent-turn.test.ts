// @vitest-environment node
import { describe, expect, it } from "vitest";

import { kimiSessionsOf, lastKimiTurnEnd, newestTurnEnd, silentTurnOf, SILENT_WINDOW_MS } from "./silent-turn";

const LIMIT = "429 You've reached your 5-hour usage limit. Your quota will reset when the current 5-hour window ends.";

// Строки — из настоящего журнала сессии Kimi, где тред Flow молча не отвечал на «?».
const failedTurn = [
  `{"type":"turn.prompt","agentId":"main","input":[{"type":"text","text":"?"}]}`,
  `{"turnId":5,"outcome":"failed","errorMessage":"[object Object]","type":"agent.turn.ended","time":1792680521453,"kind":"event"}`,
  `{"type":"turn.ended","agentId":"main","turnId":5,"reason":"failed","error":{"code":"provider.api_error","message":"${LIMIT}","name":"APIProviderQuotaExhaustedError"},"durationMs":1668,"time":1792680521489}`,
  `{"type":"prompt.completed","agentId":"main","promptId":"msg_1","reason":"failed","time":1792680521490}`,
].join("\n");

const okTurn = `{"type":"turn.ended","agentId":"main","turnId":4,"reason":"completed","time":1792670867550}`;

describe("журнал сессии Kimi", () => {
  it("находит провал последнего хода и слова провайдера", () => {
    expect(lastKimiTurnEnd(`${okTurn}\n${failedTurn}`)).toEqual({ at: 1792680521489, failed: true, message: LIMIT });
  });

  it("успешный последний ход — не провал", () => {
    expect(lastKimiTurnEnd(`${failedTurn}\n${okTurn}\n`)).toEqual({ at: 1792670867550, failed: false, message: null });
  });

  it("обрывок строки в начале хвоста и конец хода субагента пропускаются", () => {
    const sub = `{"type":"turn.ended","agentId":"agent-0","turnId":1,"reason":"completed","time":1792680521999}`;
    expect(lastKimiTurnEnd(`ed","time":1}\n${failedTurn}\n${sub}`)?.failed).toBe(true);
  });

  it("журнал без конца хода — ничего", () => {
    expect(lastKimiTurnEnd("")).toBeNull();
    expect(lastKimiTurnEnd(`{"type":"turn.prompt"}`)).toBeNull();
  });

  it("сессии берутся только той рабочей папки, где идёт тред", () => {
    const index = [
      `{"sessionId":"s1","sessionDir":"/k/s1","workDir":"/wt/a"}`,
      `{"sessionId":"s2","sessionDir":"/k/s2","workDir":"/wt/b"}`,
      `битая строка`,
      `{"sessionId":"s3","sessionDir":"/k/s3","workDir":"/wt/a"}`,
    ].join("\n");
    expect(kimiSessionsOf(index, "/wt/a")).toEqual(["/k/s1", "/k/s3"]);
  });
});

describe("немой ход", () => {
  const end = { at: 1_000_000, failed: true, message: LIMIT };

  it("провал с 429 рядом с простоем — немой ход по лимиту", () => {
    expect(silentTurnOf(end, end.at + 2_000)).toEqual({ kind: "quota", message: LIMIT, at: end.at });
  });

  it("провал без слов — немой ход с неизвестной причиной", () => {
    expect(silentTurnOf({ ...end, message: null }, end.at)).toEqual({ kind: "error", message: null, at: end.at });
  });

  it("успешный ход и старый провал — не немой ход", () => {
    expect(silentTurnOf({ ...end, failed: false }, end.at)).toBeNull();
    expect(silentTurnOf(end, end.at + SILENT_WINDOW_MS + 1)).toBeNull();
    expect(silentTurnOf(null, end.at)).toBeNull();
  });

  it("из нескольких сессий одной папки берётся закончившая ход последней", () => {
    const older = { at: 1, failed: true, message: null };
    const newer = { at: 2, failed: false, message: null };
    expect(newestTurnEnd([older, null, newer])).toBe(newer);
    expect(newestTurnEnd([null])).toBeNull();
  });
});
