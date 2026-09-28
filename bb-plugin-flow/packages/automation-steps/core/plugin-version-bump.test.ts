import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  affectedPluginRoots,
  bumpPackageLockVersion,
  pluginRootOf,
  setPackageJsonVersion,
} from "./plugin-version-bump";

describe("pluginRootOf", () => {
  it("a file inside a bb-plugin-* directory → that directory", () => {
    expect(pluginRootOf("bb-plugin-tasks-plus/server.ts")).toBe("bb-plugin-tasks-plus");
  });
  it("a nested file inside a bb-plugin-* directory → the top directory", () => {
    expect(pluginRootOf("bb-plugin-tasks-plus/src/core/foo.ts")).toBe("bb-plugin-tasks-plus");
  });
  it("a file inside packages/* → that package, prefixed", () => {
    expect(pluginRootOf("packages/plugin-base/tsconfig.json")).toBe("packages/plugin-base");
  });
  it("a repo-root file → null", () => {
    expect(pluginRootOf("README.md")).toBeNull();
  });
  it("docs/ → null", () => {
    expect(pluginRootOf("docs/tasks/todo/x.md")).toBeNull();
  });
  it("a bare bb-plugin-* path with no file inside it → null", () => {
    expect(pluginRootOf("bb-plugin-tasks-plus")).toBeNull();
  });
});

describe("affectedPluginRoots", () => {
  it("dedupes and sorts across multiple files of the same and different plugins", () => {
    expect(
      affectedPluginRoots([
        "bb-plugin-b/server.ts",
        "bb-plugin-a/server.ts",
        "bb-plugin-a/app.tsx",
        "packages/kasimov/index.ts",
        "README.md",
      ]),
    ).toEqual(["bb-plugin-a", "bb-plugin-b", "packages/kasimov"]);
  });
  it("no plugin/package files → empty", () => {
    expect(affectedPluginRoots(["README.md", "docs/INDEX.md"])).toEqual([]);
  });
});

describe("bumpPackageLockVersion", () => {
  const lock = (version: string, rootVersion = version) =>
    JSON.stringify({
      name: "bb-plugin-x",
      version,
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": { name: "bb-plugin-x", version: rootVersion, dependencies: { react: "^19.0.0" } },
        "node_modules/react": { version: "19.0.0" },
      },
    });

  it("sets both the top-level version and packages[\"\"].version to the target", () => {
    const result = bumpPackageLockVersion(lock("0.3.0"), "0.3.1");
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.version).toBe("0.3.1");
    expect(parsed.packages[""].version).toBe("0.3.1");
    expect(parsed.packages[""].dependencies).toEqual({ react: "^19.0.0" });
    expect(parsed.packages["node_modules/react"].version).toBe("19.0.0");
  });

  it("targets the given `to`, not an increment of the lockfile's own (possibly already-drifted) version", () => {
    // Reproduces the actual bug: package.json already moved to 0.3.1 while
    // the lockfile was left behind at 0.3.0 by the pre-fix autobump. The fix
    // must land the lockfile on whatever package.json says, not 0.3.0 + 1.
    const result = bumpPackageLockVersion(lock("0.3.0"), "0.3.2");
    expect(JSON.parse(result!).version).toBe("0.3.2");
  });

  it("lockfileVersion 1 shape (no packages[\"\"]) → only the top-level version is set", () => {
    const content = JSON.stringify({ name: "x", version: "0.1.0", lockfileVersion: 1, dependencies: {} });
    const result = bumpPackageLockVersion(content, "0.1.1");
    const parsed = JSON.parse(result!);
    expect(parsed.version).toBe("0.1.1");
    expect(parsed.packages).toBeUndefined();
  });

  it("ends with a trailing newline, matching npm's own lockfile convention", () => {
    const result = bumpPackageLockVersion(lock("0.3.0"), "0.3.1");
    expect(result!.endsWith("\n")).toBe(true);
  });

  it("not valid JSON → null", () => {
    expect(bumpPackageLockVersion("not json", "0.1.1")).toBeNull();
  });

  it("no top-level \"version\" string → null", () => {
    expect(bumpPackageLockVersion('{"name":"x"}', "0.1.1")).toBeNull();
  });
});

