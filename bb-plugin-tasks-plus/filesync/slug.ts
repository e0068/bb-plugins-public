const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function transliterate(text: string): string {
  return Array.from(text.toLowerCase())
    .map((ch) => CYRILLIC_TO_LATIN[ch] ?? ch)
    .join("");
}

/** A title into a filename-safe slug: transliterated, lowercase, `a-z0-9-`
 *  only. Falls back to "task" when nothing alphanumeric survives. */
export function slugify(title: string): string {
  const base = transliterate(title)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return base.length > 0 ? base : "task";
}

/** A slug somebody typed for an existing file, checked the way a file name
 *  must be — non-empty, no path separators or whitespace, no leading dot,
 *  no `.md` tail, not already a file on the board (compared case-blind: the
 *  usual disk is case-insensitive). NOT passed through `slugify`: hand-written
 *  files carry Cyrillic and other characters `slugify` would never produce,
 *  and renaming to exactly what the author asked for is the point. */
export function validateSlug(raw: string, taken: ReadonlySet<string>): string {
  const slug = raw.trim();
  if (slug === "") throw new Error("slug must not be empty");
  if (/[\\/\s]/.test(slug) || slug.startsWith(".") || slug.endsWith(".md")) {
    throw new Error(
      `slug ${JSON.stringify(slug)} must be a bare file name: no path separators, whitespace, leading dot or .md`,
    );
  }
  const lower = slug.toLowerCase();
  for (const existing of taken) {
    if (existing.toLowerCase() === lower) throw new Error(`slug ${slug} is already taken on this board`);
  }
  return slug;
}

/** `slugify`, with a numeric suffix (`-2`, `-3`, …) added until the result
 *  isn't in `taken`. */
export function uniqueSlug(title: string, taken: ReadonlySet<string>): string {
  const base = slugify(title);
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}
