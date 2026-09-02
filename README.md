# e0068/bb-plugins-public

Публичная витрина bb-плагинов. Собирается автоматически из приватного монорепо —
править здесь руками не нужно.

## Установка

```
bb marketplace add git:github.com/e0068/bb-plugins-public@main
bb plugin install <id>@e0068
```

## Плагины

- **Claude Config** (`claude-config`) — Manage Claude Code config: plugins, connectors, skills, hooks and tool loading, per scope.
- **Kasimov** (`md-opener`) — Opens .md files with the Kasimov editor: markdown links inside are clickable and navigate within the same tab, with breadcrumbs and a back button. Edits are saved with CAS protection.
- **Tasks+** (`tasks-plus`) — Fork of Tasks with native workflow fields: Type, Check, Estimate, Plan/Fact tokens.
- **Token Usage Analytics** (`token-usage-header`) — Claude Code token usage for the current session: a counter in the thread header.
- **Usage Circles** (`usage-circles`) — Claude Code usage-limit rings in the sidebar footer.
- **Pull Request** (`zz-pull-request`) — Thread header buttons: opens a Pull Request on GitHub via the API without a push once everything is committed, and wakes up a thread whose environment got stuck retiring.
