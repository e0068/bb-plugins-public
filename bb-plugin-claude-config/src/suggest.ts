// Layer 1 — ranking autocomplete (suggestion) candidates.
// A pure function: input is a candidate list and a query, output is a
// sorted and trimmed list.

export interface Candidate {
  value: string;
  label?: string;
}

interface DedupedCandidate {
  candidate: Candidate;
  originalIndex: number;
}

/**
 * Ranks candidates by match against the query (case-insensitive, on
 * `value` and `label`). Rank: an exact prefix (0) beats a segment prefix
 * after `/ - _ space` (1) beats an arbitrary substring match (2); no match
 * excludes the candidate. An empty query — no filtering, original order.
 * Duplicates by `value` are collapsed, the first one by original order wins.
 */
export function rankCandidates(
  candidates: Candidate[],
  query: string,
  limit: number,
): Candidate[] {
  const unique = dedupeByValue(candidates);
  const normalizedQuery = query.toLowerCase();

  if (normalizedQuery === "") {
    return unique.slice(0, limit).map((entry) => entry.candidate);
  }

  const ranked = unique
    .map((entry) => ({ entry, rank: bestRank(entry.candidate, normalizedQuery) }))
    .filter(
      (item): item is { entry: DedupedCandidate; rank: number } =>
        item.rank !== null,
    );

  ranked.sort(
    (a, b) => a.rank - b.rank || a.entry.originalIndex - b.entry.originalIndex,
  );
  return ranked.slice(0, limit).map((item) => item.entry.candidate);
}

function dedupeByValue(candidates: Candidate[]): DedupedCandidate[] {
  const seen = new Set<string>();
  const result: DedupedCandidate[] = [];
  candidates.forEach((candidate, originalIndex) => {
    if (seen.has(candidate.value)) return;
    seen.add(candidate.value);
    result.push({ candidate, originalIndex });
  });
  return result;
}

/** The best (lowest) rank for a candidate across its value and label fields. */
function bestRank(candidate: Candidate, query: string): number | null {
  const fields = [candidate.value, candidate.label].filter(
    (field): field is string => typeof field === "string",
  );
  let best: number | null = null;
  for (const field of fields) {
    const rank = fieldRank(field.toLowerCase(), query);
    if (rank !== null && (best === null || rank < best)) best = rank;
  }
  return best;
}

function fieldRank(field: string, query: string): number | null {
  if (field.startsWith(query)) return 0;
  if (hasSegmentPrefix(field, query)) return 1;
  if (field.includes(query)) return 2;
  return null;
}

/** Match at the start of a segment split by `/ - _ space`. */
function hasSegmentPrefix(field: string, query: string): boolean {
  return field.split(/[/\-_ ]+/).some((segment) => segment.startsWith(query));
}
