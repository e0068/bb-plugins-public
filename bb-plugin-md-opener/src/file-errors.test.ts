import { describe, expect, it } from "vitest";

import { fileErrorKind } from "./file-errors";

const withCode = (code: string, message = "boom") => Object.assign(new Error(message), { code });

describe("fileErrorKind — what a failed move or remove means", () => {
  it("a destination that already exists, by code or by the host's message", () => {
    expect(fileErrorKind(withCode("path_exists"))).toBe("exists");
    expect(fileErrorKind(new Error("Destination already exists: /env/b.md"))).toBe("exists");
  });

  it("a source that is not there, by code or by the message", () => {
    expect(fileErrorKind(withCode("ENOENT"))).toBe("not-found");
    expect(fileErrorKind(withCode("path_not_found"))).toBe("not-found");
    expect(fileErrorKind(new Error("ENOENT: no such file or directory, lstat '/env/a.md'"))).toBe(
      "not-found",
    );
  });

  it("anything else is a refusal", () => {
    expect(fileErrorKind(withCode("EACCES", "EACCES: permission denied"))).toBe("other");
    expect(fileErrorKind(new Error("Path escapes root"))).toBe("other");
    expect(fileErrorKind("not even an error")).toBe("other");
    expect(fileErrorKind(null)).toBe("other");
  });
});
