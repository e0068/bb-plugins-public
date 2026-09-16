// bb-plugin-zz-pull-request — the plugin entry point (Layer 3, wiring only).
//
// Gives the front end the RPCs behind the thread-header buttons: a state RPC
// per button (whether to show it) and a click RPC per button. Every click RPC
// runs one `click.*` trigger over the triggers-and-actions rules
// (src/core/automation.ts, src/core/automation-run.ts) with the action effects
// defined here. All other logic lives in the layers below: the pure core
// (src/core) and the wiring (src/wiring). This file reads the world through
// bb.sdk and wires it together.
import { defineRpcContract, type BbPluginApi, type PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  decideArchiveButton,
  decideArchiveVisible,
  type ArchiveReadinessInput,
  type ArchiveReason,
} from "./src/core/archive-readiness";
import {
  ACTION_IDS,
  ACTIONS,
  AUTOMATION_RULES_CHANNEL,
  DEFAULT_RULES,
  TRIGGER_IDS,
  TRIGGERS,
  actionsFor,
  archiveNeedsPreflight,
  parseRules,
  ruleProblems,
  type AutomationRules,
  type DoActionId,
  type RepublishSource,
  type TriggerId,
} from "./src/core/automation";
import { runTrigger, type Effects, type StepResult } from "./src/core/automation-run";
import { statusesShown } from "./src/core/automation-status";
import { decodeBase64 } from "./src/core/base64";
import {
  DEFAULT_BASE_MODE,
  isBaseMode,
  resolveBase,
  type BaseMode,
  type ResolvedBase,
} from "./src/core/base-branch";
import { isDeletion } from "./src/core/changed-files";
import { decideFastForward } from "./src/core/fast-forward";
import {
  configPathFromGitdir,
  originUrlFromGitConfig,
  parseGitdirPointer,
} from "./src/core/git-config";
import type { ChangedFile, OpenPullRequest, RepoRef } from "./src/core/github-requests";
import {
  decideMergeReadiness,
  parseMergeability,
  type ChecksState,
  type Mergeability,
  type MergeIndicator,
  type PrState,
} from "./src/core/merge-readiness";
import { parseMergeBaseRef } from "./src/core/merge-base";
import { schedulesCatchupBurst } from "./src/core/merge-republish";
import { refineWithLiveOpenPr, type PrSignal } from "./src/core/open-pr-refinement";
import { choosePrTitle } from "./src/core/pr-title";
import { OWN_PLUGIN_ID } from "./src/core/plugin-paths";
import type { ArchiveFailure, MergeFailure } from "./src/core/notification";
import { parsePreviewToastArgv, PREVIEW_TOAST_CHANNEL } from "./src/core/preview-toast";
import { parseGithubRemote } from "./src/core/remote";
import { bbReportsGitFacts, decideWakeUpVisible } from "./src/core/retiring";
import { decideGitPhase, type GitPhase } from "./src/core/row-status";
import { threadChangeTouchesPr } from "./src/core/thread-change";
import { chooseToken } from "./src/core/token";
import { type PrPresence } from "./src/core/visibility";
import { bbCliClient } from "./src/wiring/bb-cli-client";
import { runCreatePr } from "./src/wiring/create-pr";
import { readLinkedTask } from "./src/wiring/linked-task";
import { markLinkedTasksStatus, splitTaskStatusResults } from "./src/wiring/mark-task-status";
import { liveAheadCount, runFastForward } from "./src/wiring/fast-forward";
import { ghAuthToken } from "./src/wiring/gh-token";
import { gitClient } from "./src/wiring/git-client";
import { measureArchiveFacts } from "./src/wiring/local-archive-facts";
import { githubClient } from "./src/wiring/github-client";
import { runLocalMainPull, type LocalMainPullResult } from "./src/wiring/local-main-pull";
import {
  applyPendingSelfUpdate,
  reinstallTouchedPlugins,
  repointPlugin as runRepoint,
  type PluginsPort,
  type ReinstallReport,
} from "./src/wiring/plugin-reinstall";
import { fetchNextPrNumber } from "./src/wiring/next-pr-number";
import { measureContentCached } from "./src/wiring/content-cache";
import { checkMergedContent } from "./src/wiring/merged-content";
import { findLiveOpenPr } from "./src/wiring/open-pr-lookup";
import { applyPluginVersionBumps, githubVersionBumpPorts } from "./src/wiring/plugin-version-bump";
import type { CreatePrPorts } from "./src/wiring/create-pr";
import { waitForMergeability } from "./src/wiring/mergeability-wait";
import { bumpVersionsBeforeMerge, type MergeTimeBumpReport } from "./src/wiring/merge-time-bump";
import {
  resolveVisibility,
  type VisibilityPorts,
  type VisibilityWorkspace,
} from "./src/wiring/visibility-decision";

// What the merge leg did to plugin versions right before merging — the
// keys it bumped and the reasons it could not bump something it should
// have. Both reach the front end as toasts: a bump that silently didn't
// happen is the defect this exists to end (see
// memory/decisions/version-bump-decided-at-merge.md).
const versionBumpSchema = z.object({
  bumped: z.array(z.object({ root: z.string(), to: z.string() })),
  problems: z.array(z.string()),
});

// A remove-and-install the merge leg proposes rather than runs: everything
// the `repointPlugin` RPC needs, plus `from` for the toast that asks.
const repointSchema = z.object({
  pluginId: z.string(),
  from: z.string(),
  source: z.string(),
  subdirectory: z.string(),
});

// Which plugins the merge leg brought onto the merged code because the PR
// touched them (updated in place, or installed afresh), which it could not,
// and which wait for the user's word (see src/wiring/plugin-reinstall.ts).
// Same reasoning as the version bump above: the user who just merged a
// plugin change must not be left running the old build without a word.
const reinstallSchema = z.object({
  reinstalled: z.array(z.string()),
  installed: z.array(z.string()),
  repoints: z.array(repointSchema),
  problems: z.array(z.string()),
});

// A leg that ran AFTER the Pull Request existed and did not go through. Not a
// rejection: that would throw away the number and URL of a PR now on GitHub,
// leaving the front end nothing to name (src/core/notification.ts).
// Split per RPC: "Pull Request then Merge" never archives, and "Merge then
// Archive" cannot fail at merging (a refused merge still rejects there). A
// wide type would let a handler report a step its chain cannot reach.
const mergeFailureSchema = z
  .object({ step: z.literal("merge"), message: z.string() })
  .nullable();
const archiveFailureSchema = z
  .object({ step: z.literal("archive"), message: z.string() })
  .nullable();
const prFailureSchema = z
  .object({ step: z.enum(["merge", "archive"]), message: z.string() })
  .nullable();

// The rules as stored and answered — ids checked against this build's
// catalog; parseRules has already dropped anything else by the time a rule
// set reaches an output.
const automationRulesSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  rules: z.array(
    z.object({
      id: z.string(),
      triggers: z.array(z.enum(TRIGGER_IDS)),
      actions: z.array(z.enum(ACTION_IDS)),
    }),
  ),
});

