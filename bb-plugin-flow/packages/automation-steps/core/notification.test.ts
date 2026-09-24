import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  cliWarnings,
  errorNotification,
  mergeErrorNotification,
  mergeEffectDetails,
  mergeEffectWarnings,
  prMergedArchivedNotifications,
  prMergedNotifications,
  prOpenedAndMergedNotifications,
  prOpenedMergedArchivedNotifications,
  prOpenedNotifications,
  repointPrompt,
  repointedNotification,
  taskWarnings,
  threadArchivedNotifications,
  type FailedTask,
  type Notification,
  type ReinstallOutcome,
  type VersionBumpOutcome,
} from "./notification";

const noBump: VersionBumpOutcome = { bumped: [], problems: [] };
const noReinstall: ReinstallOutcome = { reinstalled: [], installed: [], repoints: [], problems: [] };
const reinstallOf = (partial: Partial<ReinstallOutcome>): ReinstallOutcome => ({ ...noReinstall, ...partial });
const repoint = {
  pluginId: "tasks-plus",
  from: "path:/Users/x/worktrees/bb-plugins/bb-plugin-tasks-plus",
  source: "git:https://github.com/e0068/bb-plugins.git@main",
  subdirectory: "bb-plugin-tasks-plus",
};

/** Arbitraries that mirror what the backend can actually return. */
const arbTask = fc.record({ key: fc.string(), reason: fc.string() });
const arbBump: fc.Arbitrary<VersionBumpOutcome> = fc.record({
  bumped: fc.array(fc.record({ root: fc.string(), to: fc.string() })),
  problems: fc.array(fc.string()),
});
const arbRepoint = fc.record({
  pluginId: fc.string(),
  from: fc.string(),
  source: fc.string(),
  subdirectory: fc.string(),
});
const arbReinstall: fc.Arbitrary<ReinstallOutcome> = fc.record({
  reinstalled: fc.array(fc.string()),
  installed: fc.array(fc.string()),
  repoints: fc.array(arbRepoint),
  problems: fc.array(fc.string()),
});
const troubles = (notifications: readonly Notification[]): readonly Notification[] =>
  notifications.filter((notification) => notification.tone !== "success");

describe("mergeEffectDetails", () => {
  it("folds every side effect of a merge into lines of one notification", () => {
    expect(
      mergeEffectDetails({
        versionBump: { bumped: [{ root: "tasks-plus", to: "0.2.0" }], problems: [] },
        reinstall: reinstallOf({ reinstalled: ["tasks-plus"] }),
      }),
    ).toEqual(["Bumped tasks-plus to 0.2.0", "Reinstalled tasks-plus"]);
  });

  it("says nothing about a merge that had no side effects", () => {
    expect(mergeEffectDetails({ versionBump: noBump, reinstall: noReinstall })).toEqual([]);
  });

  it("never mentions the local main it fast-forwarded — success is silent, failure is the badge's", () => {
    expect(
      mergeEffectDetails({ versionBump: noBump, reinstall: reinstallOf({ reinstalled: ["tasks-plus"] }) }),
    ).toEqual(["Reinstalled tasks-plus"]);
  });

  it("lists several bumps on one line", () => {
    expect(
      mergeEffectDetails({
        versionBump: { bumped: [{ root: "a", to: "1.0.1" }, { root: "b", to: "2.3.0" }], problems: [] },
        reinstall: noReinstall,
      }),
    ).toEqual(["Bumped a to 1.0.1, b to 2.3.0"]);
  });

  it("never turns a problem into a detail — problems are their own warnings", () => {
    fc.assert(
      fc.property(arbBump, arbReinstall, (versionBump, reinstall) => {
        const details = mergeEffectDetails({ versionBump, reinstall });
        expect(details.length).toBe(
          (versionBump.bumped.length > 0 ? 1 : 0) +
            (reinstall.reinstalled.length > 0 ? 1 : 0) +
            (reinstall.installed.length > 0 ? 1 : 0),
        );
      }),
    );
  });
});

