// Layer 1 — refines the host's cached PR signal with a direct GitHub
// measurement. Zero effects.
//
// The host stops polling GitHub once it decides a thread's PR is merged —
// its own SDK doc comment says so: "an open PR with pending checks
// refreshes, a merged one does not". A new PR opened on the same branch
// afterwards (the normal flow once a settled PR lets the "Pull Request"
// button reappear, see visibility.ts) never reaches the host's signal again.
// See docs/decisions/open-pr-bypass-host-terminal-signal.md.
import type { OpenPullRequest } from "./github-requests";
import type { ChecksState, Mergeability, PrState } from "./merge-readiness";
import type { PrPresence } from "./visibility";

/** The same shape the shell reads off the host and feeds into decideVisibility/decideMergeReadiness. */
export interface PrSignal {
  presence: PrPresence;
  url: string | null;
  number: number | null;
  state: PrState | null;
  checksState: ChecksState | null;
  mergeability: Mergeability | null;
}

/**
 * `open` is trusted as-is — the host is already right, asking GitHub again
 * would only repeat its own answer. Anywhere else (`absent`/`settled`/
 * `unknown`), a found live PR overrides the whole signal to that PR; finding
 * nothing never downgrades what the host said. Checks and mergeability for a
 * freshly-found PR are deliberately left `unknown` rather than guessed — a
 * lighter first cut than also teaching this plugin GitHub's Checks API (see
 * the decision record for the rejected fuller alternative). The "Merge"
 * button still renders for it, just with the `unknown` indicator until the
 * host's own signal catches up with the real checks state.
 */
export function refineWithLiveOpenPr(host: PrSignal, found: OpenPullRequest | null): PrSignal {
  if (host.presence === "open" || !found) return host;
  return {
    presence: "open",
    url: found.url,
    number: found.number,
    state: "open",
    checksState: "unknown",
    mergeability: "unknown",
  };
}

/**
 * Открытый PR этой ветки, если он уже есть, — адрес и номер. Шаг открытия PR
 * спрашивает это первым делом: повтор шага (сеть оборвалась ровно на ответе
 * GitHub, слой повторов пробует снова) не должен ни создавать второй PR, ни
 * рапортовать отказ по работе, которая уже сделана.
 *
 * Живой ответ GitHub сильнее кэша хоста в обе стороны: нашёлся PR — он и есть
 * итог шага; GitHub ответил, что открытого PR нет, — открывается новый, даже
 * если кэш всё ещё держит открытым PR прошлого цикла, иначе шаг отчитался бы
 * чужим адресом и работа уехала бы без своего PR. Кэшу верят только когда
 * спросить не вышло совсем.
 */
export function alreadyOpenPr(host: PrSignal, answer: { asked: true; pr: { url: string; number: number } | null } | { asked: false }): { url: string; number: number } | null {
  if (answer.asked) return answer.pr === null ? null : { url: answer.pr.url, number: answer.pr.number };
  return host.presence === "open" && host.url !== null && host.number !== null ? { url: host.url, number: host.number } : null;
}
