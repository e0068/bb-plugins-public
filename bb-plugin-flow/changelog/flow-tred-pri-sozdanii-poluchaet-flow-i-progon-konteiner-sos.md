---
version: 0.6.81
date: 2026-10-01
pr: 629
---

- ru: Тред, которому передали работу, с первого хода идёт flow и прогоном исходного треда — агент больше не выбирает flow заново, а этапы, снятые в брифе, не возвращаются в прогон
  en: A thread that receives handed-over work starts on the source thread's flow and run — the agent no longer picks a flow again, and stages dropped in the brief stay out of the run
- ru: Новый тред с выбранным flow сразу показывает этапы над композером, а после завершённого прогона сообщение уходит агенту без формы — следующий flow выбирается в контейнере состояния Flow, по умолчанию «Автоматически»
  en: A new thread with a chosen flow shows its stages above the composer right away, and after a finished run the message goes to the agent without a form — the next flow is picked in the Flow state container, Automatic by default
- ru: В контейнере состояния Flow минуты и доллары стоят своими колонками, у этапов впереди едва заметен план «~3 м», последняя строка — сколько потрачено всего, а строка этапа сворачивается: развёрнутая показывает все результаты и шаги автоматизации, ошибка шага — с новой строки
  en: In the Flow state container minutes and dollars have their own columns, upcoming stages show a faint "~3 m" plan, the last row totals what was spent, and a stage row collapses: expanded, it lists all results and automation steps, with a step error on its own line