describe("mergeEffectWarnings", () => {
  it("gives a version that did not bump its own warning", () => {
    expect(
      mergeEffectWarnings({
        versionBump: { bumped: [], problems: ["tasks-plus already at 0.2.0"] },
        reinstall: noReinstall,
      }),
    ).toEqual([
      {
        tone: "warning",
        title: "Version not bumped: tasks-plus already at 0.2.0",
        details: [],
        link: null,
      },
    ]);
  });

  it("gives a plugin that did not reinstall its own warning", () => {
    expect(
      mergeEffectWarnings({
        versionBump: noBump,
        reinstall: reinstallOf({ problems: ["projects: build failed"] }),
      }),
    ).toEqual([
      {
        tone: "warning",
        title: "Plugin not reinstalled: projects: build failed",
        details: [],
        link: null,
      },
    ]);
  });

  it("loses no problem, however many there are", () => {
    fc.assert(
      fc.property(arbBump, arbReinstall, (versionBump, reinstall) => {
        expect(mergeEffectWarnings({ versionBump, reinstall }).length).toBe(
          versionBump.problems.length + reinstall.problems.length + reinstall.repoints.length,
        );
      }),
    );
  });

  it("a plugin installed afresh is a detail line of its own", () => {
    expect(
      mergeEffectDetails({ versionBump: noBump, reinstall: reinstallOf({ installed: ["projects"] }) }),
    ).toEqual(["Installed projects"]);
  });

  it("a pending repoint becomes a prompt: the trade spelled out, two buttons, the request to run", () => {
    expect(mergeEffectWarnings({ versionBump: noBump, reinstall: reinstallOf({ repoints: [repoint] }) })).toEqual([
      repointPrompt(repoint),
    ]);
    expect(repointPrompt(repoint)).toEqual({
      tone: "warning",
      title: "Repoint tasks-plus to git?",
      details: [
        "Installed from path:/Users/x/worktrees/bb-plugins/bb-plugin-tasks-plus",
        "Would be removed and installed from git:https://github.com/e0068/bb-plugins.git@main",
        "Removing deletes the plugin's settings, secrets and schedules",
      ],
      link: null,
      prompt: { confirmLabel: "Repoint to git", cancelLabel: "Keep as is", repoint },
    });
  });

  it("a prompt never leaks into the success line — it is the user's decision, not the merge's news", () => {
    fc.assert(
      fc.property(arbReinstall, (reinstall) => {
        const details = mergeEffectDetails({ versionBump: noBump, reinstall });
        expect(details.some((line) => line.includes("Repoint"))).toBe(false);
      }),
    );
  });

  it("a confirmed repoint answers with a success naming the plugin", () => {
    expect(repointedNotification("tasks-plus")).toEqual({
      tone: "success",
      title: "Repointed tasks-plus to git",
      details: [],
      link: null,
    });
  });
});

describe("taskWarnings", () => {
  it("names what was done, which task, and why it stayed behind", () => {
    expect(
      taskWarnings({
        failedTasks: [{ key: "BP-1", reason: "file is gone" }],
        did: "Opened the PR",
        transition: "in review",
      }),
    ).toEqual([
      {
        tone: "warning",
        title: "Opened the PR, but could not mark BP-1 in review: file is gone",
        details: [],
        link: null,
      },
    ]);
  });

  it("gives every failed task its own warning", () => {
    fc.assert(
      fc.property(fc.array(arbTask), (failedTasks) => {
        expect(taskWarnings({ failedTasks, did: "Merged", transition: "done" }).length).toBe(
          failedTasks.length,
        );
      }),
    );
  });
});

describe("cliWarnings", () => {
  it("is loud about a bb CLI that could not run at all", () => {
    expect(cliWarnings("not found on PATH")).toEqual([
      {
        tone: "warning",
        title: "Linked tasks were left untouched — the bb CLI could not run: not found on PATH",
        details: [],
        link: null,
      },
    ]);
  });

  it("says nothing when the CLI ran", () => {
    expect(cliWarnings(null)).toEqual([]);
  });
});

describe("errorNotification", () => {
  it("prefers the error's own message", () => {
    expect(errorNotification(new Error("origin is not on github.com"), "Could not merge.")).toEqual({
      tone: "error",
      title: "origin is not on github.com",
      details: [],
      link: null,
    });
  });

  it("falls back for a rejection that is not an Error", () => {
    expect(errorNotification("boom", "Could not merge.").title).toBe("Could not merge.");
  });
});

