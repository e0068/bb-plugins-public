// Window Chrome, провод: контракт RPC темы окна между сервером и фронтом.
// Фронт импортирует отсюда только типы: значение из модуля с SDK ломает бандл.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { parseThemeValues, type ThemeValues } from "../core/theme";

/** Значения темы: принимается любой объект, допустимое отбирает разбор ядра — неизвестное просто отбрасывается. */
export const themeValuesSchema = z.record(z.string(), z.unknown()).transform((input): ThemeValues => parseThemeValues(input));

/**
 * Итог сохранения: тема записана и включена; имя занято и нужен явный `replace`;
 * имя не годится в id темы; файл не записался — `message` с текстом системы.
 * Коды ошибок RPC в SDK фиксированы, поэтому исходы — статусом, а не исключением.
 */
const savedSchema = z.object({
  status: z.enum(["saved", "exists", "invalid_name", "write_failed"]),
  id: z.string().nullable(),
  message: z.string().nullable(),
});

export type SaveResult = z.infer<typeof savedSchema>;

export const themeRpcContract = defineRpcContract({
  get: { input: z.null(), output: themeValuesSchema },
  set: { input: themeValuesSchema, output: z.object({ ok: z.literal(true) }) },
  saveTheme: { input: z.object({ name: z.string(), replace: z.boolean() }).strict(), output: savedSchema },
});
