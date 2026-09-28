import { describe, expect, it } from "vitest";
import { cliRunMessage } from "./bb-cli-run";

describe("cliRunMessage", () => {
  it("a run that failed with stderr → the stderr, trimmed", () => {
    expect(cliRunMessage({ kind: "ran", code: 1, stdout: "", stderr: " not found\n" })).toBe(
      "not found",
    );
  });

  it("no stderr → the stdout instead", () => {
    expect(cliRunMessage({ kind: "ran", code: 1, stdout: "refused\n", stderr: "" })).toBe("refused");
  });

  it("neither stream said anything → the exit code", () => {
    expect(cliRunMessage({ kind: "ran", code: 3, stdout: "", stderr: "" })).toBe("code 3");
  });

  it("the CLI could not be run at all → its own reason, not an exit code it never had", () => {
    expect(cliRunMessage({ kind: "unavailable", reason: "spawn bb ENOENT" })).toBe(
      "spawn bb ENOENT",
    );
  });
});
