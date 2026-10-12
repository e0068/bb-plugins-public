// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ICON_CATALOG } from "@bb-plugins/icon-catalog";
import { ProjectIcon } from "./project-icon";

afterEach(cleanup);

/** The markup the catalog's icon draws, to tell which icon a ProjectIcon shows. */
function drawingOf(name: string): string {
  const { container, unmount } = render(<HugeiconsIcon icon={ICON_CATALOG.get(name)!} />);
  const markup = container.querySelector("svg")!.innerHTML;
  unmount();
  return markup;
}

function drawn(element: ReactElement) {
  const { container } = render(element);
  return container.querySelector("svg")!;
}

describe("a project's icon", () => {
  it("draws the icon the project chose, in the project's colour", () => {
    const rocket = drawingOf("Rocket");
    const svg = drawn(<ProjectIcon icon="Rocket" color="steelblue" />);
    expect(svg.innerHTML).toBe(rocket);
    expect(svg.closest("[style*='steelblue']")).not.toBeNull();
  });

  it("draws Folder01 for a project without an icon, and for a name the catalog no longer has", () => {
    const folder = drawingOf("Folder01");
    expect(drawn(<ProjectIcon color="steelblue" />).innerHTML).toBe(folder);
    cleanup();
    expect(drawn(<ProjectIcon icon="NoSuchIcon" color="steelblue" />).innerHTML).toBe(folder);
  });

  it("draws a black or white icon in the theme's text colour, so it shows on either theme", () => {
    for (const color of ["black", "white"]) {
      const svg = drawn(<ProjectIcon icon="Rocket" color={color} />);
      expect(svg.closest("[class*='text-foreground']"), color).not.toBeNull();
      expect(svg.closest(`[style*='${color}']`), color).toBeNull();
      cleanup();
    }
  });
});
