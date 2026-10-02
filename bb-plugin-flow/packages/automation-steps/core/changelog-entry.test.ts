import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { belongsToPull, changelogEntriesOf, fallbackEntry, fallbackEntryPath, isChangelogPath, keepsChangelog, stampEntry, type EntryStamp } from "./changelog-entry";

const comingSoon = `---
version: coming-soon
---

- ru: Итог автоматизации приходит тостом
  en: An automation's result arrives as a toast
`;

const history = `---
version: 0.6.49
date: 2026-09-27
---

- ru: Старый пункт
  en: An old note
`;

const stampArb: fc.Arbitrary<EntryStamp> = fc.record({
  version: fc.tuple(fc.nat(99), fc.nat(99), fc.nat(999)).map(([a, b, c]) => `${a}.${b}.${c}`),
  // What the bump writes since entries carry the merge moment: UTC to the minute, `YYYY-MM-DDTHH:MMZ`.
  date: fc.date({ min: new Date("2020-01-01"), max: new Date("2099-12-31"), noInvalidDate: true }).map((d) => `${d.toISOString().slice(0, 16)}Z`),
  pull: fc.integer({ min: 1, max: 100_000 }),
});
const bodyOf = (text: string): string => text.slice(text.indexOf("\n---", 3) + 4);

describe("stampEntry", () => {
  it("coming-soon gets the version, the date and the PR in its header, the notes stay as written", () => {
    expect(stampEntry(comingSoon, { version: "0.6.58", date: "2026-09-30", pull: 585 })).toBe(`---
version: 0.6.58
date: 2026-09-30
pr: 585
---

- ru: Итог автоматизации приходит тостом
  en: An automation's result arrives as a toast
`);
  });

  it("stamping again with the same stamp changes nothing", () => {
    fc.assert(
      fc.property(stampArb, (stamp) => {
        const once = stampEntry(comingSoon, stamp) as string;
        expect(stampEntry(once, stamp)).toBe(once);
      }),
    );
  });

  it("a re-stamp leaves exactly one line of each stamped field, carrying the last stamp", () => {
    fc.assert(
      fc.property(stampArb, stampArb, (first, second) => {
        const twice = stampEntry(stampEntry(comingSoon, first) as string, second) as string;
        expect(twice.match(/^(version|date|pr): /gm)).toEqual(["version: ", "date: ", "pr: "]);
        expect(twice).toContain(`version: ${second.version}\ndate: ${second.date}\npr: ${second.pull}\n`);
      }),
    );
  });

  it("the body after the header is byte for byte what it was", () => {
    fc.assert(
      fc.property(stampArb, fc.string(), (stamp, tail) => {
        const text = `${comingSoon}${tail}`;
        expect(bodyOf(stampEntry(text, stamp) as string)).toBe(bodyOf(text));
      }),
    );
  });

  it("a merge moment goes into the header exactly as the bump gives it", () => {
    expect(stampEntry(comingSoon, { version: "0.6.78", date: "2026-10-01T11:32Z", pull: 626 })).toContain("version: 0.6.78\ndate: 2026-10-01T11:32Z\npr: 626\n---\n");
  });

  it("header lines other than the stamped ones survive the stamp", () => {
    const text = "---\nversion: coming-soon\nauthor: agent\n---\n\n- ru: а\n  en: a\n";
    expect(stampEntry(text, { version: "1.0.0", date: "2026-01-02", pull: 7 })).toBe("---\nversion: 1.0.0\ndate: 2026-01-02\npr: 7\nauthor: agent\n---\n\n- ru: а\n  en: a\n");
  });

  it("CRLF line ends are read the same as LF", () => {
    expect(stampEntry(comingSoon.replace(/\n/g, "\r\n"), { version: "0.1.0", date: "2026-01-02", pull: 7 })).toContain("version: 0.1.0\ndate: 2026-01-02\npr: 7\n---\r\n");
  });

  it("a file without a header is not an entry → null", () => {
    const stamp = { version: "0.1.0", date: "2026-01-02", pull: 7 };
    expect(stampEntry("- ru: а\n  en: a\n", stamp)).toBeNull();
    expect(stampEntry("---\nversion: 0.1.0\n", stamp)).toBeNull();
  });
});

