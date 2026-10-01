// @vitest-environment node
// The rule "every tooltip stays inside the window" is enforced here, over the
// sources of every plugin and package, so a new tooltip can't forget it.
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readSourceFiles, type SourceFile } from "../layer-guard/index.js";

const PACKAGE = "@bb-plugins/viewport-clamp";
const RADIX_POPPERS = ["@radix-ui/react-tooltip", "@radix-ui/react-hover-card"];

const imports = (file: SourceFile, specifier: string): boolean =>
  new RegExp(`from\\s+["']${specifier.replace(/[/.-]/g, "\\$&")}["']`).test(file.source);

/** A hand-placed tooltip (`role="tooltip"`) is positioned through the shared clamp. */
const unclampedTooltip = (file: SourceFile): boolean =>
  file.path.endsWith(".tsx") && /role=["']tooltip["']/.test(file.source) && !imports(file, PACKAGE);

/** A Radix tooltip or hover card keeps its collision handling on and a padding from the window edge. */
const unpaddedPopper = (file: SourceFile): boolean =>
  RADIX_POPPERS.some((specifier) => imports(file, specifier)) &&
  (!/\bcollisionPadding\b/.test(file.source) || /avoidCollisions=\{\s*false\s*\}/.test(file.source));

const violations = (files: ReadonlyArray<SourceFile>): ReadonlyArray<string> =>
  files.flatMap((file) => [
    ...(unclampedTooltip(file) ? [`${file.path}: role="tooltip" without ${PACKAGE}`] : []),
    ...(unpaddedPopper(file) ? [`${file.path}: Radix tooltip or hover card without collisionPadding`] : []),
  ]);

const file = (path: string, source: string): SourceFile => ({ path, source });

describe("a hand-placed tooltip", () => {
  it("fails without the shared clamp", () => {
    expect(unclampedTooltip(file("bars.tsx", `<div role="tooltip" style={{ left: x }} />`))).toBe(true);
  });

  it("passes with the shared clamp", () => {
    const source = `import { useViewportClamp } from "${PACKAGE}";\n<div role="tooltip" />`;
    expect(unclampedTooltip(file("bars.tsx", source))).toBe(false);
  });

  it("is not looked for outside components", () => {
    expect(unclampedTooltip(file("roles.ts", `const role = 'role="tooltip"';`))).toBe(false);
  });
});

describe("a Radix tooltip or hover card", () => {
  const radix = `import * as HoverCardPrimitive from "@radix-ui/react-hover-card";\n`;

  it("fails without collisionPadding", () => {
    expect(unpaddedPopper(file("hover-card.tsx", `${radix}<HoverCardPrimitive.Content sideOffset={4} />`))).toBe(true);
  });

  it("fails with collisions turned off", () => {
    const source = `${radix}<HoverCardPrimitive.Content collisionPadding={8} avoidCollisions={false} />`;
    expect(unpaddedPopper(file("hover-card.tsx", source))).toBe(true);
  });

  it("passes with collisionPadding", () => {
    expect(unpaddedPopper(file("hover-card.tsx", `${radix}<HoverCardPrimitive.Content collisionPadding={8} />`))).toBe(false);
  });
});

describe("the repository", () => {
  it("has every tooltip clamped to the window", () => {
    const root = fileURLToPath(new URL("../..", import.meta.url));
    expect(violations(readSourceFiles(root))).toEqual([]);
  });
});