describe("mergeErrorNotification", () => {
  const thread = { id: "thr_abc", label: "Open thread" };
  const pr = { number: 275, url: "https://github.com/e0068/bb-plugins/pull/275" };

  it("names the PR, links out to it, and jumps back to the thread", () => {
    const notif = mergeErrorNotification(
      new Error("HTTP 409: Pull request is not currently mergeable"),
      "Could not merge the Pull Request.",
      pr,
      thread,
    );
    expect(notif).toEqual({
      tone: "error",
      title: "Pull Request #275: HTTP 409: Pull request is not currently mergeable",
      details: [],
      link: { label: "View on GitHub", url: "https://github.com/e0068/bb-plugins/pull/275" },
      threadLink: { label: "Open thread", threadId: "thr_abc" },
    });
  });

  it("omits the PR prefix and the link when the state never resolved the PR", () => {
    const notif = mergeErrorNotification(
      new Error("boom"),
      "Could not merge the Pull Request.",
      { number: null, url: null },
      thread,
    );
    expect(notif.title).toBe("boom");
    expect(notif.link).toBeNull();
    expect(notif.threadLink).toEqual({ label: "Open thread", threadId: "thr_abc" });
  });

  it("keeps the link when a URL is known without a number", () => {
    const notif = mergeErrorNotification(
      new Error("boom"),
      "Could not merge the Pull Request.",
      { number: null, url: "https://github.com/e0068/bb-plugins/pull/275" },
      thread,
    );
    expect(notif.title).toBe("boom");
    expect(notif.link).toEqual({
      label: "View on GitHub",
      url: "https://github.com/e0068/bb-plugins/pull/275",
    });
  });

  it("falls back to the fallback title when the rejection is not an Error", () => {
    const notif = mergeErrorNotification("boom", "Could not merge the Pull Request.", pr, thread);
    expect(notif.title).toBe("Pull Request #275: Could not merge the Pull Request.");
  });
});

describe("prOpenedNotifications", () => {
  const opened = {
    number: 276,
    url: "https://github.com/e0068/bb-plugins/pull/276",
    inReviewTasks: ["BP-195"],
    failedTasks: [],
    taskCliError: null,
    versionBump: { bumped: [], problems: [] },
  };

  it("names the PR number and links to it", () => {
    expect(prOpenedNotifications(opened)).toEqual([
      {
        tone: "success",
        title: "Pull Request #276 opened",
        details: ["Marked BP-195 in review"],
        link: { label: "View on GitHub", url: "https://github.com/e0068/bb-plugins/pull/276" },
      },
    ]);
  });

  it("says nothing about tasks when the thread had none", () => {
    expect(prOpenedNotifications({ ...opened, inReviewTasks: [] })[0]?.details).toEqual([]);
  });

  it("names the versions the bump raised right after opening", () => {
    const withBump = { ...opened, versionBump: { bumped: [{ root: "bb-plugin-flow", to: "0.4.2" }], problems: [] } };
    expect(prOpenedNotifications(withBump)[0]?.details).toEqual(["Marked BP-195 in review", "Bumped bb-plugin-flow to 0.4.2"]);
  });

  it("a bump that did not go through is a warning of its own, not silence", () => {
    const refused = { ...opened, versionBump: { bumped: [], problems: ["could not catch the branch up with main (HTTP 409)"] } };
    expect(prOpenedNotifications(refused).filter((n) => n.tone === "warning")).toEqual([
      { tone: "warning", title: "Version not bumped: could not catch the branch up with main (HTTP 409)", details: [], link: null },
    ]);
  });
});

describe("prOpenedAndMergedNotifications", () => {
  const thread = { id: "thr_abc", label: "Open thread" };
  const base = {
    number: 276,
    url: "https://github.com/e0068/bb-plugins/pull/276",
    versionBump: { bumped: [{ root: "tasks-plus", to: "0.2.0" }], problems: [] },
    reinstall: reinstallOf({ reinstalled: ["tasks-plus"] }),
    inReviewTasks: ["BP-195"],
    failedTasks: [],
    taskCliError: null,
    failure: null,
  };

  it("folds the tasks and every merge side effect into the one success", () => {
    expect(prOpenedAndMergedNotifications(base, thread)).toEqual([
      {
        tone: "success",
        title: "Pull Request #276 opened and merged",
        details: ["Marked BP-195 in review", "Bumped tasks-plus to 0.2.0", "Reinstalled tasks-plus"],
        link: { label: "View on GitHub", url: "https://github.com/e0068/bb-plugins/pull/276" },
      },
    ]);
  });

  it("a merge that failed after the PR was opened: the PR is still the good news, linked", () => {
    const built = prOpenedAndMergedNotifications(
      {
        ...base,
        versionBump: noBump,
        reinstall: noReinstall,
        failure: { step: "merge", message: "HTTP 409: Pull request is not currently mergeable" },
      },
      thread,
    );
    expect(built[0]).toEqual({
      tone: "success",
      title: "Pull Request #276 opened",
      details: ["Marked BP-195 in review"],
      link: { label: "View on GitHub", url: "https://github.com/e0068/bb-plugins/pull/276" },
    });
    expect(built[1]).toEqual({
      tone: "error",
      title:
        "Pull Request #276 opened, but the merge failed: HTTP 409: Pull request is not currently mergeable",
      details: [],
      link: { label: "View on GitHub", url: "https://github.com/e0068/bb-plugins/pull/276" },
      threadLink: { label: "Open thread", threadId: "thr_abc" },
    });
  });

  it("a task warning after a failed merge claims only what was done", () => {
    const built = prOpenedAndMergedNotifications(
      {
        ...base,
        inReviewTasks: [],
        failedTasks: [{ key: "BP-195", reason: "no such status" }],
        failure: { step: "merge", message: "boom" },
      },
      thread,
    );
    expect(built.some((notification) => notification.title.startsWith("Opened the PR, but"))).toBe(true);
  });
});

