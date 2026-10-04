// Ответ на клик «Повторить» и «Пропустить» в полосе прогона: отказ и упавший
// вызов владелец видит тостом, а не гаснущей кнопкой. Это единственный тост
// Flow — ответ на нажатие; итоги автоматизаций всплывают тостами Центра
// уведомлений, Flow отдаёт их туда записью. Карточка повторяет тосты центра —
// рамка, иконка, крестик — на переменных дизайн-системы хоста.
import type { CSSProperties, ReactNode } from "react";
import { toast } from "sonner";

import { Icon } from "../components/ui/icon";
import type { Messages } from "../lib/messages";
import type { StepAnswer } from "../shared/contract";

// Карточка заполняет слот тоста и обрезает остальное: sonner прячет лишнее только у своих тостов, и торчащий
// из-под передней карточки край раскачивал стопку под курсором. Тень карточки своим overflow не режется.
const cardStyle: CSSProperties = {
  height: "100%",
  overflow: "hidden",
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
  boxShadow: "0 8px 24px color-mix(in oklab, black 28%, transparent)",
  font: "inherit",
  fontSize: 14,
  lineHeight: 1.4,
};
const textStyle: CSSProperties = { flex: 1, minWidth: 0, fontWeight: 600, wordBreak: "break-word" };
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

function Refusal({ text, t, close }: { text: string; t: Messages; close: () => void }): ReactNode {
  return (
    <div style={cardStyle} role="status">
      <Icon name="AlertCircle" style={{ width: 18, height: 18, flexShrink: 0, marginTop: 1 }} aria-hidden />
      <div style={textStyle}>{text}</div>
      <button type="button" aria-label={t.notice.dismiss} onClick={close} style={closeStyle}>
        <Icon name="X" style={{ width: 16, height: 16 }} aria-hidden />
      </button>
    </div>
  );
}

/** Тост висит, пока его не закроют: ответ легко пропустить, отойдя от экрана. */
const showRefusal = (text: string, t: Messages): void => {
  toast.custom((id) => <Refusal text={text} t={t} close={() => toast.dismiss(id)} />, { duration: Infinity });
};

/** «Не начат» значит, что шаг уже не ждёт; `busy` — что Flow сейчас ведёт тред. */
export const reportStepAnswer = (answer: Promise<StepAnswer>, stageName: string, t: Messages): Promise<void> =>
  answer.then(
    ({ started, busy }) => {
      if (!started) showRefusal(busy === true ? t.notice.busy(stageName) : t.notice.notWaiting(stageName), t);
    },
    (error: unknown) => showRefusal(error instanceof Error ? error.message : String(error), t),
  );
