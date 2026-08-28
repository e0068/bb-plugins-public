// Слой 1 — ранжирование кандидатов автодополнения (саджеста).
// Чистая функция: список кандидатов и запрос на входе, отсортированный и
// урезанный список на выходе.

export interface Candidate {
  value: string;
  label?: string;
}

interface DedupedCandidate {
  candidate: Candidate;
  originalIndex: number;
}

/**
 * Ранжирует кандидатов по совпадению с запросом (регистронезависимо, по
 * `value` и `label`). Ранг: точный префикс (0) лучше префикса сегмента после
 * `/ - _ пробел` (1) лучше произвольного вхождения (2); не совпало — кандидат
 * исключается. Пустой запрос — без фильтра, в исходном порядке. Дубли по
 * `value` схлопываются, побеждает первый по исходному порядку.
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

/** Лучший (наименьший) ранг кандидата среди его полей value и label. */
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

/** Совпадение по началу сегмента, разделённого `/ - _ пробел`. */
function hasSegmentPrefix(field: string, query: string): boolean {
  return field.split(/[/\-_ ]+/).some((segment) => segment.startsWith(query));
}
