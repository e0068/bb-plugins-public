// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  CallerThreadProvider,
  useCallerThreadId,
  withCallerThreadInput,
} from "./caller-thread.js";

afterEach(cleanup);

/**
 * Клиент RPC один на всё приложение, а тред известен только внутри
 * поверхностей треда. Провайдер объявляет его один раз, и любой вид,
 * смонтированный внутри, шлёт задачные вызовы с тредом, ничего о нём не зная.
 */
describe("withCallerThreadInput", () => {
  it("добавляет тред задачному методу", () => {
    expect(withCallerThreadInput("listTasks", { limit: 5 }, "thr_1")).toEqual({
      limit: 5,
      callerThreadId: "thr_1",
    });
  });

  it("без треда вход не трогает", () => {
    expect(withCallerThreadInput("listTasks", { limit: 5 }, null)).toEqual({ limit: 5 });
  });

  it("методу вне списка тред не добавляет — доска читает kv, а не файлы", () => {
    expect(withCallerThreadInput("listPresets", null, "thr_1")).toBeNull();
    expect(withCallerThreadInput("createProject", { name: "p" }, "thr_1")).toEqual({
      name: "p",
    });
  });

  it("не перебивает тред, названный самим вызовом", () => {
    expect(
      withCallerThreadInput("listTasks", { callerThreadId: "thr_explicit" }, "thr_1"),
    ).toEqual({ callerThreadId: "thr_explicit" });
  });

  it("оставляет вход без объекта как есть", () => {
    expect(withCallerThreadInput("listTasks", null, "thr_1")).toBeNull();
    expect(withCallerThreadInput("listTasks", undefined, "thr_1")).toBeUndefined();
  });
});

describe("CallerThreadProvider", () => {
  it("вне провайдера треда нет — так ходит доска", () => {
    const { result } = renderHook(() => useCallerThreadId());
    expect(result.current).toBeNull();
  });

  it("внутри провайдера отдаёт его тред", () => {
    const { result } = renderHook(() => useCallerThreadId(), {
      wrapper: ({ children }) => (
        <CallerThreadProvider threadId="thr_1">{children}</CallerThreadProvider>
      ),
    });
    expect(result.current).toBe("thr_1");
  });
});
