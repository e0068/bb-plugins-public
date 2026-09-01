# e0068/bb-plugins-public

Публичная витрина bb-плагинов. Собирается автоматически из приватного монорепо —
править здесь руками не нужно.

## Установка

```
bb marketplace add git:github.com/e0068/bb-plugins-public@main
bb plugin install <id>@e0068
```

## Плагины

- **Claude Config** (`claude-config`) — Управление конфигом Claude Code: плагины, коннекторы, навыки, хуки и подгрузка инструментов по областям.
- **Kasimov** (`md-opener`) — Открывает .md-файлы редактором Kasimov: markdown-ссылки внутри кликабельны и ведут в той же вкладке, с крошками и возвратом. Правка сохраняется с CAS-защитой.
- **Tasks+** (`tasks-plus`) — Fork of Tasks with native workflow fields: Type, Check, Estimate, Plan/Fact tokens.
- **Token Usage Analytics** (`token-usage-header`) — Расход токенов Claude Code текущей сессии: счётчик в шапке треда.
- **Usage Circles** (`usage-circles`) — Кольца лимитов Claude Code в подвале сайдбара.
- **Pull Request** (`zz-pull-request`) — Кнопка Pull Request в шапке треда: когда всё закоммичено, открывает PR на GitHub через API без push.
