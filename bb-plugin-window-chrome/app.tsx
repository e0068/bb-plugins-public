// Window Chrome, фронт: единственный content-скрипт — таблица стилей поверх
// десктопной раскладки bb.
import { definePluginApp } from "@get-bb/plugin-sdk/app";

import { registerWindowChrome } from "./app/content";

export default definePluginApp((app) => {
  registerWindowChrome(app);
});
