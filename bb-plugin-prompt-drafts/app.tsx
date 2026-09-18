// bb-plugin-prompt-drafts — фронт.
//
// Кнопка «Save Draft» — действие композеров треда и Home. Карточки черновиков —
// баннер над композером в обеих областях: там хост даёт место вплотную к полю
// ввода, без заголовка и без рамки. Список живёт на сервере плагина;
// поверхности только читают его и зовут RPC.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ComposerDrafts } from "./ui/composer-drafts";
import { SaveDraftAction } from "./ui/save-draft-action";

export default definePluginApp((app) => {
  app.composer.customize({
    id: "prompt-drafts",
    scopes: ["thread", "new-thread"],
    actions: [{ id: "save-draft", component: SaveDraftAction }],
    banners: [{ id: "drafts", chrome: "bare", component: ComposerDrafts }],
  });
});
