// Layer 1 — chooses a GitHub token from the available sources. Zero effects.
// Priority: explicit plugin setting (if set) → token from `gh auth token`.
// Reading gh itself is an effect, living in src/wiring/gh-token.ts.

/**
 * Returns the first non-empty token, or null if neither the setting nor gh
 * provided one. Surrounding whitespace is trimmed so a stray newline from
 * gh's output doesn't end up in the authorization header.
 */
export function chooseToken(
  settingToken: string | undefined,
  ghToken: string | null,
): string | null {
  const fromSetting = settingToken?.trim();
  if (fromSetting) return fromSetting;
  const fromGh = ghToken?.trim();
  if (fromGh) return fromGh;
  return null;
}
