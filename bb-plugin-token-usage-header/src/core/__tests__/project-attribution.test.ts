import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  bbManagedEnvironmentId,
  fallbackProjectName,
  guessedProjectLabel,
  projectIdForCwd,
  UNKNOWN_PROJECT_LABEL,
  type ProjectPath,
} from "../project-attribution";

describe("bbManagedEnvironmentId", () => {
  it("extracts the environment id from a managed worktree cwd", () => {
    expect(bbManagedEnvironmentId("/Users/e0068/.bb/worktrees/env_suki2mvjxj/bb-plugins")).toBe("env_suki2mvjxj");
  });

  it("extracts the environment id from a personal workspace cwd", () => {
    expect(bbManagedEnvironmentId("/Users/e0068/.bb/personal-workspaces/env_h645jme5uu")).toBe("env_h645jme5uu");
  });

  it("extracts the environment id even from a nested subdirectory", () => {
    expect(bbManagedEnvironmentId("/Users/e0068/.bb/worktrees/env_x/Decompose/bb-plugin-shelf/src")).toBe("env_x");
  });

  it("returns null for a session that ran in a project's own checkout (unmanaged)", () => {
    expect(bbManagedEnvironmentId("/Users/e0068/Documents/Projects/Cellular")).toBeNull();
  });

  it("returns null for a path outside BB's workspace layout entirely", () => {
    expect(bbManagedEnvironmentId("/Users/e0068/Documents/Claude/Orchestrator WIP/Orchestrator v0.2")).toBeNull();
  });

  it("returns null for a null cwd", () => {
    expect(bbManagedEnvironmentId(null)).toBeNull();
  });
});

describe("projectIdForCwd", () => {
  const projects: ProjectPath[] = [
    { id: "proj-cellular", path: "/Users/e0068/Documents/Projects/Cellular" },
    { id: "proj-bb-plugins", path: "/Users/e0068/Documents/Projects/bb-plugins" },
  ];

  it("matches a cwd equal to a project's own path", () => {
    expect(projectIdForCwd("/Users/e0068/Documents/Projects/Cellular", projects)).toBe("proj-cellular");
  });

  it("matches a cwd nested inside a project's own path", () => {
    expect(projectIdForCwd("/Users/e0068/Documents/Projects/Cellular/public", projects)).toBe("proj-cellular");
  });

  it("returns null for a cwd under no registered project", () => {
    expect(projectIdForCwd("/Users/e0068/Documents/Projects/Track", projects)).toBeNull();
  });

  it("returns null for a bb-managed worktree copy — that's bbManagedEnvironmentId's job, not this one's", () => {
    expect(projectIdForCwd("/Users/e0068/.bb/worktrees/env_x/Cellular", projects)).toBeNull();
  });

  it("returns null for a null cwd", () => {
    expect(projectIdForCwd(null, projects)).toBeNull();
  });

  it("prefers the longest (most specific) matching path when one project's checkout nests inside another's", () => {
    const nested: ProjectPath[] = [
      { id: "outer", path: "/Users/e0068/Documents/Projects" },
      { id: "inner", path: "/Users/e0068/Documents/Projects/Cellular" },
    ];
    expect(projectIdForCwd("/Users/e0068/Documents/Projects/Cellular/public", nested)).toBe("inner");
  });

  it("does not match a path that merely shares a prefix string without a directory boundary", () => {
    // "/Cellular2" is not inside "/Cellular" — a naive startsWith without
    // the trailing slash would wrongly match this.
    expect(projectIdForCwd("/Users/e0068/Documents/Projects/Cellular2", projects)).toBeNull();
  });

  it("law: a cwd built as project.path + '/' + suffix always matches that project (or a more specific one nested inside it)", () => {
    const pathArb = fc.array(fc.stringMatching(/^[a-zA-Z0-9_-]+$/), { minLength: 1, maxLength: 4 }).map((xs) => `/${xs.join("/")}`);
    const suffixArb = fc.stringMatching(/^[a-zA-Z0-9_-]+$/);
    fc.assert(
      fc.property(pathArb, suffixArb, (basePath, suffix) => {
        const projectsArb: ProjectPath[] = [{ id: "p", path: basePath }];
        const cwd = `${basePath}/${suffix}`;
        expect(projectIdForCwd(cwd, projectsArb)).toBe("p");
      }),
    );
  });
});

