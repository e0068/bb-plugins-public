// Слой 1 — извлечение пути файла, который читает или запускает команда хука.
// Чистая функция без ввода-вывода: на входе команда, на выходе путь-токен (с
// плейсхолдерами вида `$CLAUDE_PROJECT_DIR` или `~`). Резолв плейсхолдеров и
// чтение файла — забота слоя I/O (server), не этого модуля.

/**
 * Достаёт из команды хука путь к файлу, который она читает или запускает
 * (`cat …/checklist.json`, `bash …/foo.sh`, прямой `~/.claude/hooks/x.py`), или
 * null, если файлового аргумента нет (`jq -r '.foo'`, `echo hi`).
 *
 * Разбор грубый и терпимый: команда бьётся по пробелам, кавычки снимаются, за
 * файл принимается первый токен с разделителем пути `/` — так имя утилиты
 * (`cat`, `bash`), флаги и jq-фильтры (`.tool_input.command`) отсеиваются сами,
 * а абсолютные, `~`- и `$VAR`-пути к файлу распознаются. Плейсхолдеры окружения
 * остаются в пути как есть — их раскрывает слой I/O.
 */
export function extractCommandFile(command: string): string | null {
  for (const rawToken of command.split(/\s+/)) {
    const token = stripQuotes(rawToken);
    if (token === "" || token.startsWith("-")) continue;
    if (token.includes("/")) return token;
  }
  return null;
}

/** Снимает окружающие одинарные или двойные кавычки с токена. */
function stripQuotes(token: string): string {
  const match = /^(['"])(.*)\1$/.exec(token);
  return match ? match[2] : token;
}
