// Секции страницы настроек плагина: общее на все flow — ширина кнопки этапа и автоповтор автоматизаций.
// Коллекцию flow они правят тем же хранилищем, что и страница Flow.
import { LocaleProvider } from "./locale";
import { AutomationRetry, StageButtonWidth } from "./stage-settings";

export function StageButtonsSection() {
  return (
    <LocaleProvider>
      <StageButtonWidth />
    </LocaleProvider>
  );
}

export function AutomationRetrySection() {
  return (
    <LocaleProvider>
      <AutomationRetry />
    </LocaleProvider>
  );
}
