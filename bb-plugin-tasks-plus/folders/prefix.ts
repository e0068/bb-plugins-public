const NON_ALPHANUMERIC = /[^A-Z0-9]+/g;
const LEADING_DIGITS = /^[0-9]+/;
const MAX_PREFIX_LENGTH = 10;
const FALLBACK_PREFIX = "PRJ";

/**
 * Derive a project-key prefix from a bb project's name: initials for
 * multi-word names, the first three letters otherwise (mirrors the frontend's
 * live-suggestion `derivePrefix` in views/manage/shared.tsx), then disambiguate
 * against `taken` by appending a numeric suffix. Used when "Add folder"
 * creates a new board for a bb project that has none yet — there is no user
 * typing a name to derive from interactively, so the result must already be
 * collision-free.
 */
export function deriveUniquePrefix(
  name: string,
  taken: ReadonlySet<string>,
): string {
  const words = name
    .toUpperCase()
    .replace(NON_ALPHANUMERIC, " ")
    .split(" ")
    .filter(Boolean);
  let base =
    words.length >= 2
      ? words.map((word) => word[0]).join("")
      : (words[0] ?? "").slice(0, 3);
  base = base.replace(LEADING_DIGITS, "").slice(0, MAX_PREFIX_LENGTH);
  if (base === "") base = FALLBACK_PREFIX;
  if (!taken.has(base)) return base;

  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const suffixText = String(suffix);
    const candidate = `${base.slice(0, MAX_PREFIX_LENGTH - suffixText.length)}${suffixText}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`could not derive a unique prefix from ${name}`);
}
