---
version: 0.6.188
date: 2026-10-27T09:04Z
pr: 856
---

- ru: Тред больше не зависает на границе этапов: если Flow пообещал «carry on» и сигнал не дошёл, через минуту он приходит сам, а два обещания подряд обслуживаются одним сигналом с моделью нового этапа
  en: A thread no longer stalls at a stage boundary: if Flow promised "carry on" and the signal never arrived, it is sent on its own after a minute, and two promises in a row are served by one signal with the new stage's model
