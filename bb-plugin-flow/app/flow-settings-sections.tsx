// Секция страницы настроек плагина: общее на все flow — автоповтор автоматизаций.
// Коллекцию flow они правят тем же хранилищем, что и страница Flow.
import { LocaleProvider } from "./locale";
import { AutomationRetry } from "./stage-settings";
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
      <AutomationRetry />
    </LocaleProvider>
  );
}
