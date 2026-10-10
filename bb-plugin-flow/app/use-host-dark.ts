// Тёмная ли тема bb сейчас: то, что объявляет корень страницы, а без объявления — тема системы. Копия хука Mail
// (bb-plugin-mail/hooks/use-host-dark.ts): плагины не импортируют друг друга.
import { useEffect, useState } from "react";

const DARK_QUERY = "(prefers-color-scheme: dark)";

const systemDark = (): boolean => typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;

/** `color-scheme` корня, а не имя класса: тема, которую объявил bb, красит и скроллбары, и поля ввода. */
const hostDark = (): boolean => {
  const declared = getComputedStyle(document.documentElement).colorScheme;
  return declared === "dark" ? true : declared === "light" ? false : systemDark();
};

/** Тема bb с подпиской: переключение темы — смена атрибута корня, система — медиазапрос. */
export function useHostDark(): boolean {
  const [dark, setDark] = useState(hostDark);
  useEffect(() => {
    const read = (): void => setDark(hostDark());
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true });
    const system = typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null;
    system?.addEventListener("change", read);
    return () => {
      observer.disconnect();
      system?.removeEventListener("change", read);
    };
  }, []);
  return dark;
}
