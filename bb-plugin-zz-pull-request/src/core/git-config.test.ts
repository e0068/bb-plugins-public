import { describe, expect, it } from "vitest";
import {
  configPathFromGitdir,
  originUrlFromGitConfig,
  parseGitdirPointer,
} from "./git-config";

describe("parseGitdirPointer", () => {
  it("достаёт gitdir из файла-указателя воркри", () => {
    expect(parseGitdirPointer("gitdir: /a/b/.git/worktrees/x\n")).toBe(
      "/a/b/.git/worktrees/x",
    );
  });

  it("терпит лишние пробелы", () => {
    expect(parseGitdirPointer("  gitdir:   /a/.git  ")).toBe("/a/.git");
  });

  it("нет строки gitdir → null", () => {
    expect(parseGitdirPointer("ref: refs/heads/main")).toBeNull();
  });
});

describe("configPathFromGitdir", () => {
  it("воркри: config берётся из главного .git, не из worktrees/<name>", () => {
    expect(configPathFromGitdir("/a/b/.git/worktrees/feature")).toBe(
      "/a/b/.git/config",
    );
  });

  it("обычный репозиторий: config рядом с gitdir", () => {
    expect(configPathFromGitdir("/a/b/.git")).toBe("/a/b/.git/config");
  });

  it("хвостовой слэш не задваивается", () => {
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

  it("достаёт url секции origin", () => {
    expect(originUrlFromGitConfig(config)).toBe(
      "git@github.com:e0068/bb-plugins.git",
    );
  });

  it("не путает url другого ремоута с origin", () => {
    const text = `
[remote "upstream"]
	url = git@github.com:other/repo.git
[remote "origin"]
	url = https://github.com/me/mine.git
`;
    expect(originUrlFromGitConfig(text)).toBe("https://github.com/me/mine.git");
  });

  it("терпит пробел в заголовке подсекции", () => {
    const text = `[remote  "origin"]\n\turl = git@github.com:a/b.git\n`;
    expect(originUrlFromGitConfig(text)).toBe("git@github.com:a/b.git");
  });

  it("нет origin → null", () => {
    expect(originUrlFromGitConfig(`[remote "upstream"]\n\turl = x\n`)).toBeNull();
  });
});
