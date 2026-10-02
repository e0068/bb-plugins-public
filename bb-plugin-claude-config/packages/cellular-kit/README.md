# @bb-plugins/cellular-kit

Вендоренная копия kit дизайн-системы [Cellular](https://github.com/e0068/Cellular) и типизированный фасад над её фабриками.

## Слои

| Слой | Где | Что |
|---|---|---|
| 0 | `vendor/` | копия kit с CDN `cell-ds.web.app`: фабрики (`button`, `input`, `segment`, `toggle`, `uiMenu`, `uiCell`), `components.css`, рантайм темы, `manifest.json` с версией и sha256 каждого файла |
| 1 | `index.ts` | типы поверх фабрик (`ButtonProps`, `MenuSpec`, …) и `version` из манифеста |

## Правила

- **`vendor/` руками не правится.** Копию кладёт и обновляет апдейтер самой Cellular: `npm run update` (это `scripts/update-cellular-kit.mjs` в корне репозитория). Апдейтер идемпотентен по версии и падает на несовпадении sha256, не портя лежащую копию. Тест `vendor-integrity.test.ts` сверяет каждый файл с манифестом — правка руками роняет его.
- Поведение компонентов живёт в kit; фасад добавляет только типы. Нашёл дефект в компоненте — чини в репозитории Cellular и обновляй копию.
- Стили kit (`vendor/components.css`) подключаются не отсюда, а через `packages/cellular-react/styles.css`, где за ними идёт мост токенов bb.

## Тесты

```bash
npm test
```
