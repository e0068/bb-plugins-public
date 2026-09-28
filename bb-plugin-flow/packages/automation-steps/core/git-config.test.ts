import { describe, expect, it } from "vitest";
import {
  configPathFromGitdir,
  originUrlFromGitConfig,
  parseGitdirPointer,
} from "./git-config";

describe("parseGitdirPointer", () => {
  it("extracts gitdir from the worktree's pointer file", () => {
    expect(parseGitdirPointer("gitdir: /a/b/.git/worktrees/x\n")).toBe(
      "/a/b/.git/worktrees/x",
    );
  });

  it("tolerates extra whitespace", () => {
    expect(parseGitdirPointer("  gitdir:   /a/.git  ")).toBe("/a/.git");
  });

  it("no gitdir line → null", () => {
    expect(parseGitdirPointer("ref: refs/heads/main")).toBeNull();
  });
});

describe("configPathFromGitdir", () => {
  it("worktree: config is taken from the main .git, not worktrees/<name>", () => {
    expect(configPathFromGitdir("/a/b/.git/worktrees/feature")).toBe(
      "/a/b/.git/config",
    );
  });

  it("regular repository: config sits next to gitdir", () => {
    expect(configPathFromGitdir("/a/b/.git")).toBe("/a/b/.git/config");
  });

  it("a trailing slash isn't doubled", () => {
    expect(configPathFromGitdir("/a/b/.git/")).toBe("/a/b/.git/config");
  });
});

describe("originUrlFromGitConfig", () => {
  const config = `
[core]
	repositoryformatversion = 0
[remote "origin"]
	url = git@github.com:e0068/bb-plugins.git
	fetch = +refs/heads/*:refs/remotes/origin/*
[branch "main"]
	remote = origin
`;

  it("extracts the origin section's url", () => {
    expect(originUrlFromGitConfig(config)).toBe(
      "git@github.com:e0068/bb-plugins.git",
    );
  });

  it("doesn't confuse another remote's url with origin", () => {
    const text = `
[remote "upstream"]
	url = git@github.com:other/repo.git
[remote "origin"]
	url = https://github.com/me/mine.git
`;
    expect(originUrlFromGitConfig(text)).toBe("https://github.com/me/mine.git");
  });

  it("tolerates whitespace in the subsection header", () => {
    const text = `[remote  "origin"]\n\turl = git@github.com:a/b.git\n`;
    expect(originUrlFromGitConfig(text)).toBe("git@github.com:a/b.git");
  });

  it("no origin → null", () => {
    expect(originUrlFromGitConfig(`[remote "upstream"]\n\turl = x\n`)).toBeNull();
  });
});
