# BB Plugins Public

Публичные плагины для [bb](https://getbb.app) от e0068 и команды. Здесь их можно
дорабатывать совместно, а помеченные — устанавливать через marketplace.

## Установка

```
bb marketplace add git:github.com/e0068/bb-plugins-public@main
bb plugin install <id>@e0068
```

Например: `bb plugin install usage-circles@e0068`.

## Плагины

- **Token Usage Header** (`token-usage-header`) — расход токенов Claude Code
  текущей сессии: счётчик в шапке треда.
- **Usage Circles** (`usage-circles`) — кольца лимитов Claude Code в подвале
  сайдбара.

## Витрина (marketplace)

Файл [marketplace.json](marketplace.json) — витрина bb. Он **генерируется**, а не
правится руками:

```
node scripts/build-marketplace.mjs          # пересобрать marketplace.json
node scripts/build-marketplace.mjs --check    # проверить, что файл актуален (для CI)
```

Плагин попадает на витрину только если в его `package.json` есть маркер:

```json
"bbMarketplace": { "public": true, "tags": ["…"] }
```

Плагин без маркера остаётся в репозитории как исходник для команды, но не
публикуется и не устанавливается.
