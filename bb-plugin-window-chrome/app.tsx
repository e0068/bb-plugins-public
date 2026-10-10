// Window Chrome, фронт: content-скрипт с таблицей окна, форма темы окна в
// настройках и в Side Pane треда, невидимый оверлей, который применяет тему.
import { definePluginApp } from "@get-bb/plugin-sdk/app";

import { registerWindowChrome } from "./app/content";
import { ThemeEditor } from "./app/theme-editor";
import { ThemeStyle } from "./app/theme-style";

/** Id формы темы — у раздела настроек и у действия правой панели. */
export const THEME_EDITOR = "theme";

export default definePluginApp((app) => {
  registerWindowChrome(app);
  app.slots.settingsSection({
    id: THEME_EDITOR,
    title: "Тема окна",
    description: "Цвета, скругления, отступы и размеры bb. Пустое поле — значение текущей темы.",
    component: ThemeEditor,
  });
  app.slots.threadPanelAction({ id: THEME_EDITOR, title: "Тема окна", icon: "Palette", component: ThemeEditor });
  // Оверлей экспериментальный: на bb без него тема видна после сохранения, но не по ходу правки.
  if (typeof app.slots.experimental_appOverlay !== "function") return;
  app.slots.experimental_appOverlay({ id: "theme", component: ThemeStyle });
});
