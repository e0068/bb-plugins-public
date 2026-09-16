// Layer 1 (core) — whether a merging RPC may schedule the multi-second
// catch-up republish burst after it returns.
//
// A merge that touches this plugin itself hands back a pending self-update
// (see src/wiring/plugin-reinstall.ts). Applying it makes bb dispose this
// plugin's context, and any catch-up timer that outlives the dispose calls
// bb.realtime.publish on a stale handle — the "used a stale API handle" toast.
// bb.onDispose does not reliably cancel those timers on the self-update path
// (the dispose is forced past in-flight invocations), so the burst must never
// be scheduled in the first place. Such a merge nudges the front end once on
// the still-live handle and lets the reloaded instance's subscriptions carry
// the rest.
export function schedulesCatchupBurst(reinstall: {
  readonly pendingSelfUpdate: string | null;
}): boolean {
  return reinstall.pendingSelfUpdate === null;
}
