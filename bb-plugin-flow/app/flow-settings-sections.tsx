// Секции страницы настроек плагина: общее на все flow — автоповтор автоматизаций и очистка контекста после автоматического выбора flow.
// Коллекцию flow они правят тем же хранилищем, что и страница Flow.
import { LocaleProvider } from "./locale";
import { MentionsProvider } from "./mentions";
import { AutomationRetry, AutoChoiceClear } from "./stage-settings";
import { useFlowSettingsLive } from "./stage-settings-store";

/** Секция настроек живёт отдельно от страницы Flow и сама следит, что коллекция поменялась на сервере. */
function Live() {
  useFlowSettingsLive();
  return null;
}

export function AutomationRetrySection() {
  return (
    <LocaleProvider>
      <Live />
      {/* Инструкция пробуждения — поле со списком навыков по `/`. */}
      <MentionsProvider>
        <AutomationRetry />
      </MentionsProvider>
    </LocaleProvider>
  );
}

export function AutoChoiceSection() {
  return (
    <LocaleProvider>
      <Live />
      <AutoChoiceClear />
    </LocaleProvider>
  );
}