export const rpcContract = defineRpcContract({
  // The triggers-and-actions table (src/core/automation.ts). Saving takes
  // anything and keeps what parses: unknown ids are dropped, garbage becomes
  // the default rules.
  automationRules: {
    input: z.object({}).strict(),
    output: z.object({ rules: automationRulesSchema }),
  },
  saveAutomationRules: {
    input: z.object({ rules: z.unknown() }).strict(),
    output: z.object({ rules: automationRulesSchema }),
  },
  prState: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({
      visible: z.boolean(),
      reason: z.string(),
      prUrl: z.string().nullable(),
      // Best-effort preview of the number GitHub will assign the PR, shown
      // on the button before the click. `null` when it couldn't be
      // determined (no working copy, no token, GitHub unreachable) — the
      // button still works, it just shows no number.
      nextNumber: z.number().nullable(),
    }),
  },
  // `inReviewTasks`/`failedTasks` mirror archiveThread's `doneTasks`/
  // `failedTasks` for the `in_review` transition: the keys successfully
  // moved to `in_review`, and tasks that WERE found linked but whose
  // transition failed, with the reason. Both empty when there was no linked
  // task at all — see markLinkedTasksStatus in src/wiring/mark-task-status.ts.
  createPr: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({
      url: z.string(),
      number: z.number(),
      inReviewTasks: z.array(z.string()),
      failedTasks: z.array(z.object({ key: z.string(), reason: z.string() })),
      taskCliError: z.string().nullable(),
    }),
  },
  createAndMergePr: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({
      url: z.string(),
      number: z.number(),
      versionBump: versionBumpSchema,
      reinstall: reinstallSchema,
      inReviewTasks: z.array(z.string()),
      failedTasks: z.array(z.object({ key: z.string(), reason: z.string() })),
      taskCliError: z.string().nullable(),
      failure: mergeFailureSchema,
    }),
  },
  createMergeArchivePr: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({
      url: z.string(),
      number: z.number(),
      versionBump: versionBumpSchema,
      reinstall: reinstallSchema,
      archived: z.boolean(),
      doneTasks: z.array(z.string()),
      failedTasks: z.array(z.object({ key: z.string(), reason: z.string() })),
      taskCliError: z.string().nullable(),
      failure: prFailureSchema,
    }),
  },
  fastForwardState: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({ visible: z.boolean(), reason: z.string() }),
  },
  fastForward: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  mergeState: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({
      visible: z.boolean(),
      indicator: z.enum(["success", "failure", "pending", "neutral", "unknown", "conflict"]),
      prUrl: z.string().nullable(),
      // The PR number to show on the Merge button, so it's clear which PR
      // will be merged. `null` when it couldn't be determined.
      number: z.number().nullable(),
    }),
  },
  mergePr: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({
      ok: z.boolean(),
      versionBump: versionBumpSchema,
      reinstall: reinstallSchema,
    }),
  },
  // The "Merge then Archive" item of the Merge button's dropdown: the same
  // merge mergePr does, followed by the same done-marking and archive
  // archiveThread does. Composed here rather than chained from the front end
  // so that a refused merge can never be followed by an archive — see the
  // handler.
  mergeArchivePr: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({
      ok: z.boolean(),
      versionBump: versionBumpSchema,
      reinstall: reinstallSchema,
      archived: z.boolean(),
      doneTasks: z.array(z.string()),
      failedTasks: z.array(z.object({ key: z.string(), reason: z.string() })),
      taskCliError: z.string().nullable(),
      failure: archiveFailureSchema,
    }),
  },
  // The confirmed half of a repoint proposed by a merge: remove whatever bb
  // holds under the id and install from git. Throws with bb's reason when
  // the install fails — the previous source is already back in by then.
  repointPlugin: {
    input: z.object({ pluginId: z.string(), source: z.string(), subdirectory: z.string() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  mainPullState: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({
      attempted: z.boolean(),
      ok: z.boolean(),
      reason: z.string().nullable(),
    }),
  },
  retryMainPull: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), reason: z.string().nullable() }),
  },
  wakeUpState: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({ visible: z.boolean() }),
  },
  wakeUp: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  archiveState: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({ visible: z.boolean(), reason: z.string() }),
  },
  archiveThread: {
    input: z.object({ threadId: z.string() }).strict(),
    // Re-runs the same computeArchiveState check archiveState uses for the
    // button's visibility, and rejects before touching anything (no task
    // marked done, thread not archived) if it says not ready — the button
    // being hidden client-side doesn't stop a stale render or a direct RPC
    // call from reaching here after the PR/tree state has moved on.
    //
    // `doneTasks` — the keys successfully moved to `done`. `failedTasks` —
    // tasks that WERE found linked to the thread but whose done-transition
    // failed, with the reason; not silently folded into "no task", since the
    // caller already knows there was a promise to keep. Both are empty when
    // there was no linked task at all. Once the readiness check passes,
    // archiving itself always proceeds regardless of either.
    output: z.object({
      ok: z.boolean(),
      doneTasks: z.array(z.string()),
      failedTasks: z.array(z.object({ key: z.string(), reason: z.string() })),
      taskCliError: z.string().nullable(),
    }),
  },
  // One shared choice per thread for every button below that measures or
  // moves against the base branch (Fast Forward, Pull Request, the "main not
  // pulled" retry, and Merge's readiness display) — see
  // src/core/base-branch.ts's module doc for what "origin" vs "local" means.
  baseModeState: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({ mode: z.enum(["origin", "local"]) }),
  },
  setBaseMode: {
    input: z.object({ threadId: z.string(), mode: z.enum(["origin", "local"]) }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  // Feeds the sidebar row-status glyph — both halves in one round trip: the
  // pre-PR git phase (dirty tree / ahead of base / clean) and the raw PR
  // facts the Merge button already computes (see `lookupPullRequest` /
  // `merge-readiness.ts`). Deliberately backend-computed rather than read
  // from a frontend SDK hook: the content script that decorates sidebar rows
  // has no host route/thread context to hang a data hook on (see
  // memory/decisions/row-status-rpc-not-frontend-hooks.md).
  rowFacts: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({
      gitPhase: z.enum(["uncommitted", "committed", "clean", "unknown"]),
      pr: z
        .object({
          // Not read by the pure core — only the content script's "seen this
          // merge" cache key needs it, to tell a fresh PR on the same thread
          // apart from the one already dismissed.
          number: z.number().nullable(),
          state: z.enum(["closed", "draft", "merged", "open"]),
          checksState: z.enum(["failing", "no_checks", "passing", "pending", "unknown"]),
          mergeability: z.enum(["conflicting", "mergeable", "unknown"]),
        })
        .nullable(),
    }),
  },
});

type Sdk = BbPluginApi["sdk"];

const AUTOMATION_RULES_KEY = "automation-rules";

/**
 * What one run of a trigger did, written by the action effects in turn. The
 * click RPCs build their responses from it. Every field starts as "did not
 * happen", which is also the answer for an action the rules left out.
 */
interface RunRecord {
  created: { url: string; number: number } | null;
  inReviewTasks: string[];
  doneTasks: string[];
  failedTasks: { key: string; reason: string }[];
  taskCliError: string | null;
  versionBump: { bumped: { root: string; to: string }[]; problems: string[] };
  /** The PR's changed files, read by files.bump-versions; `null` when it did not run. */
  changedPaths: readonly string[] | null;
  /** The GitHub side of the PR, resolved by git.merge; `null` when it did not run. */
  gh: GithubPull | null;
  merged: boolean;
  mergeFailure: MergeFailure | null;
  pullAttempted: boolean;
  pullNoEnvironment: boolean;
  pull: LocalMainPullResult | null;
  reinstall: ReinstallReport;
  archived: boolean;
  archiveFailure: ArchiveFailure | null;
  fastForwarded: boolean;
}

const emptyRunRecord = (): RunRecord => ({
  created: null,
  inReviewTasks: [],
  doneTasks: [],
  failedTasks: [],
  taskCliError: null,
  versionBump: { bumped: [], problems: [] },
  changedPaths: null,
  gh: null,
  merged: false,
  mergeFailure: null,
  pullAttempted: false,
  pullNoEnvironment: false,
  pull: null,
  reinstall: noReinstall(),
  archived: false,
  archiveFailure: null,
  fastForwarded: false,
});

/** A click whose response needs a result its rule no longer produces. */
const missingAction = (action: DoActionId): Error =>
  new Error(`The rule for this button has no "${ACTIONS[action].label}" action (${action}) — see the plugin's Triggers and actions settings.`);

/**
 * bb.reinstall needs what the merge leg learned: the PR's changed files (from
 * files.bump-versions) and its GitHub side (from git.merge). A rule that runs
 * it without them gets a problem line instead of a silent no-op; without
 * GitHub there is no file list either, so nothing is attempted, as before.
 */
async function reinstallAfterMerge(port: PluginsPort, run: RunRecord): Promise<ReinstallReport> {
  if (run.gh === null || run.changedPaths === null) {
    return {
      ...noReinstall(),
      problems: ['plugins not reinstalled: "files.bump-versions" and "git.merge" must run before "bb.reinstall"'],
    };
  }
  if (!run.gh.ok) return noReinstall();
  return reinstallTouchedPlugins(port, run.changedPaths, {
    repo: run.gh.repo,
    baseBranch: run.gh.baseBranch,
    ownPluginId: OWN_PLUGIN_ID,
  });
}

/** Readonly rules → the mutable shape zod infers for the RPC output. */
const wireRules = (rules: AutomationRules) => ({
  version: rules.version,
  rules: rules.rules.map((rule) => ({ id: rule.id, triggers: [...rule.triggers], actions: [...rule.actions] })),
});

