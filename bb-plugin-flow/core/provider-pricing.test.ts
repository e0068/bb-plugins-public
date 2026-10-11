import { describe, expect, it } from "vitest";
import { transcriptCost, windowCost } from "./planning";
import { priceOf } from "@bb-plugins/provider-usage/core/pricing";
import { adapterPath } from "@bb-plugins/provider-usage/shell/runtime";
const line = (model: string, timestamp = "2026-10-11T10:00:00Z") => JSON.stringify({ type: "assistant", timestamp, requestId: model, message: { id: model, model, usage: { input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, output_tokens: 1_000_000 } } });
describe("provider API billing", () => {
  it("Codex and Kimi price cached inputs separately", () => {
    expect(transcriptCost([line("gpt-6.1-sol")])).toBe(12.1);
    expect(transcriptCost([line("kimi-k2.6")])).toBe(5.11);
    expect(transcriptCost([line("gpt-6.1-sol"),line("kimi-k2.6")])).toBe(17.21);
  });
  it("does not label unknown API models as Claude prices or zero", () => {
    expect(transcriptCost([line("unlisted")])).toBeUndefined();
    expect(transcriptCost([line("gpt-6.1-sol"),line("unlisted")])).toBeUndefined();
    expect(priceOf("gpt-6.1-sol-unknown")).toBeUndefined();
  });
  it("dated models retain their exact tariff and windows retain spend boundaries", () => {
    expect(priceOf("gpt-6.1-sol-2026-10-01")).toEqual(priceOf("gpt-6.1-sol"));
    const at = Date.parse("2026-10-11T10:00:00Z");
    expect(windowCost([line("gpt-6.1-sol")],at,at+1)).toBe(12.1);
    expect(windowCost([line("gpt-6.1-sol")],at-1,at)).toBeUndefined();
  });
  it("finds native adapters in published bundles and source layouts", () => {
    expect(adapterPath("/plugin/dist", (p) => p === "/plugin/packages/provider-usage/shell/store.py")).toBe("/plugin/packages/provider-usage/shell/store.py");
    expect(adapterPath("/repo/packages/provider-usage/shell", (p) => p === "/repo/packages/provider-usage/shell/store.py")).toBe("/repo/packages/provider-usage/shell/store.py");
    expect(adapterPath("/", () => false)).toBeUndefined();
  });
});

it("long context selects the API long-context tariff without charging reasoning twice", () => {
  const entry = JSON.parse(line("gpt-6.1-sol"));
  entry.message.usage.api_context_input_tokens = 300_000;
  entry.message.usage.output_tokens_details = { thinking_tokens: 100_000 };
  expect(transcriptCost([JSON.stringify(entry)])).toBe(19.2);
});
