---
version: 0.6.178
date: 2026-10-26T08:17Z
pr: 832
---

- ru: Агент больше не отдаёт команду длиннее 1024 символов, которую терминал обрезал бы: длинное он кладёт скриптом в хранилище треда и даёт одну короткую команду для запуска
  en: The agent no longer hands over a command longer than 1024 characters that the terminal would cut off: it puts the long part into a script in the thread storage and gives one short command that runs it
