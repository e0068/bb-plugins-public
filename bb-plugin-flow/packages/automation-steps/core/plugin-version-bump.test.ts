import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  affectedPluginRoots,
  bumpChangedFileVersion,
  bumpChangedFileVersionWithTarget,
  bumpChangedLockFileVersion,
  bumpPackageJsonVersion,
  bumpPackageLockVersion,
  bumpPatch,
  pluginRootOf,
  resolveLiveBumpSource,
  setPackageJsonVersion,
  type FilePayload,
} from "./plugin-version-bump";
import { decodeBase64, encodeBase64 } from "./base64";
import type { ChangedFile } from "./github-requests";

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
  it("memory/ → null", () => {
    expect(pluginRootOf("memory/tasks/todo/x.md")).toBeNull();
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
    expect(affectedPluginRoots(["README.md", "memory/INDEX.md"])).toEqual([]);
  });
});

describe("bumpPatch", () => {
  it("increments the patch component", () => {
    expect(bumpPatch(0, 1, 4)).toBe("0.1.5");
  });
  it("carries a two-digit patch forward correctly (no accidental string increment)", () => {
    expect(bumpPatch(0, 1, 9)).toBe("0.1.10");
  });
  it("major and minor are untouched", () => {
    expect(bumpPatch(2, 7, 0)).toBe("2.7.1");
  });

  it("property: bumpPatch never changes major.minor, and always increments patch by one", () => {
    fc.assert(
      fc.property(fc.nat(), fc.nat(), fc.nat(), (major, minor, patch) => {
        expect(bumpPatch(major, minor, patch)).toBe(`${major}.${minor}.${patch + 1}`);
      }),
    );
  });
});

describe("bumpPackageJsonVersion", () => {
  it("bumps a real package.json's top-level version, leaving everything else identical", () => {
    const content = [
      "{",
      '  "name": "bb-plugin-example",',
      '  "version": "0.1.4",',
      '  "type": "module"',
      "}",
      "",
    ].join("\n");
    const result = bumpPackageJsonVersion(content);
    expect(result?.from).toBe("0.1.4");
    expect(result?.to).toBe("0.1.5");
    expect(result?.content).toBe(content.replace('"version": "0.1.4"', '"version": "0.1.5"'));
  });

  it("no \"version\" field → null", () => {
    expect(bumpPackageJsonVersion('{ "name": "not-a-package-json" }')).toBeNull();
  });

  it("not valid JSON → null (doesn't throw)", () => {
    expect(bumpPackageJsonVersion("not json at all")).toBeNull();
  });

  it("a prerelease top-level version (not a plain x.y.z) → null, even with a plain-looking nested field", () => {
    // Regression: a naive "first version-looking line" scan would skip the
    // unparsable top-level value and match the nested "bb.version" instead.
    const content = '{"name":"x","version":"0.1.4-rc.1","bb":{"version":"9.9.9"}}';
    expect(bumpPackageJsonVersion(content)).toBeNull();
  });

  it("a nested field also named \"version\" is never bumped instead of the top-level one", () => {
    // Regression: a line-scanning match hits whichever "version" occurrence
    // comes first in the text, including one nested under an unrelated key.
    const content = '{"dependencies":{"version":"1.2.3"},"version":"0.2.0"}';
    const result = bumpPackageJsonVersion(content);
    expect(result?.from).toBe("0.2.0");
    expect(result?.to).toBe("0.2.1");
    expect(result?.content).toBe('{"dependencies":{"version":"1.2.3"},"version":"0.2.1"}');
  });

  it("a nested field with the SAME value, appearing earlier in the text than the top-level one → refuses rather than bumping the wrong occurrence", () => {
    // The literal rewrite targets the first textual match of the validated
    // value — if a nested field happens to carry that exact same value
    // ahead of the real top-level one, that's the occurrence that would
    // move. The post-replace re-parse catches this: the top-level field
    // wouldn't actually read `to`, so this returns null instead of a result
    // that silently bumped the wrong field.
    const content = '{"bb":{"version":"0.1.4"},"version":"0.1.4"}';
    expect(bumpPackageJsonVersion(content)).toBeNull();
  });

  it("property: only the top-level version's literal changes; everything else is byte-for-byte identical", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 12 }).filter((s) => !/["\\]/.test(s)),
        fc.nat(), fc.nat(), fc.nat(),
        (name, major, minor, patch) => {
          const from = `${major}.${minor}.${patch}`;
          const content = JSON.stringify({ name, version: from, dependencies: { version: "9.9.9" } });
          const result = bumpPackageJsonVersion(content);
          expect(result).not.toBeNull();
          expect(JSON.parse(result!.content).version).toBe(bumpPatch(major, minor, patch));
          expect(JSON.parse(result!.content).dependencies.version).toBe("9.9.9");
          expect(result!.content.length).toBe(content.length + result!.to.length - from.length);
        },
      ),
    );
  });
});

