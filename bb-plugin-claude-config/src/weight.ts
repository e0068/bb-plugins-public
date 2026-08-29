// Оценка «веса» файла в токенах и её показ. Чистый слой без ввода-вывода:
// сервер читает содержимое и зовёт estimateTokens, UI печатает formatWeight.

// Грубая оценка: ~4 символа на токен — обиходная эвристика для латиницы и
// разметки. Точный токенайзер тут не нужен: это ориентир «сколько контекста
// съест файл», а не счёт для биллинга.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Компактная подпись без слова «токенов»: «~340», «~1.2k», «~12k».
export function formatWeight(tokens: number): string {
  if (tokens < 1000) return `~${tokens}`;
  const thousands = tokens / 1000;
  return `~${thousands < 10 ? thousands.toFixed(1) : Math.round(thousands)}k`;
}
