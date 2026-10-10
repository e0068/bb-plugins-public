// Layer 4 — over the footer items: the "Limits" section of the plugin's settings — every
// limit with a switch that shows or hides it in the windows, and arrows that
// move it up or down. The windows follow a change at once; the choice is
// stored through the call the app hands in.
import { useState } from "react";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/switch";
import { publishLimits, ringIcon, useUsage } from "./footer-items";
import { DEFAULT_LIMITS, FOOTER_RINGS, moveLimit, toggleLimit, type LimitsChoice } from "./usage-model";

const RINGS = new Map(FOOTER_RINGS.map((ring) => [ring.id, { ring, Icon: ringIcon(ring) }]));

const SAVE_FAILED = "Couldn't save — the windows go back to the stored choice on the next refresh.";

// Hugeicons stroke-rounded arrow-up-01 and arrow-down-01, inlined.
const ARROW = { up: "M18 15C18 15 13.5811 9 12 9C10.4188 9 6 15 6 15", down: "M18 9C18 9 13.5811 15 12 15C10.4188 15 6 9 6 9" } as const;

function Arrow({ direction }: { direction: keyof typeof ARROW }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d={ARROW[direction]} stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface LimitsSettingsProps {
  /** Store the choice; answers it as stored. */
  save(limits: LimitsChoice): Promise<LimitsChoice>;
}

export function LimitsSettings({ save }: LimitsSettingsProps) {
  const state = useUsage();
  const [picked, setPicked] = useState<LimitsChoice | null>(null);
  const [failed, setFailed] = useState(false);
  const limits = picked ?? state?.limits ?? DEFAULT_LIMITS;
  const change = (next: LimitsChoice) => {
    setPicked(next);
    publishLimits(next);
    save(next).then(
      () => setFailed(false),
      () => setFailed(true),
    );
  };

  return (
    <div className="flex flex-col gap-1">
      {limits.map(({ id, shown }, index) => {
        const entry = RINGS.get(id);
        if (!entry) return null;
        const { ring, Icon } = entry;
        return (
          <div key={id} data-limit-row={id} className="flex items-center gap-2 text-sm">
            <Switch checked={shown} aria-label={`Show ${ring.label}`} onCheckedChange={() => change(toggleLimit(limits, id))} />
            <span className="inline-flex size-5 shrink-0">
              <Icon />
            </span>
            <span className="min-w-0 flex-1 truncate">{ring.label}</span>
            <Button variant="ghost" size="icon" className="size-7" aria-label={`Move ${ring.label} up`} disabled={index === 0} onClick={() => change(moveLimit(limits, id, -1))}>
              <Arrow direction="up" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={`Move ${ring.label} down`}
              disabled={index === limits.length - 1}
              onClick={() => change(moveLimit(limits, id, 1))}
            >
              <Arrow direction="down" />
            </Button>
          </div>
        );
      })}
      {failed && <p className="text-sm text-destructive">{SAVE_FAILED}</p>}
    </div>
  );
}
