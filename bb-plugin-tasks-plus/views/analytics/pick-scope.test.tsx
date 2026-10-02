// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { afterEach, describe, expect, it } from "vitest";

import { PANEL, PickScope, useKeepClick, useOutsideReset } from "./pick-scope";

afterEach(cleanup);

/** A tile stand-in: a pick a click on it sets, and a portal of its own — as a table's menu is. */
function Tile({ id }: { id: string }) {
  const [picked, setPicked] = useState(false);
  const keep = useKeepClick(id);
  useOutsideReset(id, picked, () => setPicked(false));
  return (
    <div onClickCapture={keep}>
      <button type="button" onClick={() => setPicked(true)}>{`pick ${id}`}</button>
      <span>{picked ? `${id} picked` : `${id} free`}</span>
      {createPortal(<button type="button">{`menu ${id}`}</button>, document.body)}
    </div>
  );
}

function Panel() {
  return (
    <div onClickCapture={useKeepClick(PANEL)}>
      <button type="button">panel</button>
    </div>
  );
}

function renderPage() {
  return render(
    <PickScope>
      <Tile id="a" />
      <Tile id="b" />
      <Panel />
      <p>page</p>
    </PickScope>,
  );
}

describe("a pick on a tile against clicks around it", () => {
  it("drops the pick on a click anywhere on the page", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "pick a" }));
    expect(screen.getByText("a picked")).toBeTruthy();
    fireEvent.click(screen.getByText("page"));
    expect(screen.getByText("a free")).toBeTruthy();
  });

  it("keeps the pick on a click inside the tile, in its portal and in the panel", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "pick a" }));
    fireEvent.click(screen.getByText("a picked"));
    fireEvent.click(screen.getByRole("button", { name: "menu a" }));
    fireEvent.click(screen.getByRole("button", { name: "panel" }));
    expect(screen.getByText("a picked")).toBeTruthy();
  });

  it("drops the pick on a click on another tile", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "pick a" }));
    fireEvent.click(screen.getByRole("button", { name: "menu b" }));
    expect(screen.getByText("a free")).toBeTruthy();
  });
});