describe("bumpChangedFileVersion", () => {
  const packageJson = (version: string) => `{"name":"x","version":"${version}"}`;

  it("a deletion is never resurrected", () => {
    expect(bumpChangedFileVersion({ kind: "delete", path: "bb-plugin-x/package.json" })).toBeNull();
  });

  it("a utf-8 upsert with a plain version → bumped in place", () => {
    const file: ChangedFile = {
      kind: "upsert",
      path: "bb-plugin-x/package.json",
      content: packageJson("0.1.4"),
      encoding: "utf-8",
    };
    expect(bumpChangedFileVersion(file)).toEqual({
      kind: "upsert",
      path: "bb-plugin-x/package.json",
      content: packageJson("0.1.5"),
      encoding: "utf-8",
    });
  });

  it("a base64 upsert is decoded, bumped, and re-encoded", () => {
    const file: ChangedFile = {
      kind: "upsert",
      path: "bb-plugin-x/package.json",
      content: encodeBase64(packageJson("0.1.4")),
      encoding: "base64",
    };
    const bumped = bumpChangedFileVersion(file);
    expect(bumped?.kind).toBe("upsert");
    expect(decodeBase64((bumped as { content: string }).content)).toBe(packageJson("0.1.5"));
  });

  it("not a package.json (no version field) → null", () => {
    const file: ChangedFile = {
      kind: "upsert",
      path: "bb-plugin-x/README.md",
      content: "# hi",
      encoding: "utf-8",
    };
    expect(bumpChangedFileVersion(file)).toBeNull();
  });
});

describe("bumpChangedFileVersionWithTarget", () => {
  const packageJson = (version: string) => `{"name":"x","version":"${version}"}`;

  it("bumps and reports the resulting version alongside the file", () => {
    const file: ChangedFile = {
      kind: "upsert",
      path: "bb-plugin-x/package.json",
      content: packageJson("0.1.4"),
      encoding: "utf-8",
    };
    expect(bumpChangedFileVersionWithTarget(file)).toEqual({
      file: { kind: "upsert", path: "bb-plugin-x/package.json", content: packageJson("0.1.5"), encoding: "utf-8" },
      to: "0.1.5",
    });
  });

  it("a deletion → null", () => {
    expect(
      bumpChangedFileVersionWithTarget({ kind: "delete", path: "bb-plugin-x/package.json" }),
    ).toBeNull();
  });

  it("not a package.json → null", () => {
    const file: ChangedFile = { kind: "upsert", path: "bb-plugin-x/README.md", content: "# hi", encoding: "utf-8" };
    expect(bumpChangedFileVersionWithTarget(file)).toBeNull();
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

describe("bumpChangedLockFileVersion", () => {
  const lock = (version: string) =>
    JSON.stringify({ name: "x", version, lockfileVersion: 3, packages: { "": { version } } });

  it("a deletion is never resurrected", () => {
    expect(bumpChangedLockFileVersion({ kind: "delete", path: "bb-plugin-x/package-lock.json" }, "0.1.1")).toBeNull();
  });

  it("a utf-8 upsert → set to the target version", () => {
    const file: ChangedFile = {
      kind: "upsert",
      path: "bb-plugin-x/package-lock.json",
      content: lock("0.1.0"),
      encoding: "utf-8",
    };
    const bumped = bumpChangedLockFileVersion(file, "0.1.1");
    expect(bumped?.kind).toBe("upsert");
    expect(JSON.parse((bumped as { content: string }).content).version).toBe("0.1.1");
  });

  it("a base64 upsert is decoded, bumped, and re-encoded", () => {
    const file: ChangedFile = {
      kind: "upsert",
      path: "bb-plugin-x/package-lock.json",
      content: encodeBase64(lock("0.1.0")),
      encoding: "base64",
    };
    const bumped = bumpChangedLockFileVersion(file, "0.1.1");
    expect(JSON.parse(decodeBase64((bumped as { content: string }).content)).version).toBe("0.1.1");
  });

  it("not JSON → null", () => {
    const file: ChangedFile = { kind: "upsert", path: "bb-plugin-x/package-lock.json", content: "nope", encoding: "utf-8" };
    expect(bumpChangedLockFileVersion(file, "0.1.1")).toBeNull();
  });
});

describe("resolveLiveBumpSource", () => {
  const utf8 = (content: string): FilePayload => ({ content, encoding: "utf-8" });

  it("merge-base and live tip agree → the live tip is safe to bump", () => {
    const tip = utf8('{"version":"0.1.4"}');
    expect(resolveLiveBumpSource(utf8('{"version":"0.1.4"}'), tip)).toBe(tip);
  });

  it("the base moved this file since the merge-base → refuses (would manufacture a conflict)", () => {
    expect(resolveLiveBumpSource(utf8('{"version":"0.1.4"}'), utf8('{"version":"0.1.5"}'))).toBeNull();
  });

  it("no package.json at the merge-base but one exists at the tip (base added it) → refuses", () => {
    expect(resolveLiveBumpSource(null, utf8('{"version":"0.1.4"}'))).toBeNull();
  });

  it("no package.json at the tip but one existed at the merge-base (base removed it) → refuses", () => {
    expect(resolveLiveBumpSource(utf8('{"version":"0.1.4"}'), null)).toBeNull();
  });

  it("no package.json at either ref (a root with none of its own) → refuses", () => {
    expect(resolveLiveBumpSource(null, null)).toBeNull();
  });

  it("agreement is checked on decoded text, not raw encoding — base64 tip vs utf-8 merge-base still match", () => {
    const tip: FilePayload = { content: encodeBase64('{"version":"0.1.4"}'), encoding: "base64" };
    expect(resolveLiveBumpSource(utf8('{"version":"0.1.4"}'), tip)).toBe(tip);
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
});