/** The catalog and the current rules, as the agent tools show them. */
function describeRules(rules: AutomationRules): string {
  const line = (label: string, ids: readonly string[]) => `${label}: ${ids.join(", ") || "—"}`;
  return [
    "Triggers:",
    ...TRIGGER_IDS.map((id) => `  ${id} — ${TRIGGERS[id].label}`),
    "Actions:",
    ...ACTION_IDS.map((id) => `  ${id} — ${ACTIONS[id].label}`),
    "",
    "Current rules (JSON, as pr_automation_save takes them):",
    JSON.stringify(rules, null, 2),
    "",
    ...rules.rules.flatMap((rule, i) => [
      `${i + 1}. ${line("when", rule.triggers)} → ${line("do", rule.actions)}`,
      ...ruleProblems(rule).map((p) => `   problem: ${p}`),
    ]),
  ].join("\n");
}
type FileRead = { content: string; contentEncoding: "base64" | "utf8" };

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    githubToken: {
      type: "string",
      // By default the token comes from `gh auth token` on the bb machine;
      // the setting is an optional override (e.g. when gh isn't logged in).
      label: "GitHub token (optional; defaults to gh auth token)",
      secret: true,
    },
  });

  // Dev tool: `bb pr-toast --tone … --title …` (or `--json '<Notification>'`)
  // pushes a preview notification toast to the live plugin frontend, so any
  // tone/title/details/link/threadLink can be eyeballed on demand without
  // reproducing the real event. Pure parsing/validation is
  // src/core/preview-toast.ts; the listener that shows it is
  // src/ui/preview-toast-listener.tsx. Publishing reaches a frontend only if a
  // thread is open (that is where the listener mounts).
  bb.cli.register({
    name: "pr-toast",
    summary: "Dev: push a preview notification toast to the plugin's frontend",
    commands: [
      {
        name: "pr-toast",
        summary: "Send a toast with any tone/title/details/link/threadLink",
        usage:
          "bb pr-toast --tone success|warning|error --title <text> [--detail <text>]... " +
          "[--link-label <text> --link-url <url>] [--thread-label <text> --thread-id <id>] | --json '<Notification>'",
      },
    ],
    run(argv) {
      const parsed = parsePreviewToastArgv(argv);
      if (!parsed.ok) return { exitCode: 1, stderr: `${parsed.error}\n` };
      bb.realtime.publish(PREVIEW_TOAST_CHANNEL, parsed.toast);
      return { exitCode: 0, stdout: `sent ${parsed.toast.tone} toast: ${parsed.toast.title}\n` };
    },
  });

  // Prompts the front end to refetch prState from two sources of truth:
  // - environment:changed — a commit/branch change/git-refs change the git status;
  // - thread:changed(environment-changed) — bb recognized/changed the thread's PR;
  //   without this subscription, the row would only update on an interface reload.
  const republish = (source: RepublishSource = "refresh") => bb.realtime.publish("changed", { source });

  // Mutating RPCs (createPr/fastForward/mergePr) call not plain republish(),
  // but republishAfterMutation(): right after the mutation,
  // `sdk.environments.pullRequest`/`status` on bb's SIDE haven't yet caught
  // up with GitHub (bb itself doesn't learn about the change instantly, see
  // memory/wiki/pr-plugin-live-refresh-event.md) — the first refetch often
  // reads the same stale state, and without a safety net the button would
  // wait for the next event or up to POLL_INTERVAL_MS (20s) in app.tsx,
  // which stretched the PR → Merge switch to about 30 seconds (see
  // memory/decisions/republish-catchup-burst-after-mutation.md). Rather than
  // keeping the general polling short for every idle thread, we send a
  // short burst of repeated republish() calls exactly during the seconds
  // when we OURSELVES know the state is about to catch up.
  const REPUBLISH_CATCHUP_DELAYS_MS = [1000, 3000, 6000, 12000];
  const pendingCatchupTimers = new Set<ReturnType<typeof setTimeout>>();
  function republishAfterMutation(): void {
    republish();
    for (const delay of REPUBLISH_CATCHUP_DELAYS_MS) {
      const timer = setTimeout(() => {
        pendingCatchupTimers.delete(timer);
        republish();
      }, delay);
      timer.unref?.();
      pendingCatchupTimers.add(timer);
    }
  }
  bb.onDispose(() => {
    for (const timer of pendingCatchupTimers) clearTimeout(timer);
    pendingCatchupTimers.clear();
  });

  // What the merging RPCs call instead of republishAfterMutation(): a merge
  // that updates this plugin itself (merged.reinstall.pendingSelfUpdate set)
  // must NOT leave catch-up timers behind — settleReinstall disposes this
  // context seconds later, and a timer firing after that publishes on a stale
  // handle (the "used a stale API handle" toast). See
  // memory/decisions/no-catchup-burst-on-self-update-merge.md. Such a merge
  // nudges once on the live handle; the reloaded instance re-subscribes and
  // carries the rest.
  function republishAfterMerge(reinstall: { pendingSelfUpdate: string | null }): void {
    if (schedulesCatchupBurst(reinstall)) republishAfterMutation();
    else republish();
  }

  // ——— Triggers and actions ———
  // The machinery is data (src/core/automation.ts): every click RPC below is
  // the entry of one `click.*` trigger, run over the saved rules by
  // src/core/automation-run.ts with the effects defined here. Each effect
  // writes what it did into a RunRecord, and the RPC builds its unchanged
  // response from that record. On the default rules this is exactly the
  // behaviour the RPCs had when the chains were written out by hand.
  const loadRules = async (): Promise<AutomationRules> =>
    parseRules((await bb.storage.kv.get(AUTOMATION_RULES_KEY)) ?? DEFAULT_RULES);

  const saveRules = async (input: unknown): Promise<AutomationRules> => {
    const rules = parseRules(input);
    await bb.storage.kv.set(AUTOMATION_RULES_KEY, rules);
    bb.realtime.publish(AUTOMATION_RULES_CHANNEL, {});
    return rules;
  };

  const actionEffects = (threadId: string, record: RunRecord): Effects => {
    const done: StepResult = { ok: true };
    const environmentOrThrow = async (): Promise<string> => {
      const environmentId = await environmentIdOf(bb.sdk, threadId);
      if (!environmentId) throw new Error("The thread has no environment with git.");
      return environmentId;
    };
    const moveTasks = async (status: "in_review" | "done"): Promise<string[]> => {
      const taskStatus = await markLinkedTasksStatus(bbCliClient(), threadId, status);
      const { successKeys, failedTasks } = splitTaskStatusResults(taskStatus.results);
      record.failedTasks.push(...failedTasks);
      record.taskCliError ??= taskStatus.unavailable;
      return [...successKeys];
    };
    return {
      "git.create-pr": async () => {
        const token = await resolveToken(settings);
        record.created = await gatherAndCreate(bb.sdk, bb.storage.kv, token, threadId);
        return { ok: true, emits: ["outcome.pr-created"] };
      },
      "bb.tasks-in-review": async () => {
        record.inReviewTasks.push(...(await moveTasks("in_review")));
        return done;
      },
      "bb.tasks-done": async () => {
        record.doneTasks.push(...(await moveTasks("done")));
        return done;
      },
      // Versions are settled BEFORE the merge, against the base as it is right
      // now, so the merged commit is the one carrying the grown version — see
      // src/wiring/merge-time-bump.ts. The changed-file list it reads is also
      // what bb.reinstall needs after the merge.
      "files.bump-versions": async () => {
        const bump = await settleVersionsForMerge(bb.sdk, settings, await environmentOrThrow());
        record.versionBump = { bumped: bump.bumped.map((b) => ({ ...b })), problems: [...bump.problems] };
        record.changedPaths = bump.changedPaths;
        return done;
      },
      "git.merge": async () => {
        const environmentId = await environmentOrThrow();
        // Whether the head just moved or the PR was opened a moment ago,
        // GitHub may still be computing its mergeability — so the verdict is
        // asked of GitHub itself (src/wiring/mergeability-wait.ts).
        const gh = await githubPullOf(bb.sdk, settings, environmentId);
        record.gh = gh;
        // HEAD BEFORE the merge: the merge is only a request to the GitHub API
        // and does not move local git. Reading it is the last thing allowed to
        // fail as "the merge never started".
        const headSha = await currentHeadSha(bb.sdk, environmentId);
        const failure = await attemptMerge(async () => {
          if (gh.ok) await waitForMergeability(gh.ports, gh.repo, gh.number);
          await bb.sdk.environments.mergePullRequest({ environmentId, method: MERGE_METHOD });
        });
        if (failure !== null) {
          record.mergeFailure = failure;
          return { ok: false };
        }
        record.merged = true;
        // Primes the cache so the button hides at once. Swallowed: the PR is
        // merged, and a failed write must not blame the merge for it.
        if (headSha) {
          try {
            await bb.storage.kv.set(mergedHeadKey(environmentId), headSha);
          } catch {
            // The button waits for the next content measurement, nothing more.
          }
        }
        return { ok: true, emits: ["outcome.merged"] };
      },
      // Best-effort: a failure lands in KV for the "main not pulled" badge and
      // never fails the run (see memory/decisions/local-main-pull-after-merge.md).
      "git.pull-main": async () => {
        record.pullAttempted = true;
        const environmentId = await environmentIdOf(bb.sdk, threadId);
        if (!environmentId) {
          record.pullNoEnvironment = true;
          return done;
        }
        record.pull = await attemptLocalMainPull(bb.sdk, bb.storage.kv, environmentId);
        return done;
      },
      // The merged PR's own file list says which installed plugins now run a
      // stale build — see src/wiring/plugin-reinstall.ts. Only proposed here:
      // the self-update is settled by the RPC as its very last step.
      "bb.reinstall": async () => {
        record.reinstall = await reinstallAfterMerge(bb.sdk.plugins, record);
        return done;
      },
      "bb.archive": async () => {
        const failure = await attemptArchive(() => bb.sdk.threads.archive({ threadId }));
        record.archived = failure === null;
        record.archiveFailure = failure;
        return failure === null ? done : { ok: false };
      },
      "git.fast-forward": async () => {
        await fastForwardBranch(bb.sdk, bb.storage.kv, threadId);
        record.fastForwarded = true;
        return done;
      },
      // threads.unarchive is a real, idempotent SDK action; on an environment
      // stuck "retiring" it also cancels that retire as a side effect of bb's
      // own unarchive route — no agent turn starts, no message is added.
      "bb.wake": async () => {
        await bb.sdk.threads.unarchive({ threadId });
        return done;
      },
      "bb.refresh": async () => {
        republishAfterMerge(record.reinstall);
        return done;
      },
    };
  };

  const runClick = async (threadId: string, trigger: TriggerId): Promise<RunRecord> => {
    const rules = await loadRules();
    // An archive with no merge before it must find the thread ready BEFORE
    // anything runs: no task marked done, nothing archived, on a thread whose
    // PR or tree has moved on since the button was drawn.
    if (archiveNeedsPreflight(actionsFor(rules, trigger))) {
      const state = await computeArchiveState(bb.sdk, bb.storage.kv, settings, threadId);
      if (!state.visible) throw new Error(`Cannot archive: ${state.reason}`);
    }
    const record = emptyRunRecord();
    await runTrigger(rules, trigger, actionEffects(threadId, record));
    return record;
  };

  // The merge's own half of every response that carries one. `settleReinstall`
  // is the last effect any merging RPC performs, so this is built at the
  // return statement, after the run and its refresh.
  const mergeEffects = async (run: RunRecord) => ({
    versionBump: run.versionBump,
    reinstall: await settleReinstall(bb.sdk.plugins, run.reinstall),
  });

  const requireCreated = (run: RunRecord): { url: string; number: number } => {
    if (run.created === null) throw missingAction("git.create-pr");
    return run.created;
  };

  bb.rpc.register(rpcContract, {
    async prState({ threadId }) {
      return computePrState(bb.sdk, bb.storage.kv, settings, threadId);
    },
    async createPr({ threadId }) {
      const run = await runClick(threadId, "click.pr");
      return { ...requireCreated(run), inReviewTasks: run.inReviewTasks, failedTasks: run.failedTasks, taskCliError: run.taskCliError };
    },
    // If the merge leg is refused, the PR still exists and surfaces its own
    // "Merge" button on the next refetch — nothing is silently lost.
    async createAndMergePr({ threadId }) {
      const run = await runClick(threadId, "click.pr-merge");
      const created = requireCreated(run);
      return {
        ...created,
        ...(await mergeEffects(run)),
        inReviewTasks: run.inReviewTasks,
        failedTasks: run.failedTasks,
        taskCliError: run.taskCliError,
        failure: run.mergeFailure,
      };
    },
    // A merge that did not land stops the run (src/core/automation-run.ts):
    // nothing is archived and nothing marked done on it.
    async createMergeArchivePr({ threadId }) {
      const run = await runClick(threadId, "click.pr-merge-archive");
      const created = requireCreated(run);
      return {
        ...created,
        ...(await mergeEffects(run)),
        archived: run.archived,
        doneTasks: run.doneTasks,
        failedTasks: run.failedTasks,
        taskCliError: run.taskCliError,
        failure: run.mergeFailure ?? run.archiveFailure,
      };
    },
    async fastForwardState({ threadId }) {
      return computeFastForwardState(bb.sdk, bb.storage.kv, threadId);
    },
    // A refusal throws out of the effect, and the run still fires
    // outcome.mutated: the button's cache-backed "ready" answer must not stay
    // on screen until the next poll, making every click fail the same way.
    async fastForward({ threadId }) {
      const run = await runClick(threadId, "click.ff");
      return { ok: run.fastForwarded };
    },
    async mergeState({ threadId }) {
      return computeMergeState(bb.sdk, settings, threadId);
    },
    // The plain Merge button keeps its old promise: a refused merge is a
    // rejection, not a result, and publishes nothing.
    async mergePr({ threadId }) {
      const run = await runClick(threadId, "click.merge");
      if (run.mergeFailure !== null) throw new Error(run.mergeFailure.message);
      return { ok: run.merged, ...(await mergeEffects(run)) };
    },
    async repointPlugin(request) {
      await runRepoint(bb.sdk.plugins, request);
      return { ok: true };
    },
    // The same merge as mergePr, then the archive; a refused merge rejects
    // before the archive, a refused archive is a failed leg of a landed merge.
    async mergeArchivePr({ threadId }) {
      const run = await runClick(threadId, "click.merge-archive");
      if (run.mergeFailure !== null) throw new Error(run.mergeFailure.message);
      return {
        ok: run.merged,
        ...(await mergeEffects(run)),
        archived: run.archived,
        doneTasks: run.doneTasks,
        failedTasks: run.failedTasks,
        taskCliError: run.taskCliError,
        failure: run.archiveFailure,
      };
    },
    async mainPullState({ threadId }) {
      return computeMainPullState(bb.sdk, bb.storage.kv, threadId);
    },
    async retryMainPull({ threadId }) {
      const run = await runClick(threadId, "click.retry-main");
      if (!run.pullAttempted) throw missingAction("git.pull-main");
      if (run.pullNoEnvironment) throw new Error("The thread has no environment with git.");
      if (!run.pull) {
        throw new Error("The environment has no working copy or base branch — nothing to pull.");
      }
      return normalizeMainPull(run.pull);
    },
    async wakeUpState({ threadId }) {
      return computeWakeUpState(bb.sdk, threadId);
    },
    async wakeUp({ threadId }) {
      await runClick(threadId, "click.wake");
      return { ok: true };
    },
    async archiveState({ threadId }) {
      return computeArchiveState(bb.sdk, bb.storage.kv, settings, threadId);
    },
    async archiveThread({ threadId }) {
      const run = await runClick(threadId, "click.archive");
      if (run.archiveFailure !== null) throw new Error(run.archiveFailure.message);
      return { ok: true, doneTasks: run.doneTasks, failedTasks: run.failedTasks, taskCliError: run.taskCliError };
    },
    async automationRules() {
      return { rules: wireRules(await loadRules()) };
    },
    async saveAutomationRules({ rules }) {
      return { rules: wireRules(await saveRules(rules)) };
    },
    // The sidebar icon is the thread-status display. With no status shown at
    // all the facts are not even measured; which states show is filtered by
    // the content script, which asks on its own 20-second poll and on nothing
    // else — so only a rule holding the poll shows a status.
    async rowFacts({ threadId }) {
      if (statusesShown(await loadRules()).size === 0) return { gitPhase: "unknown" as const, pr: null };
      return computeRowFacts(bb.sdk, bb.storage.kv, settings, threadId);
    },
    async baseModeState({ threadId }) {
      return computeBaseModeState(bb.sdk, bb.storage.kv, threadId);
    },
    async setBaseMode({ threadId, mode }) {
      const environmentId = await environmentIdOf(bb.sdk, threadId);
      if (!environmentId) throw new Error("The thread has no environment with git.");
      await bb.storage.kv.set(baseModeKey(environmentId), mode);
      // Every header button's usePolledState listens for "changed" — the
      // same catch-up burst a merge/fast-forward uses so the buttons that
      // read the base (their visibility, ahead count, readiness) don't sit
      // on the old mode until the next 20s poll.
      republishAfterMutation();
      return { ok: true };
    },
  });

  const unsubscribeEnv = bb.sdk.subscribe({
    event: "environment:changed",
    callback: () => republish("state.env"),
  });
  const unsubscribeThread = bb.sdk.subscribe({
    event: "thread:changed",
    callback: (event) => {
      if (threadChangeTouchesPr(event.changes)) republish("state.thread-pr");
    },
  });
  bb.agents.registerTool({
    name: "pr_automation_read",
    description:
      "Read the Pull Request plugin's triggers-and-actions rules: the catalog of trigger and action ids and the current rules table.",
    parameters: z.object({}).strict(),
    async execute() {
      return describeRules(await loadRules());
    },
  });
  bb.agents.registerTool({
    name: "pr_automation_save",
    description:
      "Replace the Pull Request plugin's triggers-and-actions rules ({ rules: { version: 2, rules: [...] } }) or restore the defaults ({ reset: true }). Answers the saved rules with any problems.",
    parameters: z.union([
      z.object({ reset: z.literal(true) }).strict(),
      z.object({ rules: z.object({ version: z.union([z.literal(1), z.literal(2)]), rules: z.array(z.unknown()) }) }).strict(),
    ]),
    async execute(params) {
      return describeRules(await saveRules("reset" in params ? DEFAULT_RULES : params.rules));
    },
  });

  bb.onDispose(unsubscribeEnv);
  bb.onDispose(unsubscribeThread);

  bb.log.info("pull-request loaded");
}

