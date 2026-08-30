import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseGithubRemote } from "./remote";

// Генератор допустимого сегмента owner/repo: буквы/цифры/._- , непустой.
const segment = fc
  .stringMatching(/^[A-Za-z0-9._-]{1,20}$/)
  .filter((s) => s.length > 0);

// Все формы github-remote для одной пары owner/repo — с ними round-trip обязан
// вернуть исходную пару.
function remoteForms(owner: string, repo: string): string[] {
  return [
    `git@github.com:${owner}/${repo}.git`,
    `git@github.com:${owner}/${repo}`,
    `https://github.com/${owner}/${repo}.git`,
    `https://github.com/${owner}/${repo}`,
    `https://user@github.com/${owner}/${repo}.git`,
    `ssh://git@github.com/${owner}/${repo}.git`,
  ];
}

describe("parseGithubRemote", () => {
  it("round-trip: любая форма любой валидной пары разбирается обратно", () => {
    fc.assert(
      fc.property(segment, segment, (owner, repo) => {
        for (const url of remoteForms(owner, repo)) {
          expect(parseGithubRemote(url)).toEqual({ owner, repo });
        }
      }),
    );
  });

  it("игнорирует пробелы вокруг", () => {
    expect(parseGithubRemote("  git@github.com:a/b.git \n")).toEqual({
      owner: "a",
      repo: "b",
    });
  });

  it("не github.com-хост → null", () => {
    expect(parseGithubRemote("git@gitlab.com:a/b.git")).toBeNull();
    expect(parseGithubRemote("https://example.com/a/b")).toBeNull();
  });

  it("мусор и неполный путь → null", () => {
    expect(parseGithubRemote("")).toBeNull();
    expect(parseGithubRemote("not a url")).toBeNull();
    expect(parseGithubRemote("https://github.com/onlyowner")).toBeNull();
  });
});
