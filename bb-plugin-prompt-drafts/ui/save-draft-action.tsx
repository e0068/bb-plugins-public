// Слой 4 — оболочка UI: кнопка «Save Draft» в строке действий композера.
//
// Хост ставит действия плагинов перед голосом и отправкой — в правый нижний
// угол. Классы повторяют кнопку выбора модели и effort из бандла bb: ghost,
// sm, h-8, text-xs, приглушённый текст без рамки и фона. Поля шире, чем у
// пикера (px-2 вместо px-1): у кнопки с подписью подложка наведения иначе
// прилипает к иконке и тексту. На узком экране подписи нет — только иконка с
// полями пикера, имя остаётся в aria-label.
import { useState, type ReactElement } from "react";
import { useComposer, useComposerView } from "@get-bb/plugin-sdk/app";
import { Button } from "../components/ui/button";
import { Icon } from "../components/ui/icon";
import { isBlank } from "../core/drafts";
import { useAutosave } from "./use-autosave";
import { reportFailure, useDraftActions, whereOf } from "./use-drafts";

const PICKER_LOOK =
  "h-8 w-fit min-w-0 items-center justify-start gap-1.5 px-2 text-xs leading-tight border-none bg-transparent shadow-none transition-none text-muted-foreground hover:text-muted-foreground font-normal max-sm:px-1";

const SAVE_LABEL = "Save Draft";

export function SaveDraftAction(): ReactElement | null {
  const view = useComposerView();
  const composer = useComposer();
  const actions = useDraftActions();
  const [saving, setSaving] = useState(false);
  const where = whereOf(view.scope);
  // Кнопка — единственное монтирование плагина в каждом композере обеих
  // областей, поэтому слежение за набором живёт здесь, а не отдельной
  // поверхностью: второе монтирование писало бы в тот же слот вторым голосом.
  useAutosave(where);
  if (where === null) return null;

  const save = () => {
    const text = composer.text;
    if (isBlank(text)) return;
    setSaving(true);
    actions
      .save(where, text)
      // Пока шёл запрос, пользователь мог дописать: чистим, только если текст тот же.
      .then(() => composer.updateText((current) => (current === text ? "" : current)), reportFailure)
      .finally(() => setSaving(false));
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={PICKER_LOOK}
      aria-label={SAVE_LABEL}
      disabled={saving || isBlank(view.draft.text)}
      onClick={save}
    >
      <Icon name="EditFile" aria-hidden />
      <span className="max-sm:hidden">{SAVE_LABEL}</span>
    </Button>
  );
}
