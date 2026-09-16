// Layer 1 — pure decision, zero effects.
//
// bb sometimes marks an environment "retiring" while a thread on it is still
// alive (an idle-runtime release mis-triggers the same cleanup path used when
// a thread is actually done) — the environment then sits one step from being
// destroyed and the git-dependent header actions (Commit, PR, Merge) hide.
// The Wake Up button is the visible half of the fix: it shows up exactly when
// bb itself reports the environment as winding down.

export type EnvironmentStatus =
  | "destroyed"
  | "destroying"
  | "error"
  | "provisioning"
  | "ready"
  | "retiring";

export function decideWakeUpVisible(status: EnvironmentStatus): boolean {
  return status === "retiring";
}

/**
 * Whether bb will answer git questions about this environment at all. Its
 * `environments.status` and `environments.pullRequest` routes both go through
 * `requireReadyEnvironment`, which THROWS for anything but `ready` — so any
 * other status means the plugin has to measure with local git instead of
 * reading the refusal as a negative answer.
 *
 * Deliberately an exact negation of `ready` rather than a list of "bad"
 * statuses: a status added on bb's side must fall on the safe side here
 * automatically, the same way `requireReadyEnvironment` treats it.
 */
export function bbReportsGitFacts(status: EnvironmentStatus): boolean {
  return status === "ready";
}
