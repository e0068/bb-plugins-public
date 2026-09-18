// Слой 4 — оболочка UI: карточки черновиков над композером, и в треде, и на Home.
//
// Хост ставит плагинные баннеры общим блоком прямо над полем ввода, без
// заголовка и без рамки при `chrome: "bare"`. Секция домашнего экрана так не
// умеет: у неё обязательный заголовок и собственный отступ от композера.
//
// Какие карточки видны, решает область композера: в треде — черновики этого
// треда, на Home — то, что настройка оставляет домашнему экрану.
import type { ReactElement } from "react";
import { useComposerView, useSettings } from "@get-bb/plugin-sdk/app";
import { homeCards, threadCards, type DraftList } from "../core/drafts";
import type { Where } from "../core/place";
import { parseSettings, type Settings } from "../core/settings";
import { DraftRow } from "./draft-row";
import { reportFailure, useDraftActions, useDrafts, useSendToComposer } from "./use-drafts";

export function ComposerDrafts(): ReactElement | null {
  const { scope } = useComposerView();
  switch (scope.kind) {
    case "thread":
      return <ThreadRow threadId={scope.threadId} />;
    case "new-thread":
      return <HomeRow projectId={scope.projectId} />;
    default:
      return null;
  }
}

function ThreadRow({ threadId }: { threadId: string }): ReactElement | null {
  const settings = parseSettings(useSettings().values);
  const drafts = useDrafts();
  return (
    <Row
      cards={threadCards(drafts ?? [], threadId, settings.showInThreads)}
      settings={settings}
      where={{ threadId }}
      showThreadTitle={false}
    />
  );
}

function HomeRow({ projectId }: { projectId: string | null }): ReactElement | null {
  const settings = parseSettings(useSettings().values);
  const drafts = useDrafts();
  return (
    <Row
      cards={homeCards(drafts ?? [], settings.showInThreads)}
      settings={settings}
      where={{ projectId }}
      // Название треда — только когда на Home видны черновики чужих тредов.
      showThreadTitle={!settings.showInThreads}
    />
  );
}

interface RowProps {
  readonly cards: DraftList;
  readonly settings: Settings;
  readonly where: Where;
  readonly showThreadTitle: boolean;
}

function Row({ cards, settings, where, showThreadTitle }: RowProps): ReactElement | null {
  const actions = useDraftActions();
  const { send, busy } = useSendToComposer(where);
  return (
    <DraftRow
      cards={cards}
      settings={settings}
      showThreadTitle={showThreadTitle}
      onSend={send}
      busy={busy}
      onRemove={(draft) => void actions.remove(draft.id).catch(reportFailure)}
    />
  );
}
