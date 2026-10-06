// @vitest-environment jsdom

import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

afterEach(cleanup);

function renderBoardColumnsSettings(stored: unknown, load: () => unknown = () => stored) {
  const section = app.settingsSections.find((entry) => entry.id === "board-columns");
  return renderSlot(
    { component: section!.component },
    {},
    { rpc: { loadColumnWidthBounds: load, saveColumnWidthBounds: () => ({ ok: true }) } },
  );
}

const saves = (slot: ReturnType<typeof renderBoardColumnsSettings>) =>
  slot.inspection.rpcCalls.filter(({ method }) => method === "saveColumnWidthBounds").map(({ input }) => input);

const type = (input: HTMLElement, value: string) => {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

describe("Board columns settings — the bounds of a column's width", () => {
  it("shows the stored minimum, default and maximum in pixels", async () => {
    const slot = renderBoardColumnsSettings({ min: 150, initial: 320, max: 900 });
    await waitFor(() => expect((slot.getByLabelText("Minimum width") as HTMLInputElement).value).toBe("150"));
    expect((slot.getByLabelText("Default width") as HTMLInputElement).value).toBe("320");
    expect((slot.getByLabelText("Maximum width") as HTMLInputElement).value).toBe("900");
  });

  it("stores the three numbers once a changed field is left", async () => {
    const slot = renderBoardColumnsSettings({ min: 200, initial: 230, max: 480 });
    const max = await slot.findByLabelText("Maximum width");
    await waitFor(() => expect((max as HTMLInputElement).value).toBe("480"));
    type(max, "800");
    await waitFor(() => expect(saves(slot)).toEqual([{ min: 200, initial: 230, max: 800 }]));
  });

  it("does not store a minimum above the maximum and says why", async () => {
    const slot = renderBoardColumnsSettings({ min: 200, initial: 230, max: 480 });
    const min = await slot.findByLabelText("Minimum width");
    await waitFor(() => expect((min as HTMLInputElement).value).toBe("200"));
    type(min, "600");
    expect((await slot.findByRole("alert")).textContent).toBe("Minimum must not exceed maximum.");
    expect(saves(slot)).toEqual([]);
  });

  it("does not store what is not a number of pixels", async () => {
    const slot = renderBoardColumnsSettings({ min: 200, initial: 230, max: 480 });
    const min = await slot.findByLabelText("Minimum width");
    await waitFor(() => expect((min as HTMLInputElement).value).toBe("200"));
    type(min, "");
    expect((await slot.findByRole("alert")).textContent).toBe("Enter whole numbers of pixels.");
    expect(saves(slot)).toEqual([]);
  });

  it("clears the reason once the numbers are right again", async () => {
    const slot = renderBoardColumnsSettings({ min: 200, initial: 230, max: 480 });
    const min = await slot.findByLabelText("Minimum width");
    await waitFor(() => expect((min as HTMLInputElement).value).toBe("200"));
    type(min, "600");
    await slot.findByRole("alert");
    type(min, "220");
    await waitFor(() => expect(slot.queryByRole("alert")).toBeNull());
    expect(saves(slot)).toEqual([{ min: 220, initial: 230, max: 480 }]);
  });

  it("stores nothing when a field is left with the numbers that are already stored", async () => {
    const slot = renderBoardColumnsSettings({ min: 200, initial: 230, max: 480 });
    const min = await slot.findByLabelText("Minimum width");
    await waitFor(() => expect((min as HTMLInputElement).value).toBe("200"));
    type(min, "0200");
    fireEvent.blur(await slot.findByLabelText("Maximum width"));
    expect(saves(slot)).toEqual([]);
    expect((min as HTMLInputElement).value).toBe("200");
  });

  it("ties the reason to the fields it is about, for a screen reader", async () => {
    const slot = renderBoardColumnsSettings({ min: 200, initial: 230, max: 480 });
    const min = await slot.findByLabelText("Minimum width");
    await waitFor(() => expect((min as HTMLInputElement).value).toBe("200"));
    expect(min.getAttribute("aria-invalid")).toBe("false");
    type(min, "600");
    const reason = await slot.findByRole("alert");
    expect(min.getAttribute("aria-invalid")).toBe("true");
    expect(min.getAttribute("aria-describedby")).toBe(reason.id);
  });

  it("says so when the stored bounds could not be read, instead of showing defaults as stored", async () => {
    const slot = renderBoardColumnsSettings(undefined, () => {
      throw new Error("down");
    });
    expect((await slot.findByRole("alert")).textContent).toContain("Could not load");
    expect(slot.queryByLabelText("Minimum width")).toBeNull();
  });
});
