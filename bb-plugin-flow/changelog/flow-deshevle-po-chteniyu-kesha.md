---
version: 0.6.180
date: 2026-10-26T09:08Z
pr: 838
---

- ru: Flow дешевле работает с длинными тредами: между этапами он сам сжимает контекст (жёлтая зона теперь с 150 тыс. токенов, красная с 300 тыс.) и ставит реализации и тестированию Sonnet, остальным этапам — Opus; бриф старше часа открывается с выбранным «сжать»; баннер показывает цену и у Вопросов, Definition of Done, Выбора этапов, Демонстрации и Утверждения; шапка Flow в каждом вызове вдвое короче
  en: Flow is cheaper on long threads: between stages it compacts the context itself (yellow now from 150k tokens, red from 300k) and puts Sonnet on implementation and testing and Opus on the other stages; a brief older than an hour opens with "compact" chosen; the banner shows a price on Questions, Definition of Done, stage selection, demonstration and approval too; Flow's header in every call is twice as short
