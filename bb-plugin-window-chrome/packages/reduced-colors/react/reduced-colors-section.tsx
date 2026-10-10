// Shell — the Reduced Colors block on a plugin's settings page: the switch,
// a row per theme with two pickers, their hex fields and a preview of the
// steps, and Swap. bb's own settings have no colour field, so the block is
// a `settingsSection` of its own (docs/decisions/reduced-colors-pair-per-theme.md).
//
// Styled inline with bb's theme variables, not Tailwind classes: bb runs
// Tailwind over the plugin's own folder only, and a class used nowhere but
// in packages/ never reaches the plugin's app.css.
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { isHexColor, rampColors } from "../core/ramp";
import { parseReducedColors, type ColorMode, type ColorPair, type ReducedColors } from "../core/settings";

export interface ReducedColorsSectionProps {
  /** Reads the stored setting — raw, the section parses it. */
  load: () => Promise<unknown>;
  /** Stores the whole setting; called once the edits settle. */
  save: (value: ReducedColors) => Promise<unknown>;
}

/** How long edits must pause before they are stored — a dragged picker fires on every pixel. */
const SAVE_DELAY_MS = 300;
const PREVIEW_STEPS = 8;
const THEMES: readonly { mode: ColorMode; label: string }[] = [
  { mode: "light", label: "Light theme" },
  { mode: "dark", label: "Dark theme" },
];
type End = keyof ColorPair;

const text: CSSProperties = { fontSize: 13, color: "var(--foreground)" };
const hint: CSSProperties = { fontSize: 12, color: "var(--muted-foreground)" };
const row: CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: "1px solid var(--border)" };
const control: CSSProperties = { height: 28, borderRadius: 6, border: "1px solid var(--input)", background: "transparent" };

/** What the section holds: still asking, could not read the stored value, or the value being edited. */
type Loaded = { readonly kind: "loading" } | { readonly kind: "failed" } | { readonly kind: "ready"; readonly value: ReducedColors };

export function ReducedColorsSection({ load, save }: ReducedColorsSectionProps) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [saveFailed, setSaveFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The edit waiting out SAVE_DELAY_MS — sent at once if the section goes away first.
  const unsaved = useRef<ReducedColors | null>(null);
  const saveLatest = useRef(save);
  saveLatest.current = save;
  const loadOnMount = useRef(load);
  const mounted = useRef(true);

  const flush = () => {
    clearTimeout(timer.current);
    const value = unsaved.current;
    if (value === null) return;
    unsaved.current = null;
    saveLatest.current(value).then(
      () => mounted.current && setSaveFailed(false),
      () => mounted.current && setSaveFailed(true),
    );
  };

  useEffect(() => {
    mounted.current = true;
    loadOnMount.current().then(
      (raw) => mounted.current && setLoaded({ kind: "ready", value: parseReducedColors(raw) }),
      // Defaults shown as if stored would overwrite the owner's pairs on the first edit.
      () => mounted.current && setLoaded({ kind: "failed" }),
    );
    return () => {
      mounted.current = false;
      flush();
    };
  }, []);

  switch (loaded.kind) {
    case "loading":
      return <p style={hint}>Loading…</p>;
    case "failed":
      return (
        <p role="alert" style={{ ...hint, color: "var(--destructive)" }}>
          Could not load Reduced Colors. Reopen the settings to try again.
        </p>
      );
    case "ready":
      break;
  }
  const value = loaded.value;

  const commit = (next: ReducedColors) => {
    setLoaded({ kind: "ready", value: next });
    unsaved.current = next;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  };
  const setEnd = (mode: ColorMode, end: End, color: string) => commit({ ...value, [mode]: { ...value[mode], [end]: color } });
  const swap = (mode: ColorMode) => commit({ ...value, [mode]: { low: value[mode].high, high: value[mode].low } });

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ ...row, borderTop: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={text}>Use Reduced Colors</div>
          <div style={hint}>Red for errors and canceled tasks stays red.</div>
        </div>
        <Switch checked={value.enabled} label="Use Reduced Colors" onChange={(enabled) => commit({ ...value, enabled })} />
      </div>
      {saveFailed && (
        <p role="alert" style={{ ...hint, color: "var(--destructive)", paddingBottom: 8 }}>
          Could not save Reduced Colors — the last change is not stored.
        </p>
      )}
      {THEMES.map(({ mode, label }) => (
        <div key={mode} style={{ ...row, opacity: value.enabled ? 1 : 0.5 }}>
          <div style={{ ...text, width: 96, flexShrink: 0 }}>{label}</div>
          <ColorField label={`${label} low colour`} color={value[mode].low} onChange={(color) => setEnd(mode, "low", color)} />
          <div style={{ display: "flex", gap: 2, flex: 1, minWidth: 48, height: 16 }} aria-hidden>
            {rampColors(value[mode].low, value[mode].high, PREVIEW_STEPS).map((color, index) => (
              <span key={index} style={{ flex: 1, borderRadius: 2, background: color }} />
            ))}
          </div>
          <ColorField label={`${label} high colour`} color={value[mode].high} onChange={(color) => setEnd(mode, "high", color)} />
          <button
            type="button"
            aria-label={`Swap ${label.toLowerCase()} colours`}
            onClick={() => swap(mode)}
            style={{ ...control, ...text, fontSize: 12, padding: "0 10px", cursor: "pointer" }}
          >
            Swap
          </button>
        </div>
      ))}
    </div>
  );
}

function Switch({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={{
        position: "relative",
        width: 32,
        height: 18,
        flexShrink: 0,
        borderRadius: 9,
        border: 0,
        cursor: "pointer",
        background: checked ? "var(--foreground)" : "var(--input)",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 16 : 2,
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: "var(--background)",
          transition: "left .15s",
        }}
      />
    </button>
  );
}

/**
 * A picker swatch and a hex field over one colour. The field keeps what is
 * typed even while it is not yet a colour — the stored value only follows
 * once it is — and resyncs when the colour changes from outside (Swap).
 */
function ColorField({ label, color, onChange }: { label: string; color: string; onChange: (color: string) => void }) {
  const [draft, setDraft] = useState(color);
  useEffect(() => setDraft(color), [color]);
  const valid = isHexColor(draft);
  const type = (next: string) => {
    setDraft(next);
    if (isHexColor(next)) onChange(next);
  };
  // `<input type="color">` takes #rrggbb only; a one-step ramp is the colour normalised.
  const [pickerValue] = rampColors(color, color, 1);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <label style={{ ...control, position: "relative", width: 28, flexShrink: 0, overflow: "hidden", background: color }}>
        <input
          type="color"
          aria-label={`${label} picker`}
          value={pickerValue}
          onChange={(event) => type(event.target.value)}
          style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
        />
      </label>
      <input
        type="text"
        aria-label={label}
        aria-invalid={!valid}
        spellCheck={false}
        value={draft}
        onChange={(event) => type(event.target.value.trim())}
        style={{
          ...control,
          ...text,
          width: 84,
          padding: "0 8px",
          fontFamily: "ui-monospace, monospace",
          borderColor: valid ? "var(--input)" : "var(--destructive)",
        }}
      />
    </div>
  );
}
