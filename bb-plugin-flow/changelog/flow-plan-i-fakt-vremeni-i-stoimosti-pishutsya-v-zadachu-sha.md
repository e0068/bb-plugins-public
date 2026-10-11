---
version: 0.6.143
date: 2026-10-11T14:34Z
pr: 758
---

- ru: Шаги «План → задача» и «Факт → задача» сами вписывают в задачу плановое и фактическое время и стоимость прогона
  en: The “Plan → task” and “Spend → task” steps write the run's planned and actual time and cost into the task by themselves
- ru: Шаги плана и факта сами встают во flow, где тред получает имя задачи и задача закрывается
  en: The plan and spend steps place themselves in every flow where the thread takes its task's name and the task gets closed
- ru: Команда bb flow-spend backfill дописывает время и стоимость прошлых прогонов в их задачи, не трогая числа, записанные агентами
  en: The bb flow-spend backfill command writes the time and cost of past runs into their tasks, keeping the figures agents typed
- ru: Прогон с несколькими задачами делит своё время и стоимость между ними поровну — в сумме не больше, чем потрачено
  en: A run with several tasks splits its time and cost between them evenly, so together they never show more than was spent
- ru: Сохранение flow агентом больше не стирает иконку, ограничения навыков и агентов и описание flow
  en: An agent saving a flow no longer wipes the flow's icon, skill and agent limits, and description
