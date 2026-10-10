// Layer 3 — the one window every footer plugin draws in: a header — an
// optional leading icon, the title, a count, the plugin's actions, the way to
// its settings and the pin — over the plugin's content. The header is drawn at
// once, before the plugin has its data, so the window never opens empty.
// BB draws the footer outside the plugin's styles reach in places, and this
// package is not scanned by a plugin's Tailwind, so every style is inline, on
// BB's theme tokens.
import { useState, type CSSProperties, type ReactNode } from "react";

import { pluginSettingsPath } from "./core";
import { togglePin, useFooterItem, usePinned } from "./footer-window";

/** One action in the header: an icon button with a tooltip, a link when it has `href`. */
export interface FooterWindowAction {
  readonly id: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly onClick?: () => void;
  readonly href?: string;
  readonly pressed?: boolean;
  readonly disabled?: boolean;
}

export interface FooterWindowProps {
  /** Before the title — a provider's logo, for one. */
  readonly icon?: ReactNode;
  readonly title: ReactNode;
  /** Shown after the title, whole however long the title is: a number when above zero, or words ("3 queued"). */
  readonly count?: number | string;
  readonly actions?: readonly FooterWindowAction[];
  /** The settings and pin labels, in the plugin's language. */
  readonly labels?: { readonly settings: string; readonly pin: string; readonly unpin: string };
  readonly children?: ReactNode;
}

type Paths = ReadonlyArray<Readonly<Record<string, string>>>;

// Hugeicons stroke-rounded artwork, inlined: the package imports only react.
const PIN: Paths = [
  { d: "M3 21L8 16" },
  {
    d: "M13.2585 18.8714C9.51516 18.0215 5.97844 14.4848 5.12853 10.7415C4.99399 10.1489 4.92672 9.85266 5.12161 9.37197C5.3165 8.89129 5.55457 8.74255 6.03071 8.44509C7.10705 7.77265 8.27254 7.55888 9.48209 7.66586C11.1793 7.81598 12.0279 7.89104 12.4512 7.67048C12.8746 7.44991 13.1622 6.93417 13.7376 5.90269L14.4664 4.59604C14.9465 3.73528 15.1866 3.3049 15.7513 3.10202C16.316 2.89913 16.6558 3.02199 17.3355 3.26771C18.9249 3.84236 20.1576 5.07505 20.7323 6.66449C20.978 7.34417 21.1009 7.68401 20.898 8.2487C20.6951 8.8134 20.2647 9.05346 19.4039 9.53358L18.0672 10.2792C17.0376 10.8534 16.5229 11.1406 16.3024 11.568C16.0819 11.9955 16.162 12.8256 16.3221 14.4859C16.4399 15.7068 16.2369 16.88 15.5555 17.9697C15.2577 18.4458 15.1088 18.6839 14.6283 18.8786C14.1477 19.0733 13.8513 19.006 13.2585 18.8714Z",
  },
];
const SETTINGS: Paths = [
  {
    d: "M21.3175 7.14139L20.8239 6.28479C20.4506 5.63696 20.264 5.31305 19.9464 5.18388C19.6288 5.05472 19.2696 5.15664 18.5513 5.36048L17.3311 5.70418C16.8725 5.80994 16.3913 5.74994 15.9726 5.53479L15.6357 5.34042C15.2766 5.11043 15.0004 4.77133 14.8475 4.37274L14.5136 3.37536C14.294 2.71534 14.1842 2.38533 13.9228 2.19657C13.6615 2.00781 13.3143 2.00781 12.6199 2.00781H11.5051C10.8108 2.00781 10.4636 2.00781 10.2022 2.19657C9.94085 2.38533 9.83106 2.71534 9.61149 3.37536L9.27753 4.37274C9.12465 4.77133 8.84845 5.11043 8.48937 5.34042L8.15249 5.53479C7.73374 5.74994 7.25259 5.80994 6.79398 5.70418L5.57375 5.36048C4.85541 5.15664 4.49625 5.05472 4.17867 5.18388C3.86109 5.31305 3.67445 5.63696 3.30115 6.28479L2.80757 7.14139C2.45766 7.74864 2.2827 8.05227 2.31666 8.37549C2.35061 8.69871 2.58483 8.95918 3.05326 9.48012L4.0843 10.6328C4.3363 10.9518 4.51521 11.5078 4.51521 12.0077C4.51521 12.5078 4.33636 13.0636 4.08433 13.3827L3.05326 14.5354C2.58483 15.0564 2.35062 15.3168 2.31666 15.6401C2.2827 15.9633 2.45766 16.2669 2.80757 16.8741L3.30114 17.7307C3.67443 18.3785 3.86109 18.7025 4.17867 18.8316C4.49625 18.9608 4.85542 18.8589 5.57377 18.655L6.79394 18.3113C7.25263 18.2055 7.73387 18.2656 8.15267 18.4808L8.4895 18.6752C8.84851 18.9052 9.12464 19.2442 9.2775 19.6428L9.61149 20.6403C9.83106 21.3003 9.94085 21.6303 10.2022 21.8191C10.4636 22.0078 10.8108 22.0078 11.5051 22.0078H12.6199C13.3143 22.0078 13.6615 22.0078 13.9228 21.8191C14.1842 21.6303 14.294 21.3003 14.5136 20.6403L14.8476 19.6428C15.0004 19.2442 15.2765 18.9052 15.6356 18.6752L15.9724 18.4808C16.3912 18.2656 16.8724 18.2055 17.3311 18.3113L18.5513 18.655C19.2696 18.8589 19.6288 18.9608 19.9464 18.8316C20.264 18.7025 20.4506 18.3785 20.8239 17.7307L21.3175 16.8741C21.6674 16.2669 21.8423 15.9633 21.8084 15.6401C21.7744 15.3168 21.5402 15.0564 21.0718 14.5354L20.0407 13.3827C19.7887 13.0636 19.6098 12.5078 19.6098 12.0077C19.6098 11.5078 19.7888 10.9518 20.0407 10.6328L21.0718 9.48012C21.5402 8.95918 21.7744 8.69871 21.8084 8.37549C21.8423 8.05227 21.6674 7.74864 21.3175 7.14139Z",
  },
  { d: "M15.5195 12C15.5195 13.933 13.9525 15.5 12.0195 15.5C10.0865 15.5 8.51953 13.933 8.51953 12C8.51953 10.067 10.0865 8.5 12.0195 8.5C13.9525 8.5 15.5195 10.067 15.5195 12Z" },
];

