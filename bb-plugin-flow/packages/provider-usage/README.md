# Provider usage

`core/` contains pure transcript normalization and standard API rates (USD per million: input, output, cache read, cache write 5m/1h). `shell/` reads native files and projects them into isolated Claude-compatible JSONL for Analytics and Flow. Original transcripts are never changed.

Codex cumulative snapshots are deduplicated; local durable compaction requests are billed separately because they are excluded from those snapshots. Nested native agents are attributed to their root session. Projection timestamps preserve source recency and removed source sessions are evicted from the cache.

Supported sources: `CODEX_HOME/sessions` (default `~/.codex/sessions`), `~/.kimi/sessions`, `KIMI_CODE_HOME/sessions` (default `~/.kimi-code/sessions`). Legacy Kimi records without historical model metadata retain an unknown model; today's config and mutable subscription aliases are not used to invent a historical API price.

Rates checked 2026-10-11: [OpenAI standard API rates](https://developers.openai.com/api/docs/pricing), [Kimi API rates](https://platform.kimi.ai/docs/pricing/chat). Unknown models retain their tokens and are listed as unpriced. Cost excludes tools, taxes, and regional processing charges. API rates are an equivalent usage estimate for subscription sessions.

Run `python3 -m unittest discover -s packages/provider-usage -p 'test_*.py'` from the repository root. TypeScript contracts are tested with the consuming plugins. Marketplace publication vendors the package using the plugins' explicit TypeScript imports, including Python and JSON assets.