describe("prOpenedMergedArchivedNotifications", () => {
  const thread = { id: "thr_abc", label: "Open thread" };
  const base = {
    number: 276,
    url: "https://github.com/e0068/bb-plugins/pull/276",
    versionBump: noBump,
    reinstall: noReinstall,
    archived: true,
    doneTasks: ["BP-195"],
    failedTasks: [],
    taskCliError: null,
    failure: null,
  };

  it("adds what archiving did to the same success", () => {
    expect(prOpenedMergedArchivedNotifications(base, thread)[0]).toEqual({
      tone: "success",
      title: "Pull Request #276 opened and merged",
      details: ["Marked BP-195 done and archived the thread"],
      link: { label: "View on GitHub", url: "https://github.com/e0068/bb-plugins/pull/276" },
    });
  });

  it("still reports the archive when no task was linked", () => {
    expect(prOpenedMergedArchivedNotifications({ ...base, doneTasks: [] }, thread)[0]?.details).toEqual([
      "Thread archived",
    ]);
  });

  it("says nothing about archiving that did not happen", () => {
    expect(
      prOpenedMergedArchivedNotifications({ ...base, archived: false, doneTasks: [] }, thread)[0]?.details,
    ).toEqual([]);
  });

  it("an archive that failed after the merge: the merged PR is the good news, the thread is the way back", () => {
    const built = prOpenedMergedArchivedNotifications(
      {
        ...base,
        archived: false,
        doneTasks: [],
        failure: { step: "archive", message: "the thread is already archived" },
      },
      thread,
    );
    expect(built[0]).toEqual({
      tone: "success",
      title: "Pull Request #276 opened and merged",
      details: [],
      link: { label: "View on GitHub", url: "https://github.com/e0068/bb-plugins/pull/276" },
    });
    expect(built[1]).toEqual({
      tone: "error",
      title:
        "Pull Request #276 opened and merged, but the thread was not archived: the thread is already archived",
      details: [],
      link: { label: "View on GitHub", url: "https://github.com/e0068/bb-plugins/pull/276" },
      threadLink: { label: "Open thread", threadId: "thr_abc" },
    });
  });

  it("an archive that failed still reports the tasks it did mark done", () => {
    const built = prOpenedMergedArchivedNotifications(
      { ...base, archived: false, failure: { step: "archive", message: "boom" } },
      thread,
    );
    expect(built[0]?.details).toEqual(["Marked BP-195 done"]);
  });

  it("a task warning after a failed archive never claims the thread was archived", () => {
    const built = prOpenedMergedArchivedNotifications(
      {
        ...base,
        archived: false,
        doneTasks: [],
        failedTasks: [{ key: "BP-195", reason: "board offline" }],
        failure: { step: "archive", message: "boom" },
      },
      thread,
    );
    const warning = built.find((notification) => notification.tone === "warning");
    expect(warning?.title).toBe(
      "Opened and merged the PR, but could not mark BP-195 done: board offline",
    );
  });

  it("a task warning after a failed merge claims only the PR", () => {
    const built = prOpenedMergedArchivedNotifications(
      {
        ...base,
        archived: false,
        doneTasks: [],
        failedTasks: [{ key: "BP-195", reason: "board offline" }],
        failure: { step: "merge", message: "boom" },
      },
      thread,
    );
    const warning = built.find((notification) => notification.tone === "warning");
    expect(warning?.title).toBe("Opened the PR, but could not mark BP-195 done: board offline");
  });

  it("a merge that failed says so, and never claims the PR was merged", () => {
    const built = prOpenedMergedArchivedNotifications(
      { ...base, archived: false, doneTasks: [], failure: { step: "merge", message: "boom" } },
      thread,
    );
    expect(built[0]?.title).toBe("Pull Request #276 opened");
    expect(built[1]?.title).toBe("Pull Request #276 opened, but the merge failed: boom");
  });
});

