import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  gitTarget,
  planReinstall,
  reinstallFailureLine,
  repositoryOfSource,
  type ReinstallStep,
} from "./reinstall-plan";

const repo = { owner: "e0068", repo: "bb-plugins" };
const ownPluginId = "zz-pull-request";
const target = {
  source: "git:https://github.com/e0068/bb-plugins.git@main",
  subdirectory: "bb-plugin-tasks-plus",
};
const plan = (pluginId: string, installedSource: string | null): ReinstallStep =>
  planReinstall({ pluginId, installedSource, repo, baseBranch: "main", ownPluginId });

describe("gitTarget", () => {
  it("names the PR's repository on its base branch and the plugin's own directory", () => {
    expect(gitTarget(repo, "main", "tasks-plus")).toEqual(target);
    expect(gitTarget({ owner: "acme", repo: "mono" }, "release/1.x", "x")).toEqual({
      source: "git:https://github.com/acme/mono.git@release/1.x",
      subdirectory: "bb-plugin-x",
    });
  });
});

describe("repositoryOfSource", () => {
  it.each([
    ["git:https://github.com/e0068/bb-plugins.git", repo],
    ["git:https://github.com/e0068/bb-plugins.git@main", repo],
    ["git:https://github.com/e0068/bb-plugins", repo],
    ["git:https://github.com/e0068/bb-plugins.git@semver:tasks-plus/:^0.1.0", repo],
    ["git:github.com/e0068/bb-plugins@main", repo],
    ["git:git@github.com:e0068/bb-plugins.git@main", repo],
    ["git:https://github.com/other/bb-plugins-public.git@main", { owner: "other", repo: "bb-plugins-public" }],
    ["path:/Users/x/bb-plugins/bb-plugin-tasks-plus", null],
    ["npm:@acme/bb-plugin-x@^1.0.0", null],
    ["builtin:automations", null],
    ["git:https://gitlab.com/e0068/bb-plugins.git", null],
    ["", null],
  ])("%s → %j", (source, expected) => {
    expect(repositoryOfSource(source)).toEqual(expected);
  });
});

describe("reinstallFailureLine", () => {
  const gitSource = "git:https://github.com/e0068/bb-plugins.git@main";

  it("names the plugin, the source it could not come from, and the version left installed", () => {
    expect(
      reinstallFailureLine({
        pluginId: "projects",
        attemptedSource: gitSource,
        installedVersion: "0.3.1",
        reason: "BB request timed out after 75 seconds",
      }),
    ).toBe(
      `"projects" from ${gitSource}, version 0.3.1 still installed: BB request timed out after 75 seconds`,
    );
  });

  it("omits the version clause when nothing was installed to keep running", () => {
    expect(
      reinstallFailureLine({
        pluginId: "projects",
        attemptedSource: gitSource,
        installedVersion: null,
        reason: "cannot install",
      }),
    ).toBe(`"projects" from ${gitSource}: cannot install`);
  });
});

describe("planReinstall", () => {
  it("installed from git of the same repository, on any ref → update in place", () => {
    expect(plan("tasks-plus", "git:https://github.com/e0068/bb-plugins.git")).toEqual({ kind: "update" });
    expect(plan("tasks-plus", "git:https://github.com/e0068/bb-plugins.git@main")).toEqual({ kind: "update" });
    expect(plan("tasks-plus", "git:https://github.com/E0068/BB-Plugins.git@feature")).toEqual({ kind: "update" });
  });

  it("not installed at all → install from the PR's repository", () => {
    expect(plan("tasks-plus", null)).toEqual({ kind: "install", target });
  });

  it("installed from a path → repoint, remembering where it came from", () => {
    const from = "path:/Users/x/worktrees/bb-plugins/bb-plugin-tasks-plus";
    expect(plan("tasks-plus", from)).toEqual({ kind: "repoint", from, target });
  });

  it("installed from git of another repository → repoint as well", () => {
    const from = "git:https://github.com/e0068/bb-plugins-public.git@main";
    expect(plan("tasks-plus", from)).toEqual({ kind: "repoint", from, target });
  });

  it("installed from npm or an unknown scheme → repoint", () => {
    expect(plan("tasks-plus", "npm:@acme/bb-plugin-tasks-plus@^1.0.0").kind).toBe("repoint");
    expect(plan("tasks-plus", "weird").kind).toBe("repoint");
  });

  it("the plugin running this code, on a non-git source → refuse by name, never a repoint", () => {
    const step = plan(ownPluginId, "path:/Users/x/bb-plugins/bb-plugin-zz-pull-request");
    expect(step.kind).toBe("refuse");
    if (step.kind === "refuse") expect(step.reason).toContain(ownPluginId);
  });

  it("the plugin running this code, on git of the same repository → update-self, never a plain update", () => {
    expect(plan(ownPluginId, "git:https://github.com/e0068/bb-plugins.git")).toEqual({
      kind: "update-self",
    });
    expect(plan(ownPluginId, "git:https://github.com/E0068/BB-Plugins.git@feature")).toEqual({
      kind: "update-self",
    });
  });

  it("is total: any source string yields one of the five steps", () => {
    fc.assert(
      fc.property(fc.option(fc.string(), { nil: null }), fc.string(), (installedSource, pluginId) => {
        const step = planReinstall({ pluginId, installedSource, repo, baseBranch: "main", ownPluginId });
        expect(["update", "update-self", "install", "repoint", "refuse"]).toContain(step.kind);
      }),
    );
  });

  it("only the plugin running this code ever gets update-self", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (pluginId, installedSource) => {
        const step = planReinstall({ pluginId, installedSource, repo, baseBranch: "main", ownPluginId });
        if (step.kind === "update-self") expect(pluginId).toBe(ownPluginId);
      }),
    );
  });
});
