// The one place a Notification becomes a toast.
//
// Two rules live here and nowhere else, so they can't drift apart between
// thirty call sites:
//
//   1. A notification stays until the user closes it. The plugin reports
//      things that happened once and can't be replayed — which PR merged,
//      which plugin did not reinstall — and a line that fades after four
//      seconds is a line the user standing away from the screen never saw.
//   2. `openUrl` is the host's, not an anchor: the desktop app owns where an
//      external URL goes. It arrives as a function argument (from the
//      `useBbNavigate` hook) rather than an import, so the rendering rule
//      below stays independent of how BB does navigation.
import type { CSSProperties, ReactNode } from "react";
import { useCallback } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import {
  errorNotification,
  repointedNotification,
  type Notification,
  type NotificationTone,
} from "../core/notification";
import { notificationLayout, type NotificationAction } from "../core/notification-layout";
import type { PendingRepoint } from "../core/reinstall-plan";
import { Icon, type IconName } from "../../components/ui/icon";
import type { rpcContract } from "../../server";

interface Nav {
  readonly openUrl: (url: string) => boolean;
  readonly toThread: (threadId: string) => void;
}

/** One or many, handled the same way — only a Notification has a `tone`. */
const listOf = (input: readonly Notification[] | Notification): readonly Notification[] =>
  "tone" in input ? [input] : input;

/** What the confirm button of a prompt does; the only notification that acts. */
type Repoint = (repoint: PendingRepoint) => void;

// Which address gets the one action slot is decided in
// src/core/notification-layout.ts; here it only becomes an onClick.
function onClickOf(action: NotificationAction, nav: Nav, repoint: Repoint): () => void {
  switch (action.kind) {
    case "repoint":
      return () => repoint(action.repoint);
    case "thread":
      return () => nav.toThread(action.threadId);
    case "url":
      return () => {
        nav.openUrl(action.url);
      };
  }
}

// The card is drawn by the plugin, not left to the host toaster's default
// shape: bb's plugin-facing toaster paints a solid-black toast with a filled
// icon and a close ring hung off the top-left corner, while bb's own
// notifications are bordered cards with a corner cross and an outline glyph.
// `toast.custom` hands us a bare slot, so the plugin's toasts match bb's own.
//
// Colours are bb's design-system variables, read straight from the host DOM
// (where they are always defined) — never hard-coded hex — so the card tracks
// the app's light and dark themes. Inline styles rather than classes for the
// same reason: no stylesheet of ours is guaranteed in the host's DOM.
const TONE_ICON: Record<NotificationTone, IconName> = {
  success: "CircleCheck",
  warning: "AlertTriangle",
  error: "AlertCircle",
};

const cardStyle: CSSProperties = {
  position: "relative",
  boxSizing: "border-box",
  display: "flex",
  gap: 12,
  alignItems: "flex-start",
  width: 356,
  padding: "14px 40px 14px 16px",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 12px)",
  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.28)",
  font: "inherit",
  fontSize: 14,
  lineHeight: 1.4,
};

const bodyStyle: CSSProperties = { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 };
const titleStyle: CSSProperties = { fontWeight: 600, wordBreak: "break-word" };
const detailStyle: CSSProperties = { fontSize: 13, color: "var(--muted-foreground)", wordBreak: "break-word" };

const actionRowStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 };

// Buttons carry their label as text beside the icon: the card sits at the
// bottom of the toast with room for it, and "View on GitHub" reads plainer
// than a bare glyph. They wrap to a second line rather than overflow the card.
const actionButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 28,
  padding: "0 10px",
  cursor: "pointer",
  borderRadius: "calc(var(--radius, 12px) - 4px)",
  border: "1px solid var(--border)",
  background: "var(--secondary, transparent)",
  color: "var(--secondary-foreground, inherit)",
  font: "inherit",
  fontSize: 13,
  fontWeight: 500,
  lineHeight: 1,
  whiteSpace: "nowrap",
};

const closeStyle: CSSProperties = {
  position: "absolute",
  top: 10,
  right: 10,
  display: "inline-flex",
  padding: 4,
  background: "none",
  border: 0,
  borderRadius: 6,
  color: "var(--muted-foreground)",
  cursor: "pointer",
  lineHeight: 0,
};

