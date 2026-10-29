// Shell — the Chart Colors block on the plugin's settings page: one choice out
// of three schemes, and under Reduced Colors the two-colour gradient pickers of
// packages/reduced-colors. bb's declared settings have no colour field and no
// choice with a note under each option, so the block is a `settingsSection` of
// its own, styled inline with bb's theme variables like the package's section.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ReducedColorsSection } from "@bb-plugins/reduced-colors";
import { useHostColorMode } from "@bb-plugins/code-editor/use-host-color-mode";
import { CHART_COLOR_SCHEMES, modelColor, parseChartColorScheme, type ChartColorScheme } from "../src/core";

export interface ChartColorsSettingsProps {
  loadScheme: () => Promise<unknown>;
  saveScheme: (scheme: ChartColorScheme) => Promise<unknown>;
  loadReducedColors: () => Promise<unknown>;
  saveReducedColors: Parameters<typeof ReducedColorsSection>[0]["save"];
}

const MODEL_EXAMPLES = ["claude-fable-5-1", "claude-opus-4-8", "claude-sonnet-4", "claude-haiku-4-5"] as const;

const text: CSSProperties = { fontSize: 13, color: "var(--foreground)" };
const hint: CSSProperties = { fontSize: 12, color: "var(--muted-foreground)" };
const row: CSSProperties = { display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0", borderTop: "1px solid var(--border)", cursor: "pointer" };

/** What the block holds: still asking, or the scheme in force (an unreadable stored one reads as the palette, like in the charts). */
type Loaded = { readonly kind: "loading" } | { readonly kind: "ready"; readonly scheme: ChartColorScheme };

export function ChartColorsSettings({ loadScheme, saveScheme, loadReducedColors, saveReducedColors }: ChartColorsSettingsProps) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    let live = true;
    loadScheme().then(
      (raw) => live && setLoaded({ kind: "ready", scheme: parseChartColorScheme(raw, false) }),
      () => live && setLoaded({ kind: "ready", scheme: "palette" }),
    );
    return () => {
      live = false;
    };
    // Once per mount: the callers pass inline arrows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loaded.kind === "loading") return <p style={hint}>Loading…</p>;

  // The scheme shown follows the save, not the click: the gradient section below
  // loads its value on mount and must find the switch already stored.
  const choose = (scheme: ChartColorScheme) => {
    saveScheme(scheme).then(
      () => {
        setSaveFailed(false);
        setLoaded({ kind: "ready", scheme });
      },
      () => setSaveFailed(true),
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div role="radiogroup" aria-label="Chart colors">
        <Option scheme="palette" title="Palette" note="Each agent gets the next colour of a fixed palette." current={loaded.scheme} onChoose={choose} />
        <Option
          scheme="model"
          title="By model"
          note="Claude agents are coloured by the model they ran on; agents of other providers keep the palette. A colour picked in the legend wins."
          current={loaded.scheme}
          onChoose={choose}
          extra={<ModelSwatches />}
        />
        <Option
          scheme="reduced"
          title="Reduced Colors"
          note="All agents share a gradient of two colours. Red for errors and canceled tasks stays red."
          current={loaded.scheme}
          onChoose={choose}
        />
      </div>
      {saveFailed && (
        <p role="alert" style={{ ...hint, color: "var(--destructive)", paddingBottom: 8 }}>
          Could not save the scheme — the last choice is not stored.
        </p>
      )}
      {loaded.scheme === "reduced" && <ReducedColorsSection hideSwitch load={loadReducedColors} save={saveReducedColors} />}
    </div>
  );
}

function Option({
  scheme,
  title,
  note,
  current,
  onChoose,
  extra,
}: {
  scheme: ChartColorScheme;
  title: string;
  note: string;
  current: ChartColorScheme;
  onChoose: (scheme: ChartColorScheme) => void;
  extra?: ReactNode;
}) {
  const index = CHART_COLOR_SCHEMES.indexOf(scheme);
  return (
    <label style={{ ...row, borderTop: index === 0 ? 0 : row.borderTop }}>
      <input type="radio" name="chart-color-scheme" checked={current === scheme} onChange={() => onChoose(scheme)} style={{ marginTop: 3 }} />
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={text}>{title}</span>
        <span style={hint}>{note}</span>
        {extra}
      </span>
    </label>
  );
}

/** The model table at a glance, in the colours of the theme the owner is looking at. */
function ModelSwatches() {
  const theme = useHostColorMode();
  return (
    <span style={{ display: "flex", gap: 10, paddingTop: 4 }} aria-hidden>
      {MODEL_EXAMPLES.map((model) => (
        <span key={model} style={{ ...hint, display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: modelColor(model, theme), border: "1px solid var(--border)" }} />
          {model.split("-")[1]}
        </span>
      ))}
    </span>
  );
}