async function computePrState(
  sdk: Sdk,
  kv: PluginKvStorage,
  settings: GithubTokenSettings,
  threadId: string,
): Promise<{ visible: boolean; reason: string; prUrl: string | null; nextNumber: number | null }> {
  const environmentId = await environmentIdOf(sdk, threadId);
  if (!environmentId) {
    return { visible: false, reason: "no-environment", prUrl: null, nextNumber: null };
  }

  const env = await sdk.environments.get({ environmentId });
  const base = resolveBase(env, await resolveBaseMode(kv, environmentId));
  if (!base) return { visible: false, reason: "no-base-branch", prUrl: null, nextNumber: null };

  // Without an explicit base, bb doesn't compute mergeBase (and with it
  // aheadCount) — the button would then always hide as "nothing to PR". We
  // compute against base.statusBase (the remote by default, or the local ref
  // in base mode "local"), otherwise a stale local main produces a phantom
  // ahead.
  const status = await sdk.environments.status({
    environmentId,
    mergeBaseBranch: base.statusBase,
  });
  if (status.outcome !== "available") {
    return { visible: false, reason: `status-${status.outcome}`, prUrl: null, nextNumber: null };
  }

  const pr = await resolvePrSignal(sdk, () => resolveToken(settings), environmentId, env, base);
  const liveAhead = await liveAheadOf(env.path, base);
  const decision = await resolveVisibility(
    visibilityPorts(kv, environmentId, env.path, base),
    { workspace: visibilityWorkspace(status.workspace, liveAhead), pr: pr.presence },
  );
  if (!decision.visible) {
    return { visible: false, reason: decision.reason, prUrl: pr.url, nextNumber: null };
  }

  const nextNumber = await peekNextPrNumber(sdk, settings, env);
  return { visible: true, reason: decision.reason, prUrl: pr.url, nextNumber };
}

