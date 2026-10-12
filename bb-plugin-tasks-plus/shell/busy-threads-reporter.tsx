// Layer: shell. An invisible app overlay: tells the server which threads wait
// for their own workflow or background agents. bb's thread status reads such
// a thread idle; only the sidebar's live view sees the work, and it lives here,
// in the frontend.
import { useEffect, useMemo } from "react";
import { experimental_useSidebarThreads } from "@get-bb/plugin-sdk/app";
import { backgroundBusyThreadIds } from "@/shared/thread-activity";
import { useTasksRpc } from "./data.js";

export function BusyThreadsReporter() {
  const rpc = useTasksRpc();
  const { status, threads } = experimental_useSidebarThreads();
  // The sidebar re-renders on every row change; the server hears only a changed set.
  const key = useMemo(() => backgroundBusyThreadIds(threads).join("\n"), [threads]);
  useEffect(() => {
    // A sidebar still loading or failed lists no threads; reporting that would clear every busy one.
    if (status !== "ready") return;
    void rpc.call("reportBusyThreads", { threadIds: key === "" ? [] : key.split("\n") }).catch(() => undefined);
  }, [rpc, status, key]);
  return null;
}
