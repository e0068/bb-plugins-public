import { describe, expect, it } from "vitest";
import { bbExecutable } from "./bb-cli-path";

describe("bbExecutable", () => {
  it("BB_CLI names the binary outright → that exact path", () => {
    expect(bbExecutable({ BB_CLI: "/Applications/bb.app/…/dist/bb" })).toBe(
      "/Applications/bb.app/…/dist/bb",
    );
  });

  it("no BB_CLI but BB_CLI_DIR → the `bb` inside that directory", () => {
    expect(bbExecutable({ BB_CLI_DIR: "/opt/bb/dist" })).toBe("/opt/bb/dist/bb");
  });

  it("BB_CLI wins over BB_CLI_DIR — the explicit binary is never second-guessed", () => {
    expect(bbExecutable({ BB_CLI: "/opt/bb/dist/bb-next", BB_CLI_DIR: "/opt/bb/dist" })).toBe(
      "/opt/bb/dist/bb-next",
    );
  });

  it("neither variable → the bare name, resolved through PATH", () => {
    expect(bbExecutable({})).toBe("bb");
  });

  it("an empty or blank variable counts as absent, not as an empty path", () => {
    expect(bbExecutable({ BB_CLI: "", BB_CLI_DIR: "   " })).toBe("bb");
  });

  it("a trailing separator on BB_CLI_DIR does not double up", () => {
    expect(bbExecutable({ BB_CLI_DIR: "/opt/bb/dist/" })).toBe("/opt/bb/dist/bb");
  });
});
