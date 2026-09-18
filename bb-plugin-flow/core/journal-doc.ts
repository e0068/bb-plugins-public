// Текст и имя файла журнала решений — минимальные данные: время ответа и
// тело, которое уже существует и проверено как реплика агенту
// (`answerMessageText`). Без фактов треда: git и Tasks+ сюда не ходят.
import { answerMessageText } from "./answer-message";
import type { Locale } from "../lib/i18n";
import type { DecisionAnswer, DecisionBrief } from "../shared/contract";

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

const transliterate = (text: string): string =>
  Array.from(text.toLowerCase())
    .map((ch) => CYRILLIC_TO_LATIN[ch] ?? ch)
    .join("");

const MAX_NAME_LENGTH = 60;

/** Заголовок брифа в слаг: транслитерация, нижний регистр, только `a-z0-9-`; пусто — «decision». */
export const decisionFileName = (title: string): string => {
  const base = transliterate(title)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_NAME_LENGTH)
    .replace(/-+$/g, "");
  return base.length > 0 ? base : "decision";
};

/** Имя попытки: базовое на нулевой, дальше с суффиксом `-2`, `-3`, … — тот же ряд, что уже мог лечь на диск раньше. */
export const suffixedName = (base: string, attempt: number): string => (attempt === 0 ? base : `${base}-${attempt + 1}`);

/** Файл журнала: `decided_at` шапкой, дальше — та же реплика, что ушла агенту, на том же языке. */
export const decisionDocument = (args: { brief: DecisionBrief; answer: DecisionAnswer; decidedAt: string; locale?: Locale }): string =>
  `---\ndecided_at: ${args.decidedAt}\n---\n\n${answerMessageText(args.brief, args.answer, args.locale)}\n`;
