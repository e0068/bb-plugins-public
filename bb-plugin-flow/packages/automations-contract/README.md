# @bb-plugins/automations-contract

Публичный вход плагина Automations (`bb-plugin-automations-builder`) глазами другого плагина: пути HTTP-маршрутов, формы запросов и ответов и клиент, который не бросает исключений. Сервер Automations отвечает этими формами, Flow зовёт их с сервера и с фронта.

| Маршрут | Запрос | Ответ |
| --- | --- | --- |
| `GET catalog` | — | Автоматизации с именем, включением и подписями шагов по порядку, каталоги триггеров, условий и действий |
| `POST emit` | `{ trigger, threadId, context?: { stageId } }` | Автоматизации с этим триггером срабатывают |
| `POST run` | `{ threadId, automationId }` или `{ threadId, actionId }` | `{ executed, skipped, error }` |

Маршруты открыты с проверкой `local`: запрос с сервера другого плагина ставит `origin` равным `bb.server.loopbackBaseUrl`, фронт зовёт относительный путь. Нет плагина — клиент отвечает `{ ok: false, reason: "not-installed" }`.

В пакете нет импортов вообще: он собирается внутрь обоих плагинов, а сторонний импорт в `packages/` ломает git-установку. Тест держит это обещание через `bundledImports` из `packages/layer-guard`.