interface CardButton {
  /** Shown only as the hover tooltip; the button itself is the icon alone. */
  readonly label: string;
  readonly icon: IconName;
  readonly onClick: () => void;
}

// Each address the layout can offer gets a glyph that says what it does. A
// url here is always a GitHub link (a PR), so it wears the GitHub mark, not a
// generic code glyph. A decline is the plain cross.
const ACTION_ICON: Record<NotificationAction["kind"], IconName> = {
  repoint: "Download",
  thread: "MessageSquare",
  url: "Github",
};

/** One toast, drawn as a card that matches bb's own notifications. */
function NotificationCard({
  notification,
  buttons,
  onClose,
}: {
  readonly notification: Notification;
  /**
   * Every address the toast offers, drawn as icon-only buttons in one row: the
   * primary action first, then any link the layout had no slot for, then a
   * prompt's decline. Side by side rather than stacked — the way bb's cards read.
   */
  readonly buttons: readonly CardButton[];
  readonly onClose: () => void;
}): ReactNode {
  const { tone, title, details } = notification;
  // Any answer dismisses the toast the way the cross does.
  const andClose = (onClick: () => void) => () => {
    onClick();
    onClose();
  };
  return (
    <div style={cardStyle} role="status">
      <Icon name={TONE_ICON[tone]} style={{ width: 18, height: 18, flexShrink: 0, marginTop: 1 }} aria-hidden />
      <div style={bodyStyle}>
        <div style={titleStyle}>{title}</div>
        {details.map((detail, index) => (
          <div key={`${index}-${detail}`} style={detailStyle}>
            {detail}
          </div>
        ))}
        {buttons.length > 0 && (
          <div style={actionRowStyle}>
            {buttons.map(({ label, icon, onClick }) => (
              <button
                key={label}
                aria-label={label}
                onClick={andClose(onClick)}
                style={actionButtonStyle}
                title={label}
                type="button"
              >
                <Icon name={icon} style={{ width: 15, height: 15, flexShrink: 0 }} aria-hidden />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button aria-label="Dismiss" onClick={onClose} style={closeStyle} type="button">
        <Icon name="X" style={{ width: 16, height: 16 }} aria-hidden />
      </button>
    </div>
  );
}

function show(notification: Notification, nav: Nav, repoint: Repoint): void {
  const { action, linkLines } = notificationLayout(notification);
  const buttons: CardButton[] = [
    ...(action === null
      ? []
      : [{ label: action.label, icon: ACTION_ICON[action.kind], onClick: onClickOf(action, nav, repoint) }]),
    ...linkLines.map(({ label, url }) => ({ label, icon: "Github" as IconName, onClick: () => void nav.openUrl(url) })),
    // Declining a prompt is a real answer, so it is a button of its own; it
    // only needs to dismiss, which the card's close does for every action.
    ...(notification.prompt
      ? [{ label: notification.prompt.cancelLabel, icon: "X" as IconName, onClick: () => {} }]
      : []),
  ];
  toast.custom(
    (id) => <NotificationCard notification={notification} buttons={buttons} onClose={() => toast.dismiss(id)} />,
    { duration: Infinity },
  );
}

/**
 * Show what an action had to say. Builders in src/core/notification.ts return
 * a list — one success plus a warning per thing that fell short — so callers
 * hand the whole list over in one call and can't drop the tail of it.
 */
export function useNotify(): (notifications: readonly Notification[] | Notification) => void {
  const { openUrl, toThread } = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  return useCallback(
    (notifications: readonly Notification[] | Notification) => {
      const nav: Nav = { openUrl, toThread };
      // The confirmed repoint reports back through the same channel: a
      // success line, or the RPC's own reason for failing.
      const repoint: Repoint = ({ pluginId, source, subdirectory }) => {
        rpc.call("repointPlugin", { pluginId, source, subdirectory }).then(
          () => show(repointedNotification(pluginId), nav, repoint),
          (error: unknown) =>
            show(errorNotification(error, `Could not repoint ${pluginId} to git.`), nav, repoint),
        );
      };
      for (const notification of listOf(notifications)) show(notification, nav, repoint);
    },
    [openUrl, toThread, rpc],
  );
}
