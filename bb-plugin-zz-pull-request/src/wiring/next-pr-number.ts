// Layer 3 (shell) — best-effort preview of the number GitHub will assign a
// new PR, for display on the button before the click. Uses the same
// CreatePrPorts effect port as create-pr.ts (send to the GitHub REST API);
// the parsing itself is pure and lives in core/github-requests.ts.
import { latestIssueRequest, parseNextPrNumber, type RepoRef } from "../core/github-requests";
import type { CreatePrPorts } from "./create-pr";

export async function fetchNextPrNumber(
  ports: CreatePrPorts,
  repo: RepoRef,
): Promise<number | null> {
  const res = await ports.send(latestIssueRequest(repo));
  if (res.status !== 200) return null;
  return parseNextPrNumber(res.data);
}
