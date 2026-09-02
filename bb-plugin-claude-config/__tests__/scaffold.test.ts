import { describe, expect, it } from "vitest";

import {
  agentTemplate,
  isValidName,
  skillTemplate,
  slugifyName,
} from "../src/scaffold";

describe("slugifyName", () => {
  it("lowercases and replaces spaces with a hyphen", () => {
    expect(slugifyName("My New Skill")).toBe("my-new-skill");
  });

  it("collapses repeated separators into a single hyphen", () => {
    expect(slugifyName("a  b__c")).toBe("a-b-c");
  });

  it("trims hyphens from the edges", () => {
    expect(slugifyName("  -hello- ")).toBe("hello");
  });

  it("discards disallowed characters", () => {
    expect(slugifyName("@@@ v2")).toBe("v2");
  });

  it("empty input gives an empty slug", () => {
    expect(slugifyName("   ")).toBe("");
    expect(slugifyName("!!!")).toBe("");
  });
});

describe("isValidName", () => {
  it("a name with Latin letters or digits is valid", () => {
    expect(isValidName("skill")).toBe(true);
    expect(isValidName("v2")).toBe(true);
  });

  it("a name without any allowed characters is invalid", () => {
    expect(isValidName("   ")).toBe(false);
    expect(isValidName("!!!")).toBe(false);
  });
});

describe("skillTemplate", () => {
  it("substitutes the name into the frontmatter and heading", () => {
    const text = skillTemplate("my-skill");
    expect(text).toContain("name: my-skill");
    expect(text).toContain("# my-skill");
    expect(text.startsWith("---\n")).toBe(true);
    expect(text).toContain("description:");
  });
});

describe("agentTemplate", () => {
  it("substitutes the name into the frontmatter", () => {
    const text = agentTemplate("my-agent");
    expect(text).toContain("name: my-agent");
    expect(text.startsWith("---\n")).toBe(true);
    expect(text).toContain("description:");
  });
});
