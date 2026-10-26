import { describe, expect, it } from "vitest";
import { isDivergedPull } from "./main-pull-reason";

describe("isDivergedPull — какой отказ ещё можно уладить сверкой содержимого", () => {
  it.each([
    "fatal: Not possible to fast-forward, aborting.",
    " ! [rejected]        main       -> main  (non-fast-forward)",
    "hint: Diverging branches can't be fast-forwarded, you need to either:",
  ])("расхождение: %s", (text) => {
    expect(isDivergedPull(text)).toBe(true);
  });

  it.each([
    "fatal: refusing to fetch into branch 'refs/heads/main' checked out at '/here'",
    "error: Your local changes to the following files would be overwritten by merge:",
    "fatal: unable to access 'https://github.com/x/y/': Could not resolve host",
  ])("не расхождение: %s", (text) => {
    expect(isDivergedPull(text)).toBe(false);
  });
});