// Best-effort preview of the button's number, shown before the click. Needs
// a working copy on disk (to read origin) and a token — either missing, or
// GitHub unreachable, degrades to no number rather than failing prState or
// hiding the button: the number is a label, not something the button's
// visibility depends on. Reads the repo before the token, so the common
// case of "no working copy on disk" never touches `gh`/settings at all.
async function peekNextPrNumber(
  sdk: Sdk,
  settings: GithubTokenSettings,
  env: { hostId: string; path: string | null },
): Promise<number | null> {
  if (!env.path) return null;
  try {
    const repo = await readOrigin(sdk, env.hostId, env.path);
    const token = await resolveToken(settings);
    return await fetchNextPrNumber(githubClient(token), repo);
  } catch {
    return null;
  }
}

// The ports for resolveVisibility: KV as the cache of the measured fact, git
// as the measurement itself. The order in which they are consulted lives in
// src/wiring/visibility-decision.ts.
function visibilityPorts(
  kv: PluginKvStorage,
  environmentId: string,
  path: string | null,
  base: ResolvedBase,
): VisibilityPorts {
  return {
    cachedHeadMatches: (headSha) => wasHeadAlreadyMerged(kv, environmentId, headSha),
    rememberMerged: (headSha) => kv.set(mergedHeadKey(environmentId), headSha),
    // Without a working copy on disk there is nothing to run git in, and the
    // question stays unanswered rather than being guessed at.
    measure: async () => (path ? checkMergedContent(gitClient(path), base) : "unknown"),
  };
}

function visibilityWorkspace(
  workspace: {
    checkout: WorkspaceCheckout;
    workingTree: { hasUncommittedChanges: boolean };
    mergeBase: { aheadCount: number } | null;
  },
  liveAhead: number | null,
): VisibilityWorkspace {
  return {
    headSha: checkoutHeadSha(workspace.checkout),
    hasUncommittedChanges: workspace.workingTree.hasUncommittedChanges,
    aheadCount: liveAhead ?? workspace.mergeBase?.aheadCount ?? 0,
  };
}

// The same staleness computeFastForwardState already guards against (see
// liveAheadCount's doc comment in src/wiring/fast-forward.ts): bb's cached
// aheadCount can sit stale — even at 0 — well past the point a fresh commit
// or a moved `origin/<base>` actually changed it, which either hides the
// "Pull Request" button after a commit or leaves it up after the content
// already landed in base. Fetch and count live whenever there's a working
// copy to measure in; `null` (no path, or the measurement itself failed)
// falls back to the cache rather than guessing.
async function liveAheadOf(path: string | null, base: ResolvedBase): Promise<number | null> {
  return path ? liveAheadCount(gitClient(path), base) : null;
}

// The pre-PR git phase for one thread's environment. Reads the same
// `environments.status` the PR button lives on (against the REMOTE base, so a
// stale local main doesn't inflate aheadCount), then hands the two concrete
// facts to the pure `decideGitPhase`. Anything that can't be measured — no
// environment, status not available — degrades to "unknown", never a throw.
async function computeGitPhase(
  sdk: Sdk,
  kv: PluginKvStorage,
  threadId: string,
): Promise<{ phase: GitPhase }> {
  const environmentId = await environmentIdOf(sdk, threadId);
  if (!environmentId) return { phase: "unknown" };

  const env = await sdk.environments.get({ environmentId });
  const base = resolveBase(env, await resolveBaseMode(kv, environmentId));
  const status = await sdk.environments.status(
    base ? { environmentId, mergeBaseBranch: base.statusBase } : { environmentId },
  );
  if (status.outcome !== "available") return { phase: "unknown" };

  const hasUncommittedChanges = status.workspace.workingTree.hasUncommittedChanges;
  const aheadCount = status.workspace.mergeBase?.aheadCount ?? 0;
  // Measured only when the glyph would otherwise claim "committed changes": a
  // dirty tree already decides the phase, and nothing ahead has nothing to
  // have landed. Cheap — the same measure-once-per-HEAD cache the merge primes
  // (content-cache.ts), so a finished thread answers from KV without git.
  const mergedContent =
    hasUncommittedChanges || aheadCount === 0 || !base
      ? "unknown"
      : await measureContentCached(
          visibilityPorts(kv, environmentId, env.path, base),
          checkoutHeadSha(status.workspace.checkout),
        );

  return { phase: decideGitPhase({ hasUncommittedChanges, aheadCount, mergedContent }) };
}

// Both halves of the sidebar row-status glyph, for the content script that
// has no route/thread context of its own to hang a frontend hook on (see
// memory/decisions/row-status-rpc-not-frontend-hooks.md). Reuses
// `resolvePrSignal` — the same refined signal the Merge button reads — so a
// PR opened after a previous one settled shows up here too, not just in the
// header (see memory/decisions/open-pr-bypass-host-terminal-signal.md).
// Narrowed to the three raw GitHub facts the pure core needs — no separate
// "attention" rollup.
async function computeRowFacts(
  sdk: Sdk,
  kv: PluginKvStorage,
  settings: GithubTokenSettings,
  threadId: string,
): Promise<{
  gitPhase: GitPhase;
  pr: { number: number | null; state: PrState; checksState: ChecksState; mergeability: Mergeability } | null;
}> {
  const environmentId = await environmentIdOf(sdk, threadId);
  if (!environmentId) return { gitPhase: "unknown", pr: null };

  const env = await sdk.environments.get({ environmentId });
  // Only githubBase (mode-independent) is used below, via resolvePrSignal —
  // the accurate, KV-backed mode is computeGitPhase's own concern.
  const base = resolveBase(env, DEFAULT_BASE_MODE);
  const [gitPhase, pr] = await Promise.all([
    computeGitPhase(sdk, kv, threadId),
    resolvePrSignal(sdk, () => resolveToken(settings), environmentId, env, base),
  ]);

  return {
    gitPhase: gitPhase.phase,
    pr:
      pr.state !== null && pr.checksState !== null && pr.mergeability !== null
        ? { number: pr.number, state: pr.state, checksState: pr.checksState, mergeability: pr.mergeability }
        : null,
  };
}

async function computeWakeUpState(sdk: Sdk, threadId: string): Promise<{ visible: boolean }> {
  const environmentId = await environmentIdOf(sdk, threadId);
  if (!environmentId) return { visible: false };

  const env = await sdk.environments.get({ environmentId });
  return { visible: decideWakeUpVisible(env.status) };
}

// Cheap-first: env/base are read up front only because resolvePrSignal needs
// them for its own refinement (a GitHub round trip it only pays for when the
// host says `settled` — see resolvePrSignal's own comment); an unmerged PR
// still answers without ever touching environments.status. Only once the PR
// is merged do we pay for the working-tree and "un-landed commits" checks
// that keep Archive from showing next to another button.
/**
 * Everything `archiveState` can report. Wider than {@link ArchiveReason}: two
 * causes are the shell's own and never reach the pure decision — the thread
 * has no environment at all, and bb's git status came back unusable. Both mean
 * "nothing was measured", but they keep their own names so the refusal text of
 * `archiveThread` still says which one it was.
 */
export type ArchiveStateReason = ArchiveReason | "no-environment" | `status-${string}`;