describe("belongsToPull", () => {
  it("a coming-soon entry belongs to whichever PR carries it", () => {
    fc.assert(
      fc.property(stampArb, ({ pull }) => {
        expect(belongsToPull(comingSoon, pull)).toBe(true);
      }),
    );
  });

  it("an entry this PR stamped still belongs to it, so a later bump can move it to another version", () => {
    fc.assert(
      fc.property(stampArb, (stamp) => {
        expect(belongsToPull(stampEntry(comingSoon, stamp) as string, stamp.pull)).toBe(true);
      }),
    );
  });

  it("an entry stamped by another PR is not this PR's", () => {
    fc.assert(
      fc.property(stampArb, fc.integer({ min: 1, max: 100_000 }), (stamp, other) => {
        fc.pre(other !== stamp.pull);
        expect(belongsToPull(stampEntry(comingSoon, stamp) as string, other)).toBe(false);
      }),
    );
  });

  it("history without a PR in its header belongs to no PR — adding it never restamps it", () => {
    expect(belongsToPull(history, 583)).toBe(false);
  });

  it("a file without a header belongs to no PR", () => {
    expect(belongsToPull("- ru: а\n  en: a\n", 1)).toBe(false);
  });
});

describe("fallbackEntry", () => {
  it("the PR title stands on both languages, stamped like any entry", () => {
    expect(fallbackEntry("Flow — галка выключена по умолчанию", { version: "0.6.56", date: "2026-09-30", pull: 579 })).toBe(`---
version: 0.6.56
date: 2026-09-30
pr: 579
---

- ru: Flow — галка выключена по умолчанию
  en: Flow — галка выключена по умолчанию
`);
  });

  it("line breaks and runs of spaces in the title collapse to one line", () => {
    expect(fallbackEntry("  Fix\n the   thing ", { version: "0.1.0", date: "2026-01-02", pull: 7 })).toContain("- ru: Fix the thing\n  en: Fix the thing\n");
  });

  it("a blank title gives no entry → null", () => {
    expect(fallbackEntry(" \n ", { version: "0.1.0", date: "2026-01-02", pull: 7 })).toBeNull();
  });

  it("a fallback entry is itself this PR's entry: stamping it again with the same stamp changes nothing", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }).filter((s) => s.trim() !== ""), stampArb, (title, stamp) => {
        const entry = fallbackEntry(title, stamp) as string;
        expect(belongsToPull(entry, stamp.pull)).toBe(true);
        expect(stampEntry(entry, stamp)).toBe(entry);
      }),
    );
  });
});

describe("which files are entries", () => {
  it("only bb-plugin-* roots keep a changelog, shared packages do not", () => {
    expect(keepsChangelog("bb-plugin-flow")).toBe(true);
    expect(keepsChangelog("packages/automation-steps")).toBe(false);
  });

  it("an entry is a .md file straight inside <root>/changelog/", () => {
    expect(
      changelogEntriesOf("bb-plugin-flow", [
        "bb-plugin-flow/changelog/task-slug.md",
        "bb-plugin-flow/changelog/nested/x.md",
        "bb-plugin-flow/changelog/readme.txt",
        "bb-plugin-flow/src/changelog/x.md",
        "bb-plugin-flow-extra/changelog/x.md",
        "bb-plugin-mail/changelog/x.md",
      ]),
    ).toEqual(["bb-plugin-flow/changelog/task-slug.md"]);
  });

  it("the fallback entry is named after the PR number", () => {
    expect(fallbackEntryPath("bb-plugin-flow", 583)).toBe("bb-plugin-flow/changelog/pr-583.md");
  });

  it("the fallback path is itself an entry path of its root", () => {
    fc.assert(
      fc.property(fc.nat(), (n) => {
        expect(changelogEntriesOf("bb-plugin-x", [fallbackEntryPath("bb-plugin-x", n)])).toHaveLength(1);
      }),
    );
  });
});

describe("isChangelogPath", () => {
  it("anything under a plugin's changelog/ is changelog, the plugin's code and packages/ are not", () => {
    expect(isChangelogPath("bb-plugin-flow/changelog/x.md")).toBe(true);
    expect(isChangelogPath("bb-plugin-flow/changelog/nested/y.txt")).toBe(true);
    expect(isChangelogPath("bb-plugin-flow/src/changelog/x.md")).toBe(false);
    expect(isChangelogPath("bb-plugin-flow/app.tsx")).toBe(false);
    expect(isChangelogPath("packages/x/changelog/x.md")).toBe(false);
  });

  it("every entry path of a root is a changelog path", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z0-9-]{1,12}$/), (name) => {
        changelogEntriesOf("bb-plugin-x", [`bb-plugin-x/changelog/${name}.md`]).forEach((path) => expect(isChangelogPath(path)).toBe(true));
      }),
    );
  });
});
