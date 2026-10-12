---
version: 0.6.146
date: 2026-10-12T00:38Z
pr: 769
---

- ru: У каждого flow на странице Flow — блок «Агент»: своя модель с effort и стартовое сообщение агенту; «Автоматически» стал строкой списка со своим агентом
  en: Every flow on the Flow page has an Agent block — its own model with effort and a start message for the agent; Automatic is now a list row with its own agent
- ru: Тред flow стартует с моделью и стартовым сообщением своего flow, а тред с «Автоматически» после выбора flow больше не начинается заново — первое сообщение не повторяется
  en: A flow's thread starts with that flow's model and start message, and an Automatic thread no longer restarts after the flow is chosen — your first message is not sent again