const LABELS = { settings: "Settings", pin: "Pin", unpin: "Unpin" } as const;

/** An inlined Hugeicons glyph at the size of the header's icons; `filled` paints its shapes in the text color too. */
function Glyph({ paths, filled = false }: { paths: Paths; filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} fill="none" aria-hidden>
      {paths.map((attributes, index) => (
        <path key={index} {...attributes} fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

const HEADER: CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 1,
  display: "flex",
  alignItems: "center",
  gap: 6,
  // The sidebar's thread rows reach 8 px from its edges, titles start at 16 px, icons sit 22 px from the right:
  // the title starts with theirs and the pin, 8 px from the top and right, sits on their icons' axis.
  height: 44,
  flexShrink: 0,
  padding: "8px 8px 8px 16px",
  background: "var(--sidebar)",
};
const ICON: CSSProperties = { display: "inline-flex", flexShrink: 0, width: 16, height: 16, alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)" };
const TITLE: CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 500, color: "var(--foreground)" };
const COUNT: CSSProperties = { flexShrink: 0, fontSize: 11, fontVariantNumeric: "tabular-nums", color: "var(--muted-foreground)" };
const ACTIONS: CSSProperties = { display: "flex", alignItems: "center", gap: 2, marginLeft: "auto", flexShrink: 0 };

/** How a header button looks: `pressed` — on, on BB's pressed background; `lit` — on, the glyph in the text color with no background. */
type Look = "plain" | "pressed" | "lit";

function buttonStyle(hover: boolean, look: Look, disabled: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    padding: 0,
    border: 0,
    borderRadius: 6,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.5 : 1,
    color: look !== "plain" || (hover && !disabled) ? "var(--foreground)" : "var(--muted-foreground)",
    background: look === "pressed" ? "var(--state-active)" : hover && !disabled ? "var(--state-hover)" : "transparent",
  };
}

/**
 * A header action: the button BB draws in its own headers — ghost, 28 px, the label as a tooltip.
 * `lit` shows it pressed by its glyph alone, with no background — the pin does.
 */
export function FooterWindowButton({ label, icon, onClick, href, pressed, disabled = false, lit = false }: Omit<FooterWindowAction, "id"> & { readonly lit?: boolean }) {
  const [hover, setHover] = useState(false);
  const look: Look = !pressed ? "plain" : lit ? "lit" : "pressed";
  const common = {
    title: label,
    "aria-label": label,
    style: buttonStyle(hover, look, disabled),
    onPointerEnter: () => setHover(true),
    onPointerLeave: () => setHover(false),
  };
  return href !== undefined && !disabled ? (
    <a {...common} href={href}>
      {icon}
    </a>
  ) : (
    <button {...common} type="button" aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      {icon}
    </button>
  );
}

/** The window's header: icon, title, count, the plugin's actions, settings and the pin. */
export function FooterWindowHeader({ icon, title, count = 0, actions = [], labels = LABELS }: Omit<FooterWindowProps, "children">) {
  const item = useFooterItem();
  const pinned = usePinned(item);
  return (
    <div style={HEADER} data-footer-window-header="">
      {icon !== undefined && <span style={ICON}>{icon}</span>}
      <h2 style={{ ...TITLE, margin: 0 }}>{title}</h2>
      {(typeof count === "number" ? count > 0 : count !== "") && <span style={COUNT}>{count}</span>}
      <div style={ACTIONS}>
        {actions.map(({ id, ...action }) => (
          <FooterWindowButton key={id} {...action} />
        ))}
        {item !== null && (
          <>
            <FooterWindowButton label={labels.settings} icon={<Glyph paths={SETTINGS} />} href={pluginSettingsPath(item.pluginId)} />
            <FooterWindowButton label={pinned ? labels.unpin : labels.pin} icon={<Glyph paths={PIN} filled={pinned} />} pressed={pinned} lit onClick={() => togglePin(item)} />
          </>
        )}
      </div>
    </div>
  );
}

/** The window of a footer item: the header over the plugin's content. */
export function FooterWindow({ children, ...header }: FooterWindowProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }} data-footer-window="">
      <FooterWindowHeader {...header} />
      {children}
    </div>
  );
}