describe("guessedProjectLabel", () => {
  it("prefers cwd's own last path segment", () => {
    expect(guessedProjectLabel("/Users/e0068/Documents/Claude/Orchestrator WIP/Orchestrator v0.2", "irrelevant")).toBe(
      "Orchestrator v0.2",
    );
  });

  it("keeps a hyphenated project name intact when reading it from cwd", () => {
    expect(guessedProjectLabel("/Users/e0068/.bb/worktrees/env_x/Shader-Lab", "irrelevant")).toBe("Shader-Lab");
  });

  it("ignores a trailing slash on cwd", () => {
    expect(guessedProjectLabel("/Users/e0068/Documents/Projects/Track/", "irrelevant")).toBe("Track");
  });

  it("falls back to the raw slug's last segment when cwd is null", () => {
    expect(guessedProjectLabel(null, "-Users-e0068-Documents-Projects-Petrograd")).toBe("Petrograd");
  });

  it("strips a Claude Code native worktree tail (.claude/worktrees/<slug>) back to the project directory it was created from", () => {
    expect(guessedProjectLabel("/Users/e0068/Documents/Projects/Decompose/.claude/worktrees/new-text-editor-4b01cc", "irrelevant")).toBe(
      "Decompose",
    );
  });

  it("strips a native worktree tail even when a package subdirectory is nested one level deeper still", () => {
    expect(
      guessedProjectLabel("/Users/e0068/Documents/Projects/Decompose/.claude/worktrees/new-text-editor-4b01cc/md-editor", "irrelevant"),
    ).toBe("Decompose");
  });

  it("reads the project directory name right after a bb-managed env id, not a deeper package subdirectory, when the environment lookup itself failed", () => {
    expect(guessedProjectLabel("/Users/e0068/.bb/worktrees/env_x/Decompose/bb-plugin-workflow-composer", "irrelevant")).toBe(
      "Decompose",
    );
  });

  it("falls back to the whole slug when it has no hyphen separators at all", () => {
    expect(guessedProjectLabel(null, "sess1")).toBe("sess1");
  });
});

describe("fallbackProjectName", () => {
  it("merges into a registered project's own name when the cwd guess matches it exactly", () => {
    const known = new Set(["Cellular", "bb-plugins"]);
    expect(fallbackProjectName("/Users/e0068/Documents/Elsewhere/Cellular", "irrelevant", known)).toBe("Cellular");
  });

  it("falls back to the shared Unknown Project bucket when the cwd guess matches no registered project", () => {
    const known = new Set(["Cellular", "bb-plugins"]);
    expect(fallbackProjectName("/Users/e0068/Documents/Projects/Track", "irrelevant", known)).toBe(UNKNOWN_PROJECT_LABEL);
  });

  it("falls back to the shared Unknown Project bucket when no project is registered at all", () => {
    expect(fallbackProjectName("/Users/e0068/Documents/Projects/Track", "irrelevant", new Set())).toBe(UNKNOWN_PROJECT_LABEL);
  });

  it("does not merge on a partial or case-insensitive match — only exact string equality counts", () => {
    const known = new Set(["Cellular"]);
    expect(fallbackProjectName("/Users/e0068/Documents/Projects/Cellular-experiment", "irrelevant", known)).toBe(UNKNOWN_PROJECT_LABEL);
    expect(fallbackProjectName("/Users/e0068/Documents/Projects/cellular", "irrelevant", known)).toBe(UNKNOWN_PROJECT_LABEL);
  });

  it("law: always returns either the exact guessed label or the Unknown Project bucket, never a third value", () => {
    const pathArb = fc.array(fc.stringMatching(/^[a-zA-Z0-9_-]+$/), { minLength: 1, maxLength: 4 }).map((xs) => `/${xs.join("/")}`);
    const namesArb = fc.array(fc.stringMatching(/^[a-zA-Z0-9_-]+$/), { maxLength: 5 });
    fc.assert(
      fc.property(pathArb, namesArb, (cwd, names) => {
        const guessed = guessedProjectLabel(cwd, "irrelevant");
        const result = fallbackProjectName(cwd, "irrelevant", new Set(names));
        expect([guessed, UNKNOWN_PROJECT_LABEL]).toContain(result);
      }),
    );
  });
});
