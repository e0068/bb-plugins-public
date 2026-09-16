import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLACE,
  openKey,
  panelRoute,
  parsePanelRoute,
  type PanelPlace,
} from "../src/panel-route";

// Every kind of thing the panel can have open, each with a name that would
// break a naive grammar: a slash, a space, a colon, a dot.
const OPEN_TARGETS = [
  { kind: "skill", name: "superpowers:brainstorming" },
  { kind: "doc", path: "/Users/a b/.claude/CLAUDE.md" },
  // Paths come from the file system, so they are not ASCII by contract.
  { kind: "doc", path: "/Users/a/память/решения.md" },
  { kind: "connector", origin: "mcpjson", name: "plugin:figma/figma" },
  { kind: "hook", origin: "user", index: 0, event: "UserPromptSubmit" },
  { kind: "hook", origin: "local", index: 12, event: "PreToolUse:Bash" },
  { kind: "workflow", store: "global", name: "deploy.js" },
  { kind: "workflow", store: "project", name: "release.js" },
] as const;

const PLACES: PanelPlace[] = [
  DEFAULT_PLACE,
  { areaId: "proj_hpqtcwvtsv", section: null, open: null },
  { areaId: "global", section: "skills", open: null },
  ...OPEN_TARGETS.flatMap((open): PanelPlace[] => [
    { areaId: "global", section: "skills", open },
    { areaId: "proj_hpqtcwvtsv", section: "workflows", open },
    // A memory file is opened from the rail, with no section under it.
    { areaId: "global", section: null, open },
  ]),
];

describe("panelRoute / parsePanelRoute", () => {
  it("a place written to the address reads back the same", () => {
    for (const place of PLACES) {
      expect(parsePanelRoute(panelRoute(place))).toEqual(place);
    }
  });

  it("no address is the default place, and the default place is no address", () => {
    expect(parsePanelRoute("")).toEqual(DEFAULT_PLACE);
    expect(panelRoute(DEFAULT_PLACE)).toBe("");
  });

  it("segments are tagged, so the address says what each part is", () => {
    expect(panelRoute({ areaId: "global", section: "skills", open: null })).toBe(
      "a/global/s/skills",
    );
    expect(
      panelRoute({
        areaId: "global",
        section: "skills",
        open: { kind: "skill", name: "git-hygiene" },
      }),
    ).toBe("a/global/s/skills/skill/git-hygiene");
    expect(
      panelRoute({
        areaId: "proj_1",
        section: "workflows",
        open: { kind: "workflow", store: "global", name: "deploy.js" },
      }),
    ).toBe("a/proj_1/s/workflows/wf/global/deploy.js");
  });

  it("no section is the absence of the pair, not a placeholder segment", () => {
    expect(panelRoute({ areaId: "proj_1", section: null, open: null })).toBe(
      "a/proj_1",
    );
    expect(parsePanelRoute("a/proj_1")).toEqual({
      areaId: "proj_1",
      section: null,
      open: null,
    });
  });
});

describe("openKey", () => {
  it("nothing open has the empty key", () => {
    expect(openKey(null)).toBe("");
  });

  it("tells every open target apart", () => {
    const keys = OPEN_TARGETS.map((open) => openKey(open));
    expect(new Set(keys).size).toBe(OPEN_TARGETS.length);
  });

  it("the same target has the same key, whatever object carries it", () => {
    expect(openKey({ kind: "doc", path: "/a/b.md" })).toBe(
      openKey({ kind: "doc", path: "/a/b.md" }),
    );
    expect(openKey({ kind: "hook", origin: "user", index: 1, event: "Stop" })).not.toBe(
      openKey({ kind: "hook", origin: "user", index: 2, event: "Stop" }),
    );
  });
});

describe("parsePanelRoute — addresses that don't add up", () => {
  it("anything that isn't an address at all is the default place", () => {
    for (const route of ["nonsense", "a", "a/", "s/skills", "/"]) {
      expect(parsePanelRoute(route)).toEqual(DEFAULT_PLACE);
    }
  });

  it("a section that no longer exists is dropped, the area survives", () => {
    // Sections come and go between builds; a stale name must not come back
    // as an active section id.
    expect(parsePanelRoute("a/proj_1/s/tool-search")).toEqual({
      areaId: "proj_1",
      section: null,
      open: null,
    });
  });

  it("a tail that names nothing openable leaves the area and section standing", () => {
    expect(parsePanelRoute("a/global/s/skills/nonsense/x")).toEqual({
      areaId: "global",
      section: "skills",
      open: null,
    });
  });

  it("a hook index that isn't a number opens nothing", () => {
    // `Number("abc")` is NaN, and a NaN index would be handed to the server
    // as the position of a hook in a file.
    expect(parsePanelRoute("a/global/s/hooks/hook/user/abc/PreToolUse").open).toBeNull();
    expect(parsePanelRoute("a/global/s/hooks/hook/user/-1/PreToolUse").open).toBeNull();
    expect(parsePanelRoute("a/global/s/hooks/hook/user/1.5/PreToolUse").open).toBeNull();
  });

  it("an origin or store outside its set opens nothing", () => {
    expect(parsePanelRoute("a/global/s/connectors/connector/smtp/eA").open).toBeNull();
    expect(parsePanelRoute("a/global/s/hooks/hook/marketplace/0/eA").open).toBeNull();
    expect(parsePanelRoute("a/global/s/workflows/wf/plugin/deploy.js").open).toBeNull();
  });

  it("a payload that isn't base64 opens nothing", () => {
    // "!" is outside the base64 alphabet, so decoding throws rather than
    // returning a shorter string — the address names no file at all.
    expect(parsePanelRoute("a/global/s/skills/doc/!!").open).toBeNull();
    expect(parsePanelRoute("a/global/s/hooks/hook/user/0/!!").open).toBeNull();
  });

  it("base64 of bytes that aren't UTF-8 opens nothing", () => {
    // "nonsense" IS valid base64 — it decodes to bytes that are not a string.
    // Without a fatal decoder those become replacement characters and travel
    // on to the server as a file path.
    expect(parsePanelRoute("a/global/s/skills/doc/nonsense").open).toBeNull();
  });

  it("a truncated target opens nothing", () => {
    for (const route of [
      "a/global/s/skills/skill",
      "a/global/s/skills/doc",
      "a/global/s/connectors/connector/user",
      "a/global/s/hooks/hook/user/0",
      "a/global/s/workflows/wf/global",
    ]) {
      expect(parsePanelRoute(route).open).toBeNull();
    }
  });
});