async function computeArchiveState(
  sdk: Sdk,
  kv: PluginKvStorage,
  settings: GithubTokenSettings,
  threadId: string,
): Promise<{ visible: boolean; reason: ArchiveStateReason }> {
  // The thread's own archive is read first and answers on its own: no git or
  // GitHub fact can put the button back on a thread bb has already put away,
  // and bb shows its native "Thread is archived / Unarchive" bar there
  // instead (see decideArchiveButton).
  const thread = await sdk.threads.get({ threadId });
  if (thread.archivedAt !== null) {
    return decideArchiveButton({ archived: true });
  }

  const environmentId = thread.environmentId;
  if (!environmentId) return { visible: false, reason: "no-environment" };

  const env = await sdk.environments.get({ environmentId });
  const base = resolveBase(env, await resolveBaseMode(kv, environmentId));

  // A retiring environment is one step before `destroying`, so its working
  // copy is still on disk — measure there rather than let bb's refusal
  // masquerade as "not merged", which is exactly how the button used to vanish
  // on a thread whose work had long landed.
  if (!bbReportsGitFacts(env.status)) {
    return decideArchiveVisible(await localArchiveFacts(kv, environmentId, env.path, base));
  }

  const pr = await resolvePrSignal(sdk, () => resolveToken(settings), environmentId, env, base);
  if (pr.state !== "merged") {
    // `absent` and `settled`/`open` are real negatives — there is genuinely
    // nothing merged. `unknown` means bb could not say (no gh, no auth,
    // timeout), and that is NOT a negative; it just isn't evidence either, so
    // both hide the button while naming different reasons.
    return decideArchiveVisible({
      landing: pr.presence === "unknown" ? "unknown" : "not-merged",
      workingTree: "unknown",
    });
  }

  // With a base we read aheadCount too, so the "Pull Request" visibility below
  // can tell landed-and-done from new commits waiting for a fresh PR.
  const status = await sdk.environments.status(
    base ? { environmentId, mergeBaseBranch: base.statusBase } : { environmentId },
  );
  if (status.outcome !== "available") {
    return { visible: false, reason: `status-${status.outcome}` };
  }

  // The same fact — and the same decision — the "Pull Request" button lives on.
  // Deriving "un-landed commits" from it guarantees Archive and Pull Request are
  // never shown at once. Without a base there's nothing ahead to compare against,
  // and the Pull Request button is hidden anyway, so there's no un-landed work.
  const createPr = base
    ? await resolveVisibility(
        visibilityPorts(kv, environmentId, env.path, base),
        {
          workspace: visibilityWorkspace(status.workspace, await liveAheadOf(env.path, base)),
          pr: pr.presence,
        },
      )
    : null;

  return decideArchiveVisible({
    landing: createPr?.visible ? "unlanded-commits" : "landed",
    workingTree: status.workspace.workingTree.hasUncommittedChanges ? "dirty" : "clean",
  });
}

// Without a working copy or a base branch there is nothing to measure against,
// and an unmeasured landing keeps the button hidden — silence is not evidence
// that the work is in main (see
// memory/decisions/archive-visible-on-positive-landing-evidence.md).
async function localArchiveFacts(
  kv: PluginKvStorage,
  environmentId: string,
  path: string | null,
  base: ResolvedBase | null,
): Promise<ArchiveReadinessInput> {
  if (!path || !base) return { landing: "unknown", workingTree: "unknown" };
  // The very same ports the "Pull Request" button uses: one measured "this
  // HEAD is already in base" is written once and serves both buttons, so a
  // retiring thread doesn't re-fetch on every poll.
  return measureArchiveFacts({
    git: gitClient(path),
    ...visibilityPorts(kv, environmentId, path, base),
  });
}

async function computeFastForwardState(
  sdk: Sdk,
  kv: PluginKvStorage,
  threadId: string,
): Promise<{ visible: boolean; reason: string }> {
  const environmentId = await environmentIdOf(sdk, threadId);
  if (!environmentId) return { visible: false, reason: "no-environment" };

  const env = await sdk.environments.get({ environmentId });
  const base = resolveBase(env, await resolveBaseMode(kv, environmentId));
  if (!base) return { visible: false, reason: "no-base-branch" };

  const status = await sdk.environments.status({
    environmentId,
    mergeBaseBranch: base.statusBase,
  });
  if (status.outcome !== "available") {
    return { visible: false, reason: `status-${status.outcome}` };
  }

  const { workingTree, mergeBase } = status.workspace;
  // The cached aheadCount can lie stale at 0 (see liveAheadCount's doc
  // comment in src/wiring/fast-forward.ts) — measure live when there's a
  // working copy to measure in, and fall back to the cache only when that
  // measurement itself is unavailable.
  const liveAhead = env.path ? await liveAheadCount(gitClient(env.path), base) : null;
  const decision = decideFastForward({
    behindCount: mergeBase?.behindCount ?? 0,
    aheadCount: liveAhead ?? mergeBase?.aheadCount ?? 0,
    hasUncommittedChanges: workingTree.hasUncommittedChanges,
  });
  return { visible: decision.visible, reason: decision.reason };
}

async function gatherAndCreate(
  sdk: Sdk,
  kv: PluginKvStorage,
  token: string,
  threadId: string,
): Promise<{ url: string; number: number }> {
  // The whole thread, not just its environment id: its name is one of the
  // sources the PR is named from (see choosePrTitle below).
  const thread = await sdk.threads.get({ threadId });
  const environmentId = thread.environmentId;
  if (!environmentId) throw new Error("The thread has no environment with git.");

  const env = await sdk.environments.get({ environmentId });
  const base = resolveBase(env, await resolveBaseMode(kv, environmentId));
  if (!base) throw new Error("Could not determine the environment's base branch.");

  const status = await sdk.environments.status({
    environmentId,
    mergeBaseBranch: base.statusBase,
  });
  if (status.outcome !== "available") {
    throw new Error(`environment git status unavailable (${status.outcome}).`);
  }

  // The token is already resolved (it's needed for runCreatePr too) —
  // wrapped instead of re-resolving via settings, so refining a `settled`
  // signal here never spawns a second `gh auth token` for the same call.
  const pr = await resolvePrSignal(sdk, () => Promise.resolve(token), environmentId, env, base);
  const { mergeBase } = status.workspace;
  const liveAhead = await liveAheadOf(env.path, base);
  const decision = await resolveVisibility(
    visibilityPorts(kv, environmentId, env.path, base),
    { workspace: visibilityWorkspace(status.workspace, liveAhead), pr: pr.presence },
  );
  if (!decision.visible || !mergeBase) {
    throw new Error(`Can't open a PR right now (${decision.reason}).`);
  }

  const path = env.path;
  if (!path) throw new Error("The environment has no working copy on disk.");
  const headBranch = env.branchName;
  if (!headBranch) throw new Error("The environment has no current branch.");

  // The same status object that lists the changed files also names the
  // commit they were diffed against — that commit becomes the PR commit's
  // parent, so the two can't drift apart.
  const mergeBaseSha = parseMergeBaseRef(mergeBase.baseRef);
  if (!mergeBaseSha) {
    throw new Error(`bb did not resolve the merge-base of ${headBranch} with ${base.statusBase}.`);
  }

  const repo = await readOrigin(sdk, env.hostId, path);
  const changedFiles = await buildChangedFiles(sdk, env.hostId, path, mergeBase.files);
  const github = githubClient(token);
  const files = await applyPluginVersionBumps(
    githubVersionBumpPorts(github.send, repo),
    { mergeBase: mergeBaseSha, baseTip: base.githubBase },
    mergeBase.files.map((file) => file.path),
    changedFiles,
  );
  const title = choosePrTitle({
    task: await readLinkedTask(bbCliClient(), threadId),
    threadName: thread.title ?? thread.titleFallback,
    commitSubjects: mergeBase.commits.map((commit) => commit.subject),
    branch: headBranch,
  });

  return runCreatePr(github, {
    repo,
    baseBranch: base.githubBase,
    mergeBaseSha,
    headBranch,
    files,
    title,
    body: prBody(mergeBase.commits),
  });
}

async function fastForwardBranch(
  sdk: Sdk,
  kv: PluginKvStorage,
  threadId: string,
): Promise<{ ok: boolean }> {
  const environmentId = await environmentIdOf(sdk, threadId);
  if (!environmentId) throw new Error("The thread has no environment with git.");

  const env = await sdk.environments.get({ environmentId });
  const base = resolveBase(env, await resolveBaseMode(kv, environmentId));
  if (!base) throw new Error("Could not determine the environment's base branch.");

  const status = await sdk.environments.status({
    environmentId,
    mergeBaseBranch: base.statusBase,
  });
  if (status.outcome !== "available") {
    throw new Error(`environment git status unavailable (${status.outcome}).`);
  }

  const { workingTree, mergeBase } = status.workspace;
  const decision = decideFastForward({
    behindCount: mergeBase?.behindCount ?? 0,
    aheadCount: mergeBase?.aheadCount ?? 0,
    hasUncommittedChanges: workingTree.hasUncommittedChanges,
  });
  if (!decision.visible) {
    throw new Error(`Fast-forward is not possible right now (${decision.reason}).`);
  }

  const path = env.path;
  if (!path) throw new Error("The environment has no working copy on disk.");

  await runFastForward(gitClient(path), base);
  return { ok: true };
}

