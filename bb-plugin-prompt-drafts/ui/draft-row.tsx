// Слой 4 — оболочка UI: ряд карточек черновиков, общий для Home и треда.
//
// Ряд прокручивается вбок без видимой полосы и выходит за колонку композера до краёв блока,
// который обрезает страницу: карточки уезжают под край панели, а не
// обрываются по ширине композера. Первая карточка стоит у края колонки. Подсказка решает, писать ли
// «текущий текст сохранится», в момент открытия: композер к этому времени
// мог измениться.
import { useRef, useState, type CSSProperties, type KeyboardEvent, type ReactElement } from "react";
import { Markdown, useComposer } from "@get-bb/plugin-sdk/app";
import { Icon, type IconName } from "../components/ui/icon";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { isBlank, type Draft, type DraftList } from "../core/drafts";
import type { CardTextSize, Settings } from "../core/settings";
import { useBleed } from "./use-bleed";

export const SEND_LABEL = "Send to Composer";
export const KEEP_LABEL = "Current text will be saved as a draft";

/**
 * Шаги шкалы bb: `sm` — размер текста сообщения, `2xs` — размер подписи места.
 * Строка сжимается вместе с кеглем. Классы ложатся на корень разметки: он сам
 * ставит `text-sm leading-relaxed` и перебил бы размер, унаследованный от обёртки.
 */
const CARD_TEXT: Record<CardTextSize, string> = {
  default: "text-[13px] leading-[18px]",
  small: "text-[12px] leading-[16px]",
  smallest: "text-[11px] leading-[14px]",
};

interface RowProps {
  readonly cards: DraftList;
  readonly settings: Settings;
  /** Строка с названием треда — на Home, когда там видны черновики тредов. */
  readonly showThreadTitle: boolean;
  readonly onSend: (draft: Draft) => void;
  readonly onRemove: (draft: Draft) => void;
  /** Обмен в пути: карточки не принимают клики. */
  readonly busy: boolean;
}

/** Начало текста без разметки — для доступного имени карточки. */
export function previewOf(text: string): string {
  const plain = text.replace(/[*_`#>~[\]()]/g, "").replace(/\s+/g, " ").trim();
  return plain.length > 80 ? `${plain.slice(0, 80)}…` : plain;
}

export function DraftRow({ cards, settings, showThreadTitle, onSend, onRemove, busy }: RowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const bleed = useBleed(rowRef, cards.length > 0);
  if (cards.length === 0) return null;
  // Отступ возвращает карточки к краю колонки, отступ прокрутки держит там же фокус с клавиатуры.
  const bleedStyle: CSSProperties = {
    marginLeft: -bleed.left,
    marginRight: -bleed.right,
    paddingLeft: bleed.left,
    paddingRight: bleed.right,
    scrollPaddingLeft: bleed.left,
    scrollPaddingRight: bleed.right,
  };
  return (
    <TooltipProvider delayDuration={300}>
      <div ref={rowRef} style={bleedStyle} className="flex items-stretch gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-busy={busy}>
        {cards.map((draft) => (
          <DraftCard
            key={draft.id}
            draft={draft}
            settings={settings}
            showThreadTitle={showThreadTitle}
            onSend={onSend}
            onRemove={onRemove}
            busy={busy}
          />
        ))}
      </div>
    </TooltipProvider>
  );
}

interface CardProps {
  readonly draft: Draft;
  readonly settings: Settings;
  readonly showThreadTitle: boolean;
  readonly onSend: (draft: Draft) => void;
  readonly onRemove: (draft: Draft) => void;
  readonly busy: boolean;
}

function DraftCard({ draft, settings, showThreadTitle, onSend, onRemove, busy }: CardProps): ReactElement {
  const composer = useComposer();
  const [keepsCurrent, setKeepsCurrent] = useState(false);
  const { place } = draft;

  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.key !== "Enter" && event.key !== " ") || event.repeat) return;
    event.preventDefault();
    onSend(draft);
  };

  const clamp = {
    "--draft-lines": settings.cardLines,
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: "var(--draft-lines)",
  } as CSSProperties;

  return (
    <div data-draft-card="" className="group relative flex flex-none" style={{ width: settings.cardWidth }}>
      <Tooltip onOpenChange={(open) => open && setKeepsCurrent(!isBlank(composer.text))}>
        <TooltipTrigger asChild>
          <div
            role="button"
            tabIndex={0}
            aria-label={`${SEND_LABEL}: ${previewOf(draft.text)}`}
            aria-disabled={busy}
            className="flex w-full min-w-0 cursor-pointer flex-col gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-left hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => onSend(draft)}
            onKeyDown={onKeyDown}
          >
            <div
              data-draft-text=""
              // Ссылки из разметки не должны ловить ни мышь, ни Tab внутри кнопки-карточки.
              inert
              className="pointer-events-none overflow-hidden text-foreground [overflow-wrap:anywhere]"
              style={clamp}
            >
              <Markdown content={draft.text} className={CARD_TEXT[settings.cardTextSize]} />
            </div>
            {showThreadTitle && place.threadTitle !== null ? (
              <MetaItem icon="MessageSquare" text={place.threadTitle} />
            ) : null}
            <div className="mt-auto flex min-w-0 items-center gap-2">
              {place.projectName !== null ? <MetaItem icon="Folder" text={place.projectName} /> : null}
              {place.worktree !== null ? <MetaItem icon="FolderGit" text={place.worktree} /> : null}
              {place.branch !== null ? <MetaItem icon="GitBranch" text={place.branch} /> : null}
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">
          <div>{SEND_LABEL}</div>
          {keepsCurrent ? <div className="text-muted-foreground">{KEEP_LABEL}</div> : null}
        </TooltipContent>
      </Tooltip>
      <button
        type="button"
        aria-label="Delete draft"
        title="Delete draft"
        className="absolute right-1 top-1 hidden size-[22px] cursor-pointer items-center justify-center rounded-md bg-state-hover text-muted-foreground hover:bg-state-active hover:text-foreground group-focus-within:inline-flex group-hover:inline-flex [&_svg]:size-3.5"
        onClick={() => onRemove(draft)}
      >
        <Icon name="X" aria-hidden />
      </button>
    </div>
  );
}

/** Проект, дерево и ветка делят строку поровну и обрезаются многоточием. */
function MetaItem({ icon, text }: { icon: IconName; text: string }): ReactElement {
  return (
    <span className="flex min-w-0 flex-1 basis-0 items-center gap-1 text-[11px] leading-4 text-muted-foreground" title={text}>
      <Icon name={icon} aria-hidden className="size-3 shrink-0" />
      <span className="min-w-0 truncate">{text}</span>
    </span>
  );
}