describe("prMergedNotifications", () => {
  it("replaces the three separate toasts of a merge with one linked notification", () => {
    expect(
      prMergedNotifications({
        pr: { number: 276, url: "https://github.com/e0068/bb-plugins/pull/276" },
        versionBump: noBump,
        reinstall: reinstallOf({ reinstalled: ["tasks-plus"] }),
      }),
    ).toEqual([
      {
        tone: "success",
        title: "Pull Request #276 merged",
        details: ["Reinstalled tasks-plus"],
        link: { label: "View on GitHub", url: "https://github.com/e0068/bb-plugins/pull/276" },
      },
    ]);
  });

  it("drops the number from the title when the state never resolved one", () => {
    expect(
      prMergedNotifications({
        pr: { number: null, url: null },
        versionBump: noBump,
        reinstall: noReinstall,
      })[0],
    ).toEqual({ tone: "success", title: "Pull Request merged", details: [], link: null });
  });

  it("links whenever the state resolved a URL, with or without a number", () => {
    fc.assert(
      fc.property(
        fc.option(fc.integer(), { nil: null }),
        fc.option(fc.webUrl(), { nil: null }),
        (number, url) => {
          const [merged] = prMergedNotifications({
            pr: { number, url },
            versionBump: noBump,
            reinstall: noReinstall,
          });
          expect(merged?.link === null).toBe(url === null);
        },
      ),
    );
  });
});

describe("prMergedArchivedNotifications", () => {
  const thread = { id: "thr_abc", label: "Open thread" };
  const base = {
    pr: { number: 281, url: "https://github.com/e0068/bb-plugins/pull/281" },
    versionBump: noBump,
    reinstall: noReinstall,
    archived: true,
    doneTasks: ["BP-194"],
    failedTasks: [],
    taskCliError: null,
    failure: null,
  };

  it("one linked notification: the merge, with what it did and the archive as detail lines", () => {
    expect(prMergedArchivedNotifications(base, thread)).toEqual([
      {
        tone: "success",
        title: "Pull Request #281 merged",
        details: ["Marked BP-194 done and archived the thread"],
        link: { label: "View on GitHub", url: "https://github.com/e0068/bb-plugins/pull/281" },
      },
    ]);
  });

  it("reads exactly like the plain merge when the state never resolved the PR", () => {
    const [merged] = prMergedArchivedNotifications({ ...base, pr: { number: null, url: null } }, thread);
    expect(merged?.title).toBe("Pull Request merged");
    expect(merged?.link).toBeNull();
  });

  it("a failed done-transition is its own warning, never folded into the success", () => {
    const failed = { key: "BP-194", reason: "board offline" };
    const [, warning] = prMergedArchivedNotifications(
      { ...base, doneTasks: [], failedTasks: [failed] },
      thread,
    );
    expect(warning?.tone).toBe("warning");
    expect(warning?.title).toContain("BP-194");
  });

  it("an archive that failed never claims the thread was archived in a task warning", () => {
    const built = prMergedArchivedNotifications(
      {
        ...base,
        archived: false,
        doneTasks: ["BP-194"],
        failedTasks: [{ key: "BP-195", reason: "board offline" }],
        failure: { step: "archive", message: "boom" },
      },
      thread,
    );
    expect(built[0]?.details).toEqual(["Marked BP-194 done"]);
    const warning = built.find((notification) => notification.tone === "warning");
    expect(warning?.title).toBe("Merged the PR, but could not mark BP-195 done: board offline");
  });

  it("an archive that failed leaves the merge as the good news and links both ways", () => {
    const built = prMergedArchivedNotifications(
      {
        ...base,
        archived: false,
        doneTasks: [],
        failure: { step: "archive", message: "the thread is already archived" },
      },
      thread,
    );
    expect(built[0]?.title).toBe("Pull Request #281 merged");
    expect(built[1]).toEqual({
      tone: "error",
      title:
        "Pull Request #281 merged, but the thread was not archived: the thread is already archived",
      details: [],
      link: { label: "View on GitHub", url: "https://github.com/e0068/bb-plugins/pull/281" },
      threadLink: { label: "Open thread", threadId: "thr_abc" },
    });
  });
});

