// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createSkillDelivery } from "./skill-delivery";
import type { WorkStage } from "../shared/contract";

const stage = (skill: string) => ({ id: skill, kind: "skill", skill, executors: [] }) as unknown as WorkStage;

describe("Flow skills across providers", () => {
  it("delivers selected skills with relative resources into the worktree, preserving owner files", async () => {
    const root = mkdtempSync(join(tmpdir(), "flow-delivery-"));
    try {
      const source = join(root, "source");
      mkdirSync(join(source, "references"), { recursive: true });
      writeFileSync(join(source, "SKILL.md"), "---\nname: spec\n---\nRead references/rules.md");
      writeFileSync(join(source, "references/rules.md"), "rules");
      const warnings: string[] = [];
      const delivery = createSkillDelivery({ stages: () => [stage("spec"), stage("-")], source: async () => join(source, "SKILL.md"), warn: (s) => warnings.push(s) });
      await delivery.sync("t");
      expect(delivery.deliver("t", null)).toBeUndefined();
      expect(delivery.deliver("t", join(root, "tree"))).toContain("spec:");
      const copied = join(root, "tree/.agents/skills/spec");
      expect(readFileSync(join(copied, "references/rules.md"), "utf8")).toBe("rules");
      writeFileSync(join(copied, "SKILL.md"), "owner's skill");
      delivery.deliver("t", join(root, "tree"));
      expect(readFileSync(join(copied, "SKILL.md"), "utf8")).toBe("owner's skill");
      delivery.forget("t");
      expect(delivery.deliver("t", join(root, "tree"))).toBeUndefined();
      expect(warnings).toEqual([]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("ignores traversal names and tolerates missing sources", async () => {
    const requested: string[] = [];
    const delivery = createSkillDelivery({ stages: () => [stage("../other"), stage("spec")], source: async (name) => { requested.push(name); return null; }, warn: () => undefined });
    await delivery.sync("t");
    expect(requested).toEqual(["spec"]);
    expect(delivery.deliver("t", "/tmp")).toBeUndefined();
  });
});
