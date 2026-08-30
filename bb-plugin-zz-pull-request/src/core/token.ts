// Слой 1 — выбор GitHub-токена из доступных источников. Ноль эффектов.
// Приоритет: явная настройка плагина (если задана) → токен из `gh auth token`.
// Само чтение gh — эффект, живёт в src/wiring/gh-token.ts.

/**
 * Возвращает первый непустой токен или null, если ни настройка, ни gh его не
 * дали. Пробелы по краям отбрасываются, чтобы случайный перевод строки из
 * вывода gh не поехал в заголовок авторизации.
 */
export function chooseToken(
  settingToken: string | undefined,
  ghToken: string | null,
): string | null {
  const fromSetting = settingToken?.trim();
  if (fromSetting) return fromSetting;
  const fromGh = ghToken?.trim();
  if (fromGh) return fromGh;
  return null;
}
