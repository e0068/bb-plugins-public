// Разовая чистка сохранённых flow от этапов прежнего flow по умолчанию, чьих
// навыков у владельца нет. Идёт с каталогом навыков в руках — при запуске и
// при каждом чтении каталога, пока не случится один раз: этап, поставленный
// после неё, уже решение владельца, и следующая чистка его не трогает.
// Кто читает коллекцию, чтобы потом записать её целиком, сперва ждёт `done()`:
// иначе запись вернула бы вычищенные этапы, а отметка уже не дала бы чистке
// пройти снова.
import type { PluginKvStorage } from "@get-bb/plugin-sdk";

import { catalogSeesPlugin, withoutLegacyStages } from "../core/legacy-stages";
import type { StageCatalog } from "../shared/contract";
import type { FlowSettingsStore } from "./flow-settings";

export const LEGACY_STAGES_HEALED_KEY = "migrations:legacy-default-stages";

export type LegacyHeal = {
  /** Сверка коллекции с прочитанным каталогом; непрочитанный каталог чистку откладывает. */
  run(catalog: StageCatalog): Promise<void>;
  /** Чистка прошла — в этом процессе или в прежнем. */
  done(): boolean;
};

export const createLegacyHeal = (kv: PluginKvStorage, settings: FlowSettingsStore): LegacyHeal => {
  let done = false;
  return {
    done: () => done,
    async run(catalog) {
      if (done) return;
      if ((await kv.get(LEGACY_STAGES_HEALED_KEY)) === true) {
        done = true;
        return;
      }
      const skills = catalog.skills.map((s) => s.name);
      // Отметка ставится только после настоящей сверки: сбойный каталог не должен закрыть чистку навсегда.
      if (!catalogSeesPlugin(skills)) return;
      const healed = withoutLegacyStages(settings.current(), skills);
      if (healed !== settings.current()) await settings.save(healed);
      await kv.set(LEGACY_STAGES_HEALED_KEY, true);
      done = true;
    },
  };
};
