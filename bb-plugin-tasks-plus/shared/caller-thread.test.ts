// @vitest-environment node
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  CALLER_SCOPED_METHODS,
  tasksRpcContract,
  withCallerThread,
} from "./contract.js";
import { delegationRpcContract } from "../delegate/contract.js";

/**
 * Обработчик RPC по контракту SDK получает только вход метода — контекста
 * вызова у него нет. Поэтому тред, из которого смотрит интерфейс, едет полем
 * входа, и оно обязано быть в схеме: `.strict()` отвергает всё, чего в схеме
 * нет, и запрос падал бы на валидации, не дойдя до обработчика.
 */
/** Отверг ли разбор поле как незнакомое — единственный вопрос про `.strict()`,
 *  на который можно ответить, не сочиняя валидный вход каждого метода. */
function unrecognized(
  result: z.ZodSafeParseResult<unknown>,
  key: string,
): boolean {
  if (result.success) return false;
  return result.error.issues.some(
    (issue) =>
      issue.code === "unrecognized_keys" && issue.keys.includes(key),
  );
}

describe("CALLER_SCOPED_METHODS", () => {
  it("перечисляет только существующие методы — из обоих контрактов плагина", () => {
    const known = new Set([
      ...Object.keys(tasksRpcContract),
      ...Object.keys(delegationRpcContract),
    ]);
    for (const method of CALLER_SCOPED_METHODS) {
      expect([...known], method).toContain(method);
    }
  });

  it("вход каждого задачного метода принимает тред вызывающего", () => {
    const contracts: Record<string, { input: z.ZodType }> = {
      ...tasksRpcContract,
      ...delegationRpcContract,
    };
    for (const method of CALLER_SCOPED_METHODS) {
      const result = contracts[method]!.input.safeParse({ callerThreadId: "thr_1" });
      expect(unrecognized(result, "callerThreadId"), method).toBe(false);
    }
  });

  it("методы доски треда не получают — они читают kv, а не файлы задач", () => {
    for (const method of [
      "createFolder",
      "createProject",
      "listLabels",
      "analyticsSnapshot",
    ] as const) {
      const result = tasksRpcContract[method].input.safeParse({
        callerThreadId: "thr_1",
      });
      expect(unrecognized(result, "callerThreadId"), method).toBe(true);
    }
  });
});

describe("withCallerThread", () => {
  const schema = withCallerThread(z.object({ taskId: z.string() }).strict());

  it("принимает запрос с тредом", () => {
    expect(schema.parse({ taskId: "t1", callerThreadId: "thr_1" })).toEqual({
      taskId: "t1",
      callerThreadId: "thr_1",
    });
  });

  it("принимает запрос без треда — так ходит доска", () => {
    expect(schema.parse({ taskId: "t1" })).toEqual({ taskId: "t1" });
  });

  it("остаётся строгим к остальным полям", () => {
    expect(() => schema.parse({ taskId: "t1", uninvited: 1 })).toThrow();
  });

  it("отвергает тред не строкой", () => {
    expect(() => schema.parse({ taskId: "t1", callerThreadId: 7 })).toThrow();
  });
});
