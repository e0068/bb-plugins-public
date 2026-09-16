import { describe, it, expect } from "vitest";
import { availableModes, initialMode, settleMode, type DocMode } from "./doc-mode";

// The four shapes a loaded document can take. Only the last one can be
// drafted from: an empty editor over a failed load looks like an empty file,
// and saving it would write that emptiness back over the real one.
const missing = null;
const unread = { content: null, error: null };
const failed = { content: "# doc", error: "denied" };
const readable = { content: "# doc", error: null };

const ALL: readonly DocMode[] = ["read", "write", "raw"];

describe("availableModes", () => {
  it("an unreadable document offers read only", () => {
    expect(availableModes(false, unread)).toEqual(["read"]);
  });

  it("a document with an error offers read only", () => {
    expect(availableModes(false, failed)).toEqual(["read"]);
  });

  it("a document that has not arrived yet offers read only", () => {
    expect(availableModes(false, missing)).toEqual(["read"]);
  });

  it("readOnly offers read only, even for a readable document", () => {
    expect(availableModes(true, readable)).toEqual(["read"]);
  });

  it("a readable document offers three modes in the order read, write, raw", () => {
    expect(availableModes(false, readable)).toEqual(ALL);
  });

  it("a document without the error field at all counts as readable", () => {
    expect(availableModes(false, { content: "# doc" })).toEqual(ALL);
  });

  it("an empty file is readable — an empty string is content, not a failure", () => {
    expect(availableModes(false, { content: "", error: null })).toEqual(ALL);
  });
});

describe("initialMode", () => {
  it("startInEdit opens write when write is available", () => {
    expect(initialMode(true, false, readable)).toBe("write");
  });

  it("startInEdit on an unreadable document opens read", () => {
    expect(initialMode(true, false, unread)).toBe("read");
    expect(initialMode(true, false, failed)).toBe("read");
    expect(initialMode(true, false, missing)).toBe("read");
  });

  it("startInEdit under readOnly opens read", () => {
    expect(initialMode(true, true, readable)).toBe("read");
  });

  it("without startInEdit it always opens read", () => {
    for (const readOnly of [false, true]) {
      for (const doc of [missing, unread, failed, readable]) {
        expect(initialMode(false, readOnly, doc)).toBe("read");
      }
    }
  });

  it("the mode it picks is always one of the available ones", () => {
    for (const startInEdit of [false, true]) {
      for (const readOnly of [false, true]) {
        for (const doc of [missing, unread, failed, readable]) {
          expect(availableModes(readOnly, doc)).toContain(
            initialMode(startInEdit, readOnly, doc),
          );
        }
      }
    }
  });
});

// A mode outlives the document it was picked on: a re-read can turn a readable
// file into an error without the reader touching the switcher. The mode and
// the segments then have to be brought back together, or the switcher shows
// three segments' worth of state with none of them active.
describe("settleMode", () => {
  it("a mode that is still offered is kept", () => {
    expect(settleMode("raw", ALL)).toBe("raw");
    expect(settleMode("write", ALL)).toBe("write");
    expect(settleMode("read", ALL)).toBe("read");
  });

  it("a mode that is no longer offered falls back to reading", () => {
    expect(settleMode("raw", ["read"])).toBe("read");
    expect(settleMode("write", ["read"])).toBe("read");
  });

  it("whatever it returns is a mode the switcher offers", () => {
    for (const modes of [ALL, ["read"] as const]) {
      for (const mode of ALL) {
        expect(modes).toContain(settleMode(mode, modes));
      }
    }
  });
});
