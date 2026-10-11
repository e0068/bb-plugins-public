// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readClaudeTranscript } from "./planning";
import { transcriptCost } from "../core/planning";

describe("native provider transcript integration", () => {
  it("reads Codex through the shared Python adapter and applies API rates", async () => {
    const root = mkdtempSync(join(tmpdir(), "native-usage-"));
    try {
      vi.stubEnv("CODEX_HOME", join(root, "codex"));
      vi.stubEnv("KIMI_CODE_HOME", join(root, "kimi"));
      const sessions = join(root, "codex/sessions");
      mkdirSync(sessions, { recursive: true });
      const rows = [
        { type: "session_meta", payload: { id: "test-session", cwd: "/work" } },
        { type: "turn_context", payload: { model: "gpt-6.1-sol" } },
        { type: "event_msg", timestamp: "2026-10-11T10:00:00Z", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 1_000_000, cached_input_tokens: 500_000, output_tokens: 100_000 } } } },
      ];
      writeFileSync(join(sessions, "rollout.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
      const lines = await readClaudeTranscript(join(root, "claude"))("test-session");
      expect(lines).toHaveLength(1);
      expect(transcriptCost(lines!)).toBe(2.05);
      expect(await readClaudeTranscript(join(root, "claude"))("absent")).toBeUndefined();
    } finally { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); }
  });
});
