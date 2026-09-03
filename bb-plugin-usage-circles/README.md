# bb-plugin-usage-circles

Claude Code usage-limit rings in the footer of BB's left sidebar. The
indicator is two rings per limit window: the outer ring shows the used
share (colored by threshold: blue below 60%, yellow from 60%, red from
90%), the inner ring shows how much time has passed until the window
resets (a solid arc for the 5-hour window, seven day-segments for the
weekly one). Clicking expands a panel with one row per window: label,
percentage, usage bar, time bar, and reset time.

Data comes straight from BB itself — `bb.sdk.system.usageLimits()`; no
parsing of Claude Code's own files is needed.

## Layers

- [lib/usage-model.ts](lib/usage-model.ts) — layer 1, pure logic: parsing
  the SDK response, the window model (usage share, color, time share,
  time left until reset), no DOM.
- [lib/render.ts](lib/render.ts) — layer 2, rendering the model into two
  forms: the ring for the footer and the bar row for the panel.
- [lib/sidebar-widget.ts](lib/sidebar-widget.ts) — layer 3, assembling the
  widget in the sidebar footer, expanding the panel, polling state.
- [lib/usage-cache.ts](lib/usage-cache.ts) — a TTL cache that coalesces
  concurrent calls in front of Anthropic's account endpoint (tightly
  rate-limited).

Three switches in the plugin settings turn the individual window rings in
the footer on/off; they don't affect what's shown in the expanded panel.

## Development

```
npm install --include=dev
npm test
```
