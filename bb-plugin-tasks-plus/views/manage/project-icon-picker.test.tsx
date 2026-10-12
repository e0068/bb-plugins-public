// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareBoardDom } from "../../test-support/board-harness.js";
import { ProjectIconPicker } from "./project-icon-picker";

prepareBoardDom();
afterEach(cleanup);

function open(props: Partial<Parameters<typeof ProjectIconPicker>[0]> = {}) {
  const onIcon = vi.fn<(icon: string) => void>();
  const onColor = vi.fn<(color: string) => void>();
  render(<ProjectIconPicker icon="Puzzle" color="steelblue" label="Icon and color of bb-plugins" onIcon={onIcon} onColor={onColor} {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Icon and color of bb-plugins" }));
  return { onIcon, onColor };
}

const iconButtons = () => screen.queryAllByRole("button").filter((button) => button.hasAttribute("data-icon-name"));

describe("one button for a project's icon and colour", () => {
  it("opens the colours above a searchable grid of the catalog's icons", async () => {
    open();
    await waitFor(() => expect(screen.queryByRole("radiogroup", { name: "Color" })).not.toBeNull());
    expect(screen.getByRole("textbox", { name: /search icons/i })).toBeTruthy();
    expect(iconButtons().length).toBeGreaterThan(200);
  });

  it("narrows the grid to the icons whose name holds what is typed, case aside", async () => {
    open();
    const search = await screen.findByRole("textbox", { name: /search icons/i });
    fireEvent.change(search, { target: { value: "rOcKeT" } });
    await waitFor(() => expect(iconButtons().length).toBeLessThan(10));
    const names = iconButtons().map((button) => button.getAttribute("data-icon-name")!);
    expect(names).toContain("Rocket");
    expect(names.every((name) => name.toLowerCase().includes("rocket"))).toBe(true);
  });

  it("hands over the picked icon and closes", async () => {
    const { onIcon } = open();
    const search = await screen.findByRole("textbox", { name: /search icons/i });
    fireEvent.change(search, { target: { value: "Bug01" } });
    fireEvent.click(await screen.findByRole("button", { name: "Bug01" }));
    expect(onIcon).toHaveBeenCalledWith("Bug01");
    await waitFor(() => expect(screen.queryByRole("textbox", { name: /search icons/i })).toBeNull());
  });

  it("hands over a picked colour and stays open for the icon", async () => {
    const { onColor, onIcon } = open();
    fireEvent.click(await screen.findByRole("radio", { name: "Red" }));
    expect(onColor).toHaveBeenCalledTimes(1);
    expect(onIcon).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: /search icons/i })).not.toBeNull();
  });
});
