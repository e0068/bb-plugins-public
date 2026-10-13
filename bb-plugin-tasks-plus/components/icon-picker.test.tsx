// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IconPicker } from "./icon-picker";

afterEach(cleanup);

const tab = (name: string) => screen.getByRole("button", { name });
const search = (text: string) => fireEvent.change(screen.getByLabelText("Search icons"), { target: { value: text } });

describe("the icon picker", () => {
  it("picks a line icon on the Line tab", () => {
    const onPick = vi.fn();
    render(<IconPicker color="steelblue" onPick={onPick} />);

    search("rocket");
    fireEvent.click(screen.getByRole("button", { name: "Rocket" }));

    expect(onPick).toHaveBeenCalledWith("Rocket");
  });

  it("finds an emoji by an English word on the Emoji tab", () => {
    const onPick = vi.fn();
    render(<IconPicker color="steelblue" onPick={onPick} />);

    fireEvent.click(tab("Emoji"));
    search("launch");
    fireEvent.click(screen.getByRole("button", { name: "🚀" }));

    expect(onPick).toHaveBeenCalledWith("🚀");
  });

  it("opens on the tab of the icon already chosen, with it pressed", () => {
    render(<IconPicker value="🚀" onPick={() => {}} />);

    expect(tab("Emoji").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "🚀" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("says so when nothing matches", () => {
    render(<IconPicker onPick={() => {}} />);
    search("zzzz");
    expect(screen.getByText("No icons match.")).toBeTruthy();
  });

  it("takes the icon off with Remove, when it may", () => {
    const onClear = vi.fn();
    render(<IconPicker value="Rocket" onPick={() => {}} onClear={onClear} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove icon" }));

    expect(onClear).toHaveBeenCalled();
  });
});
