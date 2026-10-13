// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PropertiesGrid, propertyProblem, putPatch } from "./properties.js";

afterEach(cleanup);

describe("what an edit does to the set", () => {
  const set = { phone: "1", city: "Riga" };

  it("patches only the name it touches, and nothing when nothing changed", () => {
    expect(putPatch(set, "phone", "tel", "2")).toEqual({ rename: { phone: "tel" }, set: { tel: "2" } });
    expect(putPatch(set, "city", "city", "Oslo")).toEqual({ set: { city: "Oslo" } });
    expect(putPatch(set, null, "zip", "1")).toEqual({ set: { zip: "1" } });
    expect(putPatch(set, "city", "city", "Riga")).toBeNull();
  });

  it("refuses a blank name, a board field and a name the record has", () => {
    expect(propertyProblem(set, null, "")).toMatch(/needs a name/);
    expect(propertyProblem(set, null, "due")).toMatch(/field of the board/);
    expect(propertyProblem(set, null, "city")).toMatch(/already has/);
    expect(propertyProblem(set, "city", "city")).toBeNull();
  });
});

describe("PropertiesGrid", () => {
  it("shows a row per property with its value", () => {
    render(<PropertiesGrid properties={{ phone: "+7 900" }} onSave={() => {}} />);
    expect(screen.getByRole("button", { name: "Rename phone" }).textContent).toBe("phone");
    expect(screen.getByText("+7 900")).toBeTruthy();
  });

  it("adds a property from the Add button", () => {
    const onSave = vi.fn();
    render(<PropertiesGrid properties={{ phone: "1" }} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /Add property/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Property name" }), { target: { value: "city" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Value of city" }), { target: { value: "Riga" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Value of city" }), { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith({ set: { city: "Riga" } });
  });

  it("renames and edits a property by clicking its row", () => {
    const onSave = vi.fn();
    render(<PropertiesGrid properties={{ phone: "1", city: "Riga" }} onSave={onSave} />);
    fireEvent.click(screen.getByText("Riga"));
    fireEvent.change(screen.getByRole("textbox", { name: "Property name" }), { target: { value: "town" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Value of town" }), { target: { value: "Oslo" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Value of town" }), { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith({ rename: { city: "town" }, set: { town: "Oslo" } });
  });

  it("removes a property with its minus, without opening it", () => {
    const onSave = vi.fn();
    render(<PropertiesGrid properties={{ phone: "1", city: "Riga" }} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove phone" }));
    expect(onSave).toHaveBeenCalledWith({ remove: ["phone"] });
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("says why a name is refused and saves nothing; Escape gives up", () => {
    const onSave = vi.fn();
    render(<PropertiesGrid properties={{ phone: "1" }} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /Add property/ }));
    const name = screen.getByRole("textbox", { name: "Property name" });
    fireEvent.change(name, { target: { value: "phone" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toMatch(/already has/);
    fireEvent.keyDown(name, { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("draws under the Shapeshift root in the host's theme", () => {
    document.documentElement.classList.add("dark");
    const { container } = render(<PropertiesGrid properties={{}} onSave={() => {}} />);
    expect(container.querySelector(".ss-root")?.getAttribute("data-ss-theme")).toBe("Dark");
    document.documentElement.classList.remove("dark");
  });
});
