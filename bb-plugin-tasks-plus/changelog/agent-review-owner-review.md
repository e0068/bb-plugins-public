---
version: 0.1.102
date: 2026-11-07T17:37Z
pr: 902
---

- ru: Ревью разделилось на два статуса — Agent Review, пока работу проверяет агент, и Owner Review, когда она ждёт владельца
  en: Review is split into two statuses — Agent Review while an agent checks the work, and Owner Review when it waits for the owner
- ru: Привязка треда командой bb tasks attach больше не переводит задачу в In Progress — агент берёт подзадачи в работу по одной, когда начинает каждую
  en: Attaching a thread with bb tasks attach no longer moves the task to In Progress — an agent takes sub-tasks into progress one by one, as it starts each
- ru: Агент возвращает задачу из Owner Review в In Progress, как только владелец вернул её в работу
  en: An agent moves a task from Owner Review back to In Progress as soon as the owner returns it
- ru: Цифровые клавиши статуса сдвинулись — 4 Agent Review, 5 Owner Review, 6 Done, 7 Canceled
  en: The status number keys moved — 4 Agent Review, 5 Owner Review, 6 Done, 7 Canceled