async function computeMergeState(
  sdk: Sdk,
  settings: GithubTokenSettings,
  threadId: string,
): Promise<{
  visible: boolean;
  indicator: MergeIndicator;
  prUrl: string | null;
  number: number | null;
}> {
  const environmentId = await environmentIdOf(sdk, threadId);
  if (!environmentId) return { visible: false, indicator: "unknown", prUrl: null, number: null };

  const env = await sdk.environments.get({ environmentId });
  // GitHub computes checks/mergeability against its own base branch — only
  // githubBase (mode-independent) is used below, via resolvePrSignal.
  const base = resolveBase(env, DEFAULT_BASE_MODE);
  const pr = await resolvePrSignal(sdk, () => resolveToken(settings), environmentId, env, base);
  if (pr.state === null || pr.checksState === null || pr.mergeability === null) {
    return { visible: false, indicator: "unknown", prUrl: pr.url, number: pr.number };
  }
  const decision = decideMergeReadiness({
    prState: pr.state,
    checksState: pr.checksState,
    mergeability: pr.mergeability,
  });
  return { visible: decision.visible, indicator: decision.indicator, prUrl: pr.url, number: pr.number };
}

// We merge with the same method (squash) the project already uses to land a
// branch onto main — see memory/decisions/fast-forward-ff-only-safe.md. bb
// itself makes the request to GitHub (sdk.environments.mergePullRequest),
// the plugin doesn't need to build it by hand like it does for createPr.
const MERGE_METHOD = "squash";

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The merge itself, once the version bump above it has already been made. */
async function attemptMerge(run: () => Promise<void>): Promise<MergeFailure | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return { step: "merge", message: messageOf(error) };
  }
}

/**
 * The archive after a merge. The merge has landed by then, so a refusal is an
 * `ArchiveFailure`, not a rejection that would take the merged PR with it.
 */
async function attemptArchive(run: () => Promise<unknown>): Promise<ArchiveFailure | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return { step: "archive", message: messageOf(error) };
  }
}

// What a merge that never ran reports about the effects it never had. A fresh
// object rather than a shared constant: a shared empty report would be one set
// of arrays every caller could append to.
const noReinstall = (): ReinstallReport => ({
  reinstalled: [],
  installed: [],
  repoints: [],
  problems: [],
  pendingSelfUpdate: null,
});

/**
 * The last thing any merging RPC does: update the plugin running it. bb
 * invalidates this plugin's API handle as it updates, so every `bb.*` call
 * after this line throws `PluginContextStaleError` — which is how a merge that
 * HAD gone through came back as a failed one (PR #293). Nothing but building
 * the response may follow.
 *
 * Forgetting the call does not compile: `ReinstallReport` holds readonly
 * arrays, and the contract's `reinstall` is the mutable shape zod infers.
 */
async function settleReinstall(port: PluginsPort, report: ReinstallReport) {
  const settled = await applyPendingSelfUpdate(port, report);
  return {
    reinstalled: [...settled.reinstalled],
    installed: [...settled.installed],
    repoints: settled.repoints.map((repoint) => ({ ...repoint })),
    problems: [...settled.problems],
  };
}

// Resolves everything bumpVersionsBeforeMerge needs from the environment
// and hands off. Every way of not getting there is a `problems` entry, not
// a throw: the merge itself must not be blocked by its own bookkeeping, but
// the user must see that the bookkeeping did not happen. The cheap local
// checks come first so that a thread without a PR never spawns `gh` for a
// token it would not use.
type GithubPull =
  | {
      ok: true;
      ports: CreatePrPorts;
      repo: RepoRef;
      baseBranch: string;
      headBranch: string;
      number: number;
    }
  | { ok: false; reason: string };

