---
version: 0.6.205
date: 2026-10-30T09:34Z
pr: 887
---

- ru: Если агент отметил готовым этап, который стоит в прогоне раньше уже пройденных, Flow больше не теряет сигнал «carry on»: тред продолжает работу со следующего настоящего этапа, а не стоит до сообщения владельца
  en: When an agent marks a stage done that sits earlier in the run than already finished ones, Flow no longer loses the "carry on" signal: the thread continues from the real next stage instead of standing until the owner writes