describe("setPackageJsonVersion", () => {
  it("writes the given version and reports what it replaced", () => {
    const content = `{\n  "name": "bb-plugin-x",\n  "version": "0.2.10"\n}\n`;
    expect(setPackageJsonVersion(content, "0.2.12")).toEqual({
      content: `{\n  "name": "bb-plugin-x",\n  "version": "0.2.12"\n}\n`,
      from: "0.2.10",
      to: "0.2.12",
    });
  });

  it("leaves every other byte alone — formatting, key order, trailing newline", () => {
    const content = `{\n\t"version":   "1.0.0",\n\t"deps": { "a": "1.0.0" }\n}\n`;
    const set = setPackageJsonVersion(content, "1.0.1");
    expect(set?.content).toBe(`{\n\t"version":   "1.0.1",\n\t"deps": { "a": "1.0.0" }\n}\n`);
  });

  it("no top-level version → null, nothing guessed", () => {
    expect(setPackageJsonVersion(`{ "name": "x" }`, "1.0.0")).toBeNull();
    expect(setPackageJsonVersion("not json", "1.0.0")).toBeNull();
  });

  it("a target equal to the current version is a no-op, not a failure", () => {
    const content = `{ "version": "2.0.0" }`;
    expect(setPackageJsonVersion(content, "2.0.0")).toEqual({
      content,
      from: "2.0.0",
      to: "2.0.0",
    });
  });

  it("a prerelease version can be replaced too — the plain-semver rule belongs to the bump, not to the write", () => {
    expect(setPackageJsonVersion(`{ "version": "1.0.0-rc.1" }`, "1.0.0")?.content).toBe(
      `{ "version": "1.0.0" }`,
    );
  });

  it("a nested field also named version is never written instead of the top-level one", () => {
    const content = `{\n  "dependencies": { "version": "1.2.3" },\n  "version": "0.2.0"\n}\n`;
    expect(setPackageJsonVersion(content, "0.2.1")?.content).toBe(
      `{\n  "dependencies": { "version": "1.2.3" },\n  "version": "0.2.1"\n}\n`,
    );
  });

  it("a nested field carrying the SAME value earlier in the text → null, rather than moving the wrong one", () => {
    const content = `{\n  "bb": { "version": "0.1.4" },\n  "version": "0.1.4"\n}\n`;
    expect(setPackageJsonVersion(content, "0.1.5")).toBeNull();
  });

  it("тот же текст значением ЧУЖОГО поля раньше по файлу не мешает: меняется верхнеуровневое, а не первое вхождение", () => {
    const content = `{\n  "dependencies": { "some-dep": "0.2.0" },\n  "version": "0.2.0"\n}\n`;
    expect(setPackageJsonVersion(content, "0.2.1")?.content).toBe(
      `{\n  "dependencies": { "some-dep": "0.2.0" },\n  "version": "0.2.1"\n}\n`,
    );
  });

  it("property: only the top-level version's literal changes, everything else is byte-for-byte", () => {
    fc.assert(
      fc.property(fc.nat({ max: 99 }), fc.nat({ max: 99 }), fc.nat({ max: 99 }), (major, minor, patch) => {
        const from = `${major}.${minor}.${patch}`;
        const to = `${major}.${minor}.${patch + 1}`;
        const content = `{\n  "name": "x",\n  "engines": { "bb": ">=0.40" },\n  "version": "${from}"\n}\n`;
        const set = setPackageJsonVersion(content, to);
        expect(set?.content).toBe(content.replace(`"${from}"`, `"${to}"`));
      }),
    );
  });
});
