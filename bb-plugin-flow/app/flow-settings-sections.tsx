// Секция страницы настроек плагина: общее на все flow — автоповтор автоматизаций.
// Коллекцию flow они правят тем же хранилищем, что и страница Flow.
import { LocaleProvider } from "./locale";
import { AutomationRetry } from "./stage-settings";

export function AutomationRetrySection() {
  return (
    <LocaleProvider>
      <AutomationRetry />
    </LocaleProvider>
  );
}
