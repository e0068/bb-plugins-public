---
version: 0.1.72
date: 2026-10-05T12:25Z
pr: 698
---

- ru: Tasks+ запускается и показывает все проекты, даже когда база одной доски отвергает токен или не отвечает: остальные доски работают, ошибку показывает только эта доска
  en: Tasks+ starts and lists every project even when one board's database refuses its token or does not answer: the other boards work, and only that board shows the error
- ru: Пустая плитка аналитики без фильтра пишет «Nothing happened in this period» вместо «No tasks match this chart's filter»
  en: An empty analytics tile without a filter says «Nothing happened in this period» instead of «No tasks match this chart's filter»
- ru: Доска в онлайн-базе с отозванным токеном пишет «Token refused» вместо «Live», а новый токен принимает Connect database на тот же адрес — доска остаётся той же, с историей
  en: A database board whose token was revoked says «Token refused» instead of «Live», and Connect database on the same address takes a new token — the board stays the same, history included
- ru: В окне Connect database у поля токена есть ссылка Open app.turso.tech — кабинет Turso открывается в браузере, как остальные ссылки bb
  en: The Connect database dialog links Open app.turso.tech next to the token field — the Turso dashboard opens in the browser, like other bb links
