// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { commandsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const directive = () => app.messageDirectives.find((d) => d.id === "command")!;

const open = (id: string, found = true) =>
  renderSlot<PluginMessageDirectiveProps, typeof commandsRpcContract>(
    directive(),
    { attributes: { id }, source: `::command{id="${id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: null },
    {
      rpc: {
        getCommand: () => (found ? { kind: "found", command: { id, threadId: "thr_1", command: "cd bb-plugin-decisions && bb plugin build", createdAt: "2026-09-15T12:00:00.000Z" } } : { kind: "not_found" }),
        runCommand: () => ({ kind: "sent", created: false }),
      },
    },
  );

describe("блок команды в сообщении", () => {
  it("регистрирует директиву command рядом с decision", () => {
    expect(app.messageDirectives.map((d) => d.id).sort()).toEqual(["command", "decision"]);
  });

  it("показывает команду; перенос переключается", async () => {
    const slot = open("cmd_1");
    expect(await slot.findByText("cd bb-plugin-decisions && bb plugin build")).toBeTruthy();
    const wrap = slot.getByRole("button", { name: "Переносить строки" });
    expect(wrap.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(wrap);
    expect(wrap.getAttribute("aria-pressed")).toBe("true");
  });

  it("копирование кладёт команду в буфер", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const slot = open("cmd_1");
    fireEvent.click(await slot.findByRole("button", { name: "Скопировать" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("cd bb-plugin-decisions && bb plugin build"));
  });

  it("исход копирования и ввода объявляется живой строкой состояния", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => {}) } });
    const slot = open("cmd_1");
    fireEvent.click(await slot.findByRole("button", { name: "Скопировать" }));
    await waitFor(() => expect(slot.getByRole("status").textContent).toBe("Скопировано"));
    fireEvent.click(slot.getByRole("button", { name: "Выполнить в терминале" }));
    await waitFor(() => expect(slot.getByRole("status").textContent).toBe("Отправлено в терминал треда"));
  });

  it("ввод выполняет команду в терминале один раз", async () => {
    const slot = open("cmd_1");
    fireEvent.click(await slot.findByRole("button", { name: "Выполнить в терминале" }));
    await waitFor(() => expect(slot.rpcCalls.filter((c) => c.method === "runCommand")).toHaveLength(1));
    expect(slot.rpcCalls.find((c) => c.method === "runCommand")?.input).toEqual({ id: "cmd_1" });
  });

  it("неизвестная команда рисуется пунктиром с исходным текстом директивы", async () => {
    const slot = open("cmd_gone", false);
    expect(await slot.findByText('::command{id="cmd_gone"}')).toBeTruthy();
  });
});
