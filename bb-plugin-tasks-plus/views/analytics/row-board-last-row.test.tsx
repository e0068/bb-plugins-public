// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RowBoard } from "./row-board";

afterEach(cleanup);

describe("RowBoard — the last row", () => {
  it("keeps its own height, so a long tile scrolls inside instead of growing the row", () => {
    const { container } = render(
      <RowBoard
        layout={{ rows: [
          { id: "r1", height: 100, minHeight: 60, cells: [{ id: "a", weight: 1 }] },
          { id: "r2", height: 360, minHeight: 200, cells: [{ id: "b", weight: 1 }] },
        ] }}
        stacked={false}
        onChange={() => {}}
        renderCell={(id) => <section>{id}</section>}
      />,
    );
    const last = container.querySelector<HTMLElement>('[data-row="r2"]')!;
    expect(last.style.height).toBe("360px");
  });
});
