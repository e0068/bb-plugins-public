// Layer 4 — over the footer items: the "Ring" section of the plugin's settings: the five footer rings
// as they look now, and under "Fine-tune ring" a slider per dimension. A moving
// slider redraws every ring at once, in the footer too; the value is stored
// when the slider is let go. No SDK import: the app hands in the two calls.
import { useState } from "react";
import { Button } from "../components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/ui/collapsible";
import { Slider } from "../components/ui/slider";
import { getRingStyle, publishRingStyle, ringIcon, useRingStyle } from "./footer-items";
import { DIM_FIELDS, type DimField, type DimGroup, type RingDims } from "./ring-style";
import { FOOTER_RINGS } from "./usage-model";

const PREVIEW_ICONS = FOOTER_RINGS.map((ring) => ({ id: ring.id, label: ring.label, Icon: ringIcon(ring) }));

const GROUP_TITLE: Record<DimGroup, string> = {
  rings: "Rings",
  center: "Logo in the center",
  corner: "Logo in the corner",
};

const SAVE_FAILED = "Couldn't save — the rings go back to the stored look on the next refresh.";

export interface RingSettingsProps {
  /** Store the dimensions that changed; answers the whole stored record. */
  save(patch: Partial<RingDims>): Promise<RingDims>;
  reset(): Promise<RingDims>;
}

const withDims = (dims: RingDims) => publishRingStyle({ ...getRingStyle(), dims });

/** The rings on footer-sized buttons, drawn by the same icons the footer shows. */
function Preview({ size }: { size: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {PREVIEW_ICONS.map(({ id, label, Icon }) => (
        <div key={id} title={label} className="flex size-8 items-center justify-center rounded-md hover:bg-sidebar-accent" data-ring-preview="">
          <span className="inline-flex" style={{ width: size, height: size }}>
            <Icon />
          </span>
        </div>
      ))}
    </div>
  );
}

function DimSlider({ field, value, onMove, onCommit }: { field: DimField; value: number; onMove(value: number): void; onCommit(value: number): void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span>{field.label}</span>
        <span className="tabular-nums text-muted-foreground">
          {value} {field.unit}
        </span>
      </div>
      <Slider min={field.min} max={field.max} step={field.step} value={[value]} onValueChange={([next]) => onMove(next!)} onValueCommit={([next]) => onCommit(next!)} />
    </div>
  );
}

export function RingSettings({ save, reset }: RingSettingsProps) {
  const { logo, dims } = useRingStyle();
  const [failed, setFailed] = useState(false);
  const store = (stored: Promise<RingDims>) =>
    stored.then(
      (next) => {
        setFailed(false);
        withDims(next);
      },
      () => setFailed(true),
    );
  const groups: readonly DimGroup[] = ["rings", logo];
  const move = (key: keyof RingDims, value: number) => withDims({ ...getRingStyle().dims, [key]: value });
  const commit = (key: keyof RingDims, value: number) => void store(save({ [key]: value }));

  return (
    <div className="flex flex-col gap-3">
      <Preview size={dims.size} />
      <Collapsible className="flex flex-col gap-4">
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="self-start">
            Fine-tune ring
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-5">
          {groups.map((group) => (
            <section key={group} className="flex flex-col gap-3">
              <h4 className="text-sm font-medium">{GROUP_TITLE[group]}</h4>
              {DIM_FIELDS.filter((field) => field.group === group).map((field) => (
                <DimSlider
                  key={field.key}
                  field={field}
                  value={dims[field.key]}
                  onMove={(value) => move(field.key, value)}
                  onCommit={(value) => commit(field.key, value)}
                />
              ))}
            </section>
          ))}
          {failed && <p className="text-sm text-destructive">{SAVE_FAILED}</p>}
          <Button variant="outline" size="sm" className="self-start" onClick={() => void store(reset())}>
            Reset to defaults
          </Button>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
