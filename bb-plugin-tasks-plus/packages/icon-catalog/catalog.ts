// Подборка иконок Hugeicons, общая для Flow и Tasks+: из неё владелец выбирает иконку этапа и иконку проекта. Имя —
// экспорт пакета без суффикса Icon: оно хранится у этапа и у проекта, поэтому переименовывать нельзя — этап с пропавшим
// именем показывает иконку по виду, проект — папку.
import type { Glyph } from "./glyph";
import { GLYPHS } from "./glyphs";

/** Иконки подборки по имени, в порядке показа в выборе. Глифы лежат в пакете готовыми — см. generate.mjs. */
export const ICON_CATALOG: ReadonlyMap<string, Glyph> = new Map(Object.entries(GLYPHS));

/** Иконка проекта, у которого своя не выбрана. */
export const DEFAULT_PROJECT_ICON = "Folder01";
