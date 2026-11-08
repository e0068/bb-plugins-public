---
version: 0.4.24
date: 2026-11-08T13:41Z
pr: 914
---

- ru: Расход треда без дочерних больше не теряется: запрос семьи тредов отдаёт и одиночный тред, и шаг Flow «Факт → задача» записывает в задачу его настоящие минуты и доллары, а не нули
  en: A thread that started no other threads no longer loses its spend: the thread family request returns a lone thread too, so the Flow step that writes spend into the task records its real minutes and dollars instead of zeros
