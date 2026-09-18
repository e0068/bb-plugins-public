// The hover-preview delay, parsed out of the plugin's own settings.
//
// BB's setting descriptors only carry `string | boolean` — there is no number
// type — so the delay is declared as a bare numeric string and turned back into
// milliseconds here, at the boundary: parse, don't validate. Layer 1, no
// effects and no SDK.

/** Seconds to hover before the conversation opens; 0 turns the preview off. */
export const DEFAULT_PREVIEW_DELAY_SECONDS = 1;

/** Past this a "delay" is a typo, not a preference. */
export const MAX_PREVIEW_DELAY_SECONDS = 60;

/**
 * Milliseconds to wait before showing a row's conversation, where 0 means the
 * preview is off. The host types a setting value as `string | number | boolean`
 * — the descriptor asks for a string, but a number is what an honest host would
 * keep — so both are read. Anything unreadable — never set, blank, words, or a
 * boolean — is the default rather than off, so a broken setting never silently
 * removes the feature; an explicit negative is a deliberate "no", and is off.
 */
export function parsePreviewDelayMs(
  raw: string | number | boolean | undefined,
): number {
  const seconds =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseFloat(raw)
        : Number.NaN;
  if (!Number.isFinite(seconds)) return DEFAULT_PREVIEW_DELAY_SECONDS * 1000;
  return (
    Math.min(MAX_PREVIEW_DELAY_SECONDS, Math.max(0, seconds)) * 1000
  );
}
