// kit/text.js — pure string helpers shared by the components' markup.
// Ported from public/cellular.js: escHTML (296), dimLabelHTML (298), capFirst (301).

// Escape the three HTML-significant characters for safe innerHTML interpolation.
export function escHTML(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

// Wrap the "dim" glyphs of a label (arrows, middot, phi) in <span class="dim"> so CSS can mute them.
export function dimLabelHTML(label) { return escHTML(label).replace(/([→←↔↕·φ]+)/g, '<span class="dim">$1</span>'); }

// Capitalize the first character; empty/nullish passes through unchanged.
export function capFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
