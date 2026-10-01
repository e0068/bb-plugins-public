---
version: 0.6.78
date: 2026-10-01
pr: 626
---

- ru: Шаг FF Branch ← Main сам сводит конфликты в файлах задач и пунктах ченж-лога, а на остальные будит агента треда и повторяет шаг после его хода вместо повторов по таймеру
  en: FF Branch ← Main settles conflicts in task files and changelog entries by itself, and for any other conflict wakes the thread's agent and retries after its turn instead of retrying on a timer
- ru: Строка выбора flow стоит над композером и после завершённого прогона — выбранный flow начнётся с вашим сообщением
  en: The flow picker line stays above the composer after a finished run too — the flow you pick starts with your message
- ru: Новая работа в треде с пройденным прогоном помечает этапы, которые вы не взяли в прогон, как «не в прогоне», а не как предстоящие
  en: New work in a thread with a finished run marks the stages you left out as "not in the run" instead of upcoming
