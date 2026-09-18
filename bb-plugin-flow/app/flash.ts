// Отметка на время: галочка после копирования или ввода, подтверждение на месте пути.
import { useEffect, useRef, useState } from "react";

/** Галочка на время: `flash()` включает, таймер гасит; размонтирование таймер снимает. */
export function useFlash(ms: number): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current !== null && clearTimeout(timer.current)), []);
  return [
    on,
    () => {
      if (timer.current !== null) clearTimeout(timer.current);
      setOn(true);
      timer.current = setTimeout(() => setOn(false), ms);
    },
  ];
}

/** Копирует текст; буфера нет вне HTTPS — это та же неудача, а не исключение в обработчике. */
export const copyText = (text: string): Promise<void> => {
  try {
    return navigator.clipboard.writeText(text);
  } catch (cause) {
    return Promise.reject(cause);
  }
};
