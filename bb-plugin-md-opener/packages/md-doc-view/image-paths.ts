// A picture written with an absolute file path — `![caption](/Users/…/shot.png)` — is taken by the engine as a ready
// address (SELF_SERVING in ../kasimov/kasimov.js): it never asks the image resolver, and the browser gets no file at
// that path. So the text is rewritten before the engine sees it: such a path goes through the resolver, and its answer
// stands in its place. What counts as code follows the engine, not CommonMark: a fenced block is opened and closed by
// any line starting with ``` (renderBody), and a picture inside backticks is still a picture (inlineDOM) — so only the
// fenced block is left as written, and so is an escaped `\![…](…)`.

const FENCE = /^\s*```/;
const IMAGE = /(\\?)(!\[[^\]]*\]\()([^)]*)(\))/g;

const resolveImages = (line: string, resolve: (src: string) => string | null): string =>
  line.replace(IMAGE, (whole, escape: string, head: string, src: string, tail: string) => {
    const url = escape === "" && src.startsWith("/") && !src.startsWith("//") ? resolve(src) : null;
    return url === null ? whole : `${head}${url}${tail}`;
  });

type Scan = { code: boolean; lines: readonly string[] };

/** The text with every picture's absolute file path outside fenced code swapped for the resolver's address; `null` keeps the path. */
export const resolveImagePaths = (text: string, resolve: (src: string) => string | null): string =>
  text
    .split("\n")
    .reduce<Scan>(
      ({ code, lines }, line) =>
        FENCE.test(line) ? { code: !code, lines: [...lines, line] } : { code, lines: [...lines, code ? line : resolveImages(line, resolve)] },
      { code: false, lines: [] },
    )
    .lines.join("\n");
