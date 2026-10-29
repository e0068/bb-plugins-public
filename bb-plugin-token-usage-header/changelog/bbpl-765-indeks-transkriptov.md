---
version: 0.4.20
date: 2026-10-26T12:46Z
pr: 849
---

- ru: Широкие срезы расхода — по дням, агентам, моделям и лента тредов — больше не перечитывают всю историю транскриптов: индекс на диске дочитывает только новое, и запрос, который шёл полторы минуты, отвечает за пару секунд.
  en: Wide usage slices — by day, agent, model and the threads timeline — no longer re-read the whole transcript history: an on-disk index reads only what is new, and a query that took a minute and a half answers in a couple of seconds.
