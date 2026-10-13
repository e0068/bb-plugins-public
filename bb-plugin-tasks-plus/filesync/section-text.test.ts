// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sectionText, sectionWrite } from "./section-text.js";
import { parseFrontmatter } from "./frontmatter.js";
import { renderTaskFile } from "./task-file.js";

const FIELDS = ["tags", "date"];
const DATES = { created: "2026-10-13T10:00:00.000Z", updated: "2026-10-13T11:00:00.000Z" };
const stored = renderTaskFile({ title: "Onboarding", key: "DOC-1", description: "First day." }, "onboarding", [], { owner: "Ann" });

const written = (text: string): string => {
  const result = sectionWrite(stored, text);
  if (!result.ok) throw new Error("the edit did not read");
  return result.text;
};

describe("a section's record as Kasimov shows it", () => {
  it("opens with the title, every field of the section — empty ones too — and the two dates, and no service keys", () => {
    expect(sectionText(stored, [...FIELDS, "owner"], DATES)).toBe(
      "---\ntitle: Onboarding\ntags:\ndate:\nowner: Ann\ncreated: 2026-10-13T10:00:00.000Z\nupdated: 2026-10-13T11:00:00.000Z\n---\n\nFirst day.",
    );
  });

  it("shows the record's labels as its Tags", () => {
    const labelled = renderTaskFile({ title: "Onboarding", description: "First day.", labels: ["hr", "urgent"] }, "onboarding", []);
    expect(sectionText(labelled, FIELDS, null)).toBe("---\ntitle: Onboarding\ntags: hr, urgent\ndate:\n---\n\nFirst day.");
  });

  it("shows a field only this record has, after the section's", () => {
    expect(sectionText(stored, FIELDS, null)).toBe("---\ntitle: Onboarding\ntags:\ndate:\nowner: Ann\n---\n\nFirst day.");
  });
});

describe("a section's record as Kasimov saves it", () => {
  it("takes the title, the fields and the text, and keeps the record's service keys", () => {
    const text = written("---\ntitle: Day one\ntags: hr\ndate: 2026-10-14\nowner: Ann\n---\n\nBring a laptop.");
    const { data, body } = parseFrontmatter(text);
    expect(data).toMatchObject({ title: "Day one", slug: "onboarding", key: "DOC-1", date: "2026-10-14", owner: "Ann" });
    expect(body.trim()).toBe("Bring a laptop.");
  });

  it("saves the Tags as the record's labels, from a list or from names split by commas", () => {
    expect(parseFrontmatter(written("---\ntitle: Onboarding\ntags: hr, urgent\n---\n\nFirst day.")).data).toMatchObject({ labels: ["hr", "urgent"] });
    const listed = parseFrontmatter(written("---\ntitle: Onboarding\ntags: [hr]\n---\n\nFirst day.")).data;
    expect(listed).toMatchObject({ labels: ["hr"] });
    expect(listed).not.toHaveProperty("tags");
    expect(parseFrontmatter(written("---\ntitle: Onboarding\ntags:\n---\n\nFirst day.")).data).not.toHaveProperty("labels");
    expect(parseFrontmatter(written("---\ntitle: Onboarding\ntags: 2026\n---\n\nFirst day.")).data).toMatchObject({ labels: ["2026"] });
  });

  it("brings a label with a comma back whole, however often the record goes round", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.stringMatching(/^[a-z][a-z ,]{0,6}[a-z]$/), { minLength: 1, maxLength: 4 }), (labels) => {
        const labelled = renderTaskFile({ title: "Onboarding", description: "First day.", labels }, "onboarding", []);
        const saved = sectionWrite(labelled, sectionText(labelled, FIELDS, null));
        expect(saved.ok && parseFrontmatter(saved.text).data.labels).toEqual(labels);
      }),
    );
  });

  it("does not take the dates or a task's field from the text", () => {
    const text = written("---\ntitle: Onboarding\ncreated: 1999-01-01\nupdated: 1999-01-01\npriority: high\nstatus: done\n---\n\nFirst day.");
    const { data } = parseFrontmatter(text);
    expect(data).not.toHaveProperty("created");
    expect(data).not.toHaveProperty("updated");
    expect(data).not.toHaveProperty("priority");
    expect(data).not.toHaveProperty("status");
  });

  it("keeps a new field written with no value, so the section gains it", () => {
    const { data } = parseFrontmatter(written("---\ntitle: Onboarding\nlink:\n---\n\nFirst day."));
    expect(data).toHaveProperty("link", "");
  });

  it("takes away a field the text no longer names", () => {
    const { data } = parseFrontmatter(written("---\ntitle: Onboarding\n---\n\nFirst day."));
    expect(data).not.toHaveProperty("owner");
  });

  it("refuses fields that do not read, instead of wiping them", () => {
    expect(sectionWrite(stored, "---\ntitle: [unclosed\n---\n\nFirst day.")).toEqual({ ok: false });
  });

  it("gives back the same record when the text is saved as shown, whatever the record held", () => {
    const key = fc.string({ minLength: 1 }).filter((name) => /^[a-z][a-z_]*$/.test(name) && !["title", "slug", "key", "created", "updated", "type", "priority", "estimate", "minutes", "budget", "limit", "cost", "due", "start", "labels", "parent", "threads", "attachments", "flow", "tokens", "checks", "ts", "status", "assignee", "epic", "id"].includes(name));
    fc.assert(
      fc.property(fc.string(), fc.dictionary(key, fc.oneof(fc.string(), fc.integer())), fc.string(), (title, own, description) => {
        const record = renderTaskFile({ title, description }, "a-record", [], own);
        const shown = sectionText(record, FIELDS, null);
        const saved = sectionWrite(record, shown);
        expect(saved.ok).toBe(true);
        if (saved.ok) expect(sectionText(saved.text, FIELDS, null)).toBe(shown);
      }),
    );
  });
});
