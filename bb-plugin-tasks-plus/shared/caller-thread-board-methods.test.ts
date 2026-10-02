import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { tasksRpcContract } from "./contract.js";

const unrecognized = (result: z.ZodSafeParseResult<unknown>, key: string) =>
  !result.success && result.error.issues.some((issue) => issue.code === "unrecognized_keys" && issue.keys.includes(key));

describe("caller thread on board methods", () => {
  it("is not taken by the methods that read the KV, not the task files", () => {
    for (const method of ["createFolder", "createProject", "listLabels", "loadAnalyticsDashboard"] as const) {
      const result = tasksRpcContract[method].input.safeParse({ callerThreadId: "thr_1" });
      expect(unrecognized(result, "callerThreadId"), method).toBe(true);
    }
  });
});
