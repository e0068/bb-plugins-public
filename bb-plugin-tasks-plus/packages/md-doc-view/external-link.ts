// Pure layer: does a link leave the app? A web page or a mail address — only
// these two schemes; `javascript:`, `file:` and the rest are neither followed
// in the tab nor handed to the browser. Lives here, not in link-navigation:
// this package takes path resolution from its consumer and depends on no
// resolver of its own (README, "Link and path resolution is injected").
export function isExternalLink(href: string): boolean {
  return /^(https?|mailto):/i.test(href);
}