// Everything the merge-time steps need to talk to GitHub about this PR: the
// REST port, the repository, both branches and the PR number. Every way of
// not getting there is a reason, not a throw — the merge itself must not be
// blocked by its own bookkeeping, only told why the bookkeeping did not
// happen. The cheap local checks (base/branch/working copy) come first, before
// any token or network is touched.
//
// The PR number is resolved with a fallback: bb's own cache
// (`sdk.environments.pullRequest`, via lookupPullRequest) lags right after a
// mutation (see republishAfterMutation), and the combined "open + merge"
// flows (createAndMergePr/createMergeArchivePr) open the PR milliseconds
// earlier — so on that path bb still answers "no PR" and the version bump,
// mergeability wait and reinstall were all skipped for a PR that plainly
// exists. When the cache has no number we ask GitHub directly, the same
// unstuck path resolvePrSignal uses (findLiveOpenPr + refineWithLiveOpenPr).
// The round trip is paid only on the merge action, never on the idle poll.
async function githubPullOf(
  sdk: Sdk,
  settings: GithubTokenSettings,
  environmentId: string,
): Promise<GithubPull> {
  try {
    const env = await sdk.environments.get({ environmentId });
    // The GitHub API only ever wants the bare branch name (githubBase,
    // mode-independent) — this call never touches statusBase.
    const base = resolveBase(env, DEFAULT_BASE_MODE);
    if (!base) return { ok: false, reason: "could not determine the base branch" };
    if (!env.path) return { ok: false, reason: "the environment has no working copy on disk" };
    if (!env.branchName) return { ok: false, reason: "the environment has no current branch" };
    const token = await resolveToken(settings);
    const repo = await readOrigin(sdk, env.hostId, env.path);
    const host = await lookupPullRequest(sdk, environmentId);
    const pr =
      host.number !== null
        ? host
        : refineWithLiveOpenPr(
            host,
            await findLiveOpenPr(githubClient(token), repo, env.branchName, base.githubBase),
          );
    if (pr.number === null) return { ok: false, reason: "bb reports no pull request for this branch" };
    return {
      ok: true,
      ports: githubClient(token),
      repo,
      baseBranch: base.githubBase,
      headBranch: env.branchName,
      number: pr.number,
    };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

async function settleVersionsForMerge(
  sdk: Sdk,
  settings: GithubTokenSettings,
  environmentId: string,
): Promise<MergeTimeBumpReport> {
  const skipped = (reason: string): MergeTimeBumpReport => ({
    changedPaths: [],
    bumped: [],
    problems: [`versions not settled: ${reason}`],
    headMoved: false,
  });
  const gh = await githubPullOf(sdk, settings, environmentId);
  if (!gh.ok) return skipped(gh.reason);
  try {
    return await bumpVersionsBeforeMerge(gh.ports, {
      repo: gh.repo,
      baseBranch: gh.baseBranch,
      headBranch: gh.headBranch,
      pullNumber: gh.number,
    });
  } catch (error) {
    return skipped(error instanceof Error ? error.message : String(error));
  }
}

// The shape retryMainPull's RPC response gives the main-pull result:
// `LocalMainPullResult` doesn't carry a `reason` on the success branch, while
// the RPC's zod schema requires the field always — here it's normalized to a
// present `null`.
function normalizeMainPull(pull: LocalMainPullResult): { ok: boolean; reason: string | null } {
  return pull.ok ? { ok: true, reason: null } : { ok: false, reason: pull.reason };
}

// The shared step for git.pull-main (best-effort, after a merge by default)
// and retryMainPull (an explicit retry on click): resolve the environment's
// path/base, try to pull main, and save the result to KV. Returns `null`
// when there's nothing to try (no path or base branch) — the effect
// silently skips the step at that point, retryMainPull turns it into an RPC error.
async function attemptLocalMainPull(
  sdk: Sdk,
  kv: PluginKvStorage,
  environmentId: string,
): Promise<LocalMainPullResult | null> {
  const env = await sdk.environments.get({ environmentId });
  // This always pulls the remote into the local ref — its own job regardless
  // of the base-mode toggle — so only githubBase (mode-independent) is used.
  const base = resolveBase(env, DEFAULT_BASE_MODE);
  if (!base || !env.path) return null;

  const pull = await runLocalMainPull(gitClient(env.path), base.githubBase);
  await kv.set(localMainPullKey(environmentId), pull);
  return pull;
}

async function computeMainPullState(
  sdk: Sdk,
  kv: PluginKvStorage,
  threadId: string,
): Promise<{ attempted: boolean; ok: boolean; reason: string | null }> {
  const environmentId = await environmentIdOf(sdk, threadId);
  if (!environmentId) return { attempted: false, ok: true, reason: null };

  const stored = await kv.get<LocalMainPullResult>(localMainPullKey(environmentId));
  if (!stored) return { attempted: false, ok: true, reason: null };
  return stored.ok
    ? { attempted: true, ok: true, reason: null }
    : { attempted: true, ok: false, reason: stored.reason };
}

async function currentHeadSha(sdk: Sdk, environmentId: string): Promise<string | null> {
  const status = await sdk.environments.status({ environmentId });
  return status.outcome === "available" ? checkoutHeadSha(status.workspace.checkout) : null;
}

// "unborn" (a repository with no commits) and "unknown" (could not
// determine) carry no SHA at all — they have nothing to compare against a
// stored "already merged".
type WorkspaceCheckout =
  | { kind: "branch"; headSha: string | null }
  | { kind: "detached"; headSha: string | null }
  | { kind: "unborn" }
  | { kind: "unknown" };

function checkoutHeadSha(checkout: WorkspaceCheckout): string | null {
  switch (checkout.kind) {
    case "branch":
    case "detached":
      return checkout.headSha;
    case "unborn":
    case "unknown":
      return null;
  }
}

// A cache of the measured fact, not a memory of our own action. The content
// check (src/wiring/merged-content.ts) costs a `git fetch`, and its answer
// cannot change while HEAD stays put — so a HEAD once found merged is
// remembered, and every later poll answers from KV without touching the
// network. A new commit moves HEAD, the match breaks, and the fact gets
// measured again.
//
// The value is only ever trusted as "already merged"; nothing hides behind
// its absence, so a cache that was never written (a merge through bb's own
// button, through github.com, through `gh`) costs one measurement, not a
// ghost button — see memory/decisions/pr-button-merged-by-content.md.
function mergedHeadKey(environmentId: string): string {
  return `merged-head:${environmentId}`;
}

function localMainPullKey(environmentId: string): string {
  return `local-main-pull:${environmentId}`;
}

function baseModeKey(environmentId: string): string {
  return `base-mode:${environmentId}`;
}

/** The one shared base-mode choice for an environment; unset or malformed KV both mean the default. */
async function resolveBaseMode(kv: PluginKvStorage, environmentId: string): Promise<BaseMode> {
  const stored = await kv.get<BaseMode>(baseModeKey(environmentId));
  return isBaseMode(stored) ? stored : DEFAULT_BASE_MODE;
}

async function computeBaseModeState(
  sdk: Sdk,
  kv: PluginKvStorage,
  threadId: string,
): Promise<{ mode: BaseMode }> {
  const environmentId = await environmentIdOf(sdk, threadId);
  if (!environmentId) return { mode: DEFAULT_BASE_MODE };
  return { mode: await resolveBaseMode(kv, environmentId) };
}

async function wasHeadAlreadyMerged(
  kv: PluginKvStorage,
  environmentId: string,
  headSha: string | null,
): Promise<boolean> {
  if (!headSha) return false;
  const mergedSha = await kv.get<string>(mergedHeadKey(environmentId));
  return mergedSha === headSha;
}

async function environmentIdOf(sdk: Sdk, threadId: string): Promise<string | null> {
  const thread = await sdk.threads.get({ threadId });
  return thread.environmentId;
}

// environments.pullRequest throws a 409 for personal/non-git/deleted
// environments — that's not our error, it's "there's nowhere for a PR to
// come from here". We swallow it into "unknown" so prState doesn't fail on
// every such thread.
//
// A live PR (open/draft) blocks the button; a merged/closed one doesn't: a
// new PR can be opened for a new commit on top of a merged one.
async function lookupPullRequest(sdk: Sdk, environmentId: string): Promise<PrSignal> {
  try {
    const pr = await sdk.environments.pullRequest({ environmentId });
    if (pr.outcome === "available") {
      const { state, url, number, checks, mergeability } = pr.pullRequest;
      const presence: PrPresence =
        state === "open" || state === "draft" ? "open" : "settled";
      return {
        presence,
        url,
        number,
        state,
        checksState: checks.state,
        mergeability: parseMergeability(mergeability.mergeable),
      };
    }
    if (pr.outcome === "absent") {
      return {
        presence: "absent",
        url: null,
        number: null,
        state: null,
        checksState: null,
        mergeability: null,
      };
    }
    return {
      presence: "unknown",
      url: null,
      number: null,
      state: null,
      checksState: null,
      mergeability: null,
    };
  } catch {
    return {
      presence: "unknown",
      url: null,
      number: null,
      state: null,
      checksState: null,
      mergeability: null,
    };
  }
}

// Best-effort direct GitHub measurement for "is there a live open PR on this
// branch" — bypasses the host's own signal entirely. Used by resolvePrSignal
// to refine a stale host verdict, and by computeRowFacts alongside it.
// Degrades to `null` on any missing piece (no base, no working copy, no
// branch name) or any failure (no token, origin unreadable, GitHub
// unreachable) — never throws, same spirit as lookupPullRequest.
async function findLiveOpenPrForEnv(
  sdk: Sdk,
  getToken: () => Promise<string>,
  env: { hostId: string; path: string | null; branchName: string | null },
  base: ResolvedBase | null,
): Promise<OpenPullRequest | null> {
  if (!base || !env.path || !env.branchName) return null;
  try {
    const repo = await readOrigin(sdk, env.hostId, env.path);
    const token = await getToken();
    return await findLiveOpenPr(githubClient(token), repo, env.branchName, base.githubBase);
  } catch {
    return null;
  }
}

// The single point where a stale host `pr` signal is upgraded to `open` when
// GitHub itself already has a live PR for the branch that the host stopped
// tracking (see memory/decisions/open-pr-bypass-host-terminal-signal.md).
// Every call site that used to read `lookupPullRequest` directly reads this
// instead, so the header buttons, the archive gate, the create-PR guard and
// the sidebar row-status glyph all agree on the same, unstuck signal.
//
// Only `settled` is the one gap worth double-checking — a host verdict of
// merged/closed for a branch that has since grown a fresh open PR (the
// normal flow once a settled PR lets the "Pull Request" button reappear).
// `absent` and `unknown` are trusted as-is too: paying for a GitHub round
// trip there wouldn't fix anything a `settled`→`open` upgrade doesn't
// already cover, and `open` is already live and correct. Either way the
// network is only ever touched for the one case it can actually fix.
async function resolvePrSignal(
  sdk: Sdk,
  getToken: () => Promise<string>,
  environmentId: string,
  env: { hostId: string; path: string | null; branchName: string | null },
  base: ResolvedBase | null,
): Promise<PrSignal> {
  const host = await lookupPullRequest(sdk, environmentId);
  if (host.presence !== "settled") return host;
  const found = await findLiveOpenPrForEnv(sdk, getToken, env, base);
  return refineWithLiveOpenPr(host, found);
}

type GithubTokenSettings = { get(): Promise<{ githubToken: string | undefined }> };

// The default token comes from gh on the bb machine; we only call gh when
// the setting is empty, to avoid spawning the process needlessly.
async function resolveToken(settings: GithubTokenSettings): Promise<string> {
  const { githubToken } = await settings.get();
  const ghToken = githubToken?.trim() ? null : await ghAuthToken();
  const token = chooseToken(githubToken, ghToken);
  if (!token) {
    throw new Error(
      "No GitHub token: gh is not authorized and no token is set in the settings. " +
        "Run `gh auth login` or set a token in the plugin settings.",
    );
  }
  return token;
}

async function readOrigin(
  sdk: Sdk,
  hostId: string,
  path: string,
): Promise<RepoRef> {
  const configText = await readGitConfig(sdk, hostId, path);
  const originUrl = originUrlFromGitConfig(configText);
  if (!originUrl) throw new Error("git-config has no origin remote.");
  const repo = parseGithubRemote(originUrl);
  if (!repo) throw new Error(`origin is not on github.com: ${originUrl}`);
  return repo;
}

// For a worktree, `<path>/.git` is a pointer file to the shared gitdir; for
// a regular checkout it's a directory, and then config sits right in
// `<path>/.git/config`.
async function readGitConfig(
  sdk: Sdk,
  hostId: string,
  path: string,
): Promise<string> {
  try {
    const pointer = decode(await sdk.files.read({ path: `${path}/.git`, hostId }));
    const gitdir = parseGitdirPointer(pointer);
    if (gitdir) {
      return decode(
        await sdk.files.read({ path: configPathFromGitdir(gitdir), hostId }),
      );
    }
  } catch {
    // `.git` is a directory: fall through to reading config directly below.
  }
  return decode(await sdk.files.read({ path: `${path}/.git/config`, hostId }));
}

async function buildChangedFiles(
  sdk: Sdk,
  hostId: string,
  path: string,
  files: readonly { path: string; status: Parameters<typeof isDeletion>[0] }[],
): Promise<ChangedFile[]> {
  const result: ChangedFile[] = [];
  for (const file of files) {
    if (isDeletion(file.status)) {
      result.push({ kind: "delete", path: file.path });
      continue;
    }
    const read = (await sdk.files.read({
      path: `${path}/${file.path}`,
      hostId,
    })) as FileRead;
    // We hand the content to GitHub as is: utf8 → blob utf-8, base64 → base64.
    result.push({
      kind: "upsert",
      path: file.path,
      content: read.content,
      encoding: read.contentEncoding === "base64" ? "base64" : "utf-8",
    });
  }
  return result;
}

function prBody(commits: readonly { subject: string }[]): string {
  if (commits.length === 0) return "Opened from bb.";
  return commits.map((commit) => `- ${commit.subject}`).join("\n");
}

function decode(file: FileRead): string {
  return file.contentEncoding === "base64" ? decodeBase64(file.content) : file.content;
}
