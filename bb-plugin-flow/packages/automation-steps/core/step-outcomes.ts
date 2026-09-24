// Layer 1 — what a step answers, given what its effect reported. Zero
// effects: the reports arrive as values, the sentence is a value too.
//
// The two steps here are the ones whose report is richer than "it worked":
// raising versions can leave a root behind, and updating plugins can hold one
// back for a human. A chain must stop on either, and the owner reading the
// stopped step must see WHICH plugin and WHY without opening a log — so the
// report is turned into a sentence here, where it is checkable, rather than
// inside the effect where it is not.

/** The answer of a step: the same shape steps.ts hands the runner. */
export type StepOutcome = { ok: true; detail: string | null } | { ok: false; error: string };

/**
 * Почему поднимать версию было нечему и не на чем. Это не поломка: цепочка
 * ставит шаг бампа дважды — сразу за созданием PR и перед мёрджем, — и в обоих
 * пробелах версия поднимется вторым вызовом. Провал здесь останавливал цепочку
 * на первом же прогоне любого треда со старым порядком шагов.
 */
export type BumpGap = "no-pull-request" | "branch-not-published";

const GAP_DETAIL: Record<BumpGap, string> = {
  "no-pull-request": "no pull request yet — versions are raised by the bump step before the merge",
  "branch-not-published": "the branch is not on origin yet — versions are raised by the bump step before the merge",
};

/** What raising versions before a merge reported (wiring/merge-time-bump.ts plus the shell's "could not get there"). */
export interface BumpSummary {
  readonly bumped: readonly { readonly root: string; readonly to: string }[];
  readonly problems: readonly string[];
  readonly unavailable: string | null;
  /** Пробел, а не поломка; поля нет — обычный разбор ниже. */
  readonly gap?: BumpGap | null;
}

/** What updating the touched plugins reported (wiring/plugin-reinstall.ts plus the shell's "could not get there"). */
export interface ReinstallSummary {
  readonly reinstalled: readonly string[];
  readonly installed: readonly string[];
  readonly repoints: readonly { readonly pluginId: string; readonly from: string }[];
  readonly problems: readonly string[];
  readonly pendingSelfUpdate: string | null;
  readonly unavailable: string | null;
}

/**
 * A root that should have grown and did not is a failure, not a footnote:
 * the merge is next in the chain, and merging a plugin on a version that
 * already exists is the very thing the step is there to prevent. Nothing to
 * raise, on the other hand, is success — the branch is simply already ahead.
 */
export function bumpOutcome(summary: BumpSummary): StepOutcome {
  const gap = summary.gap ?? null;
  if (gap !== null) return { ok: true, detail: GAP_DETAIL[gap] };
  if (summary.unavailable !== null) return { ok: false, error: `Versions not raised: ${summary.unavailable}` };
  if (summary.problems.length > 0) return { ok: false, error: `Versions not raised: ${summary.problems.join("; ")}` };
  if (summary.bumped.length === 0) return { ok: true, detail: "nothing to raise" };
  return { ok: true, detail: summary.bumped.map(({ root, to }) => `${root} → ${to}`).join(", ") };
}

/**
 * A plugin bb could not update in place is a failure with its source named:
 * the repoint that would fix it removes the plugin first, taking its
 * settings, secrets and schedules with it, so it is the owner's call and not
 * an automation's. The plugin running the chain is neither done nor a
 * problem — it is deferred, and said so.
 */
export function reinstallOutcome(summary: ReinstallSummary): StepOutcome {
  if (summary.unavailable !== null) return { ok: false, error: `Plugins not updated: ${summary.unavailable}` };
  const refusals = [
    ...summary.problems,
    ...summary.repoints.map(
      ({ pluginId, from }) =>
        `"${pluginId}" is installed from ${from} — update it by hand with bb plugin remove and bb plugin install`,
    ),
  ];
  if (refusals.length > 0) return { ok: false, error: `Plugins not updated: ${refusals.join("; ")}` };

  const said = [
    ...(summary.reinstalled.length === 0 ? [] : [`updated ${summary.reinstalled.join(", ")}`]),
    ...(summary.installed.length === 0 ? [] : [`installed ${summary.installed.join(", ")}`]),
    ...(summary.pendingSelfUpdate === null ? [] : [`${summary.pendingSelfUpdate} updates itself after the run`]),
  ];
  return { ok: true, detail: said.length === 0 ? "no plugin of this repository was touched" : said.join(", ") };
}