describe("threadArchivedNotifications", () => {
  it("names the tasks it marked done", () => {
    expect(
      threadArchivedNotifications({
        doneTasks: ["BP-195", "BP-196"],
        failedTasks: [],
        taskCliError: null,
      }),
    ).toEqual([
      {
        tone: "success",
        title: "Marked BP-195, BP-196 done and archived the thread",
        details: [],
        link: null,
      },
    ]);
  });

  it("falls back to the bare archive when no task was linked", () => {
    expect(
      threadArchivedNotifications({ doneTasks: [], failedTasks: [], taskCliError: null })[0]?.title,
    ).toBe("Thread archived");
  });
});

describe("every builder", () => {
  const thread = { id: "thr_abc", label: "Open thread" };

  it("leads with exactly one success and lets no trouble go unsaid", () => {
    fc.assert(
      fc.property(
        arbBump,
        arbReinstall,
        fc.array(arbTask),
        fc.option(fc.string(), { nil: null }),
        (versionBump, reinstall, failedTasks, taskCliError) => {
          const builds: readonly (readonly Notification[])[] = [
            prOpenedNotifications({
              number: 1,
              url: "https://example.com/pull/1",
              inReviewTasks: [],
              failedTasks,
              taskCliError,
              versionBump,
            }),
            prOpenedAndMergedNotifications(
              {
                number: 1,
                url: "https://example.com/pull/1",
                versionBump,
                reinstall,
                inReviewTasks: [],
                failedTasks,
                taskCliError,
                failure: null,
              },
              thread,
            ),
            prOpenedMergedArchivedNotifications(
              {
                number: 1,
                url: "https://example.com/pull/1",
                versionBump,
                reinstall,
                archived: true,
                doneTasks: [],
                failedTasks,
                taskCliError,
                failure: null,
              },
              thread,
            ),
            prMergedNotifications({
              pr: { number: 1, url: "https://example.com/pull/1" },
              versionBump,
              reinstall,
            }),
            threadArchivedNotifications({ doneTasks: [], failedTasks, taskCliError }),
          ];
          for (const built of builds) {
            expect(built[0]?.tone).toBe("success");
            expect(built.filter((notification) => notification.tone === "success").length).toBe(1);
          }
          const withTasks = builds.filter((built) => built !== builds[3]);
          for (const built of withTasks) {
            expect(troubles(built).length).toBeGreaterThanOrEqual(
              failedTasks.length + (taskCliError === null ? 0 : 1),
            );
          }
        },
      ),
    );
  });

  it("a chain that broke after the PR existed still leads with exactly one success", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<"merge" | "archive">("merge", "archive"),
        fc.string(),
        (step, message) => {
          const builds: readonly (readonly Notification[])[] = [
            // Only the merge can break here: this chain never archives.
            prOpenedAndMergedNotifications(
              {
                number: 1,
                url: "https://example.com/pull/1",
                versionBump: noBump,
                reinstall: noReinstall,
                inReviewTasks: [],
                failedTasks: [],
                taskCliError: null,
                failure: { step: "merge", message },
              },
              thread,
            ),
            prOpenedMergedArchivedNotifications(
              {
                number: 1,
                url: "https://example.com/pull/1",
                versionBump: noBump,
                reinstall: noReinstall,
                archived: false,
                doneTasks: [],
                failedTasks: [],
                taskCliError: null,
                failure: { step, message },
              },
              thread,
            ),
            prMergedArchivedNotifications(
              {
                pr: { number: 1, url: "https://example.com/pull/1" },
                versionBump: noBump,
                reinstall: noReinstall,
                archived: false,
                doneTasks: [],
                failedTasks: [],
                taskCliError: null,
                failure: { step: "archive", message },
              },
              thread,
            ),
          ];
          for (const built of builds) {
            expect(built.filter((notification) => notification.tone === "success").length).toBe(1);
            const failure = built.find((notification) => notification.tone === "error");
            expect(failure?.link).toEqual({
              label: "View on GitHub",
              url: "https://example.com/pull/1",
            });
            expect(failure?.threadLink).toEqual({ label: "Open thread", threadId: "thr_abc" });
          }
        },
      ),
    );
  });
});
