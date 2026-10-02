import { describe, expect, it } from "vitest";

import {
  PERMISSION_TOOLS,
  formatPermissionRule,
  parsePermissionRule,
} from "../src/rule-set";

describe("parsePermissionRule", () => {
  it("splits a tool and its pattern", () => {
    expect(parsePermissionRule("Bash(npm run test:*)")).toEqual({ tool: "Bash", pattern: "npm run test:*" });
    expect(parsePermissionRule("WebFetch(domain:github.com)")).toEqual({
      tool: "WebFetch",
      pattern: "domain:github.com",
    });
  });

  it("keeps parentheses inside the pattern", () => {
    expect(parsePermissionRule("Bash(echo (a) b)")).toEqual({ tool: "Bash", pattern: "echo (a) b" });
  });

  it("a bare tool or an MCP name has no pattern", () => {
    expect(parsePermissionRule("WebSearch")).toEqual({ tool: "WebSearch", pattern: null });
    expect(parsePermissionRule("mcp__github__create_issue")).toEqual({
      tool: "mcp__github__create_issue",
      pattern: null,
    });
  });

  it("text that isn't Tool(pattern) is all tool, so nothing is lost", () => {
    expect(parsePermissionRule("weird (rule")).toEqual({ tool: "weird (rule", pattern: null });
  });
});

describe("formatPermissionRule", () => {

  it("is the inverse of parsePermissionRule for any rule text", () => {
    const samples = [
      "Bash(npm run test:*)",
      "Read(./.env)",
      "WebSearch",
      "mcp__bb bridge__update_environment_directory",
      "Bash(echo (a) b)",
      "weird (rule",
      "Edit(**/*.ts)",
    ];
    for (const text of samples) {
      const { tool, pattern } = parsePermissionRule(text);
      expect(formatPermissionRule(tool, pattern)).toBe(text);
    }
  });
});

describe("PERMISSION_TOOLS", () => {
  it("every tool has an example and a hint", () => {
    for (const entry of PERMISSION_TOOLS) {
      expect(entry.tool).not.toBe("");
      expect(entry.hint).not.toBe("");
    }
  });

});
