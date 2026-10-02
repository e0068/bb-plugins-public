---
version: 0.1.66
date: 2026-10-02T21:18Z
pr: 650
---

- ru: Окно подключения базы на сбое связи называет причину — база не ответила вовремя, ответила кодом HTTP, сеть оборвалась или ответ не читается, — а лог bb получает строку с адресом базы и этой причиной
  en: On a connection failure the Connect database dialog names the cause — no answer in time, an HTTP status, a dropped network or an unreadable reply — and the bb log gets a line with the database address and that cause
