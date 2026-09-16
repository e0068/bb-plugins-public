// The front end's one copy of the triggers-and-actions rules, shared by every
// header button and the settings section. Loaded once, re-read whenever the
// server publishes AUTOMATION_RULES_CHANNEL — a save from the settings page,
// another window or the agent tool — and shown optimistically on a save here.
// Until the first answer the default rules stand, so the header draws exactly
// what it drew before rules existed.
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import {
  AUTOMATION_RULES_CHANNEL,
  DEFAULT_RULES,
  normalizeRules,
  parseRules,
  type AutomationRules,
  type ClickTrigger,
} from "@/src/core/automation";
import { notificationsFor } from "@/src/core/automation-notify";
import type { Notification } from "@/src/core/notification";
import { useNotify } from "@/src/ui/notify";
import type { rpcContract } from "@/server";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

export interface AutomationRulesSnapshot {
  rules: AutomationRules;
  loaded: boolean;
  failed: boolean;
}

let snapshot: AutomationRulesSnapshot = { rules: DEFAULT_RULES, loaded: false, failed: false };
let loading: Promise<void> | null = null;
let saving: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

const publish = (next: AutomationRulesSnapshot) => {
  snapshot = next;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** One request at a time, however many buttons ask. */
const load = (rpc: Rpc): Promise<void> => {
  loading ??= rpc
    .call("automationRules", {})
    .then(
      ({ rules }) => publish({ rules: parseRules(rules), loaded: true, failed: false }),
      () => publish({ ...snapshot, failed: true }),
    )
    .finally(() => {
      loading = null;
    });
  return loading;
};

export function useAutomationRules(): AutomationRulesSnapshot & { save: (next: AutomationRules) => void } {
  const rpc = useRpc<typeof rpcContract>();
  useEffect(() => {
    if (!snapshot.loaded) void load(rpc);
  }, [rpc]);
  useRealtime(AUTOMATION_RULES_CHANNEL, () => void load(rpc));
  const current = useSyncExternalStore(subscribe, () => snapshot);
  const save = useCallback(
    (next: AutomationRules) => {
      publish({ ...snapshot, rules: normalizeRules(next) });
      saving = saving
        .then(() => rpc.call("saveAutomationRules", { rules: next }))
        .then(
          () => snapshot.failed && publish({ ...snapshot, failed: false }),
          () => publish({ ...snapshot, failed: true }),
        );
    },
    [rpc],
  );
  return { ...current, save };
}

/**
 * `useNotify` for a click: its notifications pass through the click's rules
 * (src/core/automation-notify.ts), so a kind the rules leave out is never shown.
 * The rules are read at the moment the click settles, not when it started.
 */
export function useClickNotify(): (trigger: ClickTrigger, notifications: readonly Notification[] | Notification) => void {
  const notify = useNotify();
  const { rules } = useAutomationRules();
  const latest = useRef(rules);
  latest.current = rules;
  return useCallback(
    (trigger: ClickTrigger, notifications: readonly Notification[] | Notification) =>
      notify(notificationsFor(latest.current, trigger, notifications)),
    [notify],
  );
}
