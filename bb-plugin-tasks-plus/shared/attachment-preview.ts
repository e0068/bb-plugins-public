/** How an attachment opens in place: markdown rendered, any other text as written; absent — it downloads. */
export type AttachmentPreviewKind = "markdown" | "text";

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);

/** Text a person reads as written: notes, data, logs and source code. */
const TEXT_EXTENSIONS = new Set([
  "txt", "log", "csv", "tsv", "json", "jsonl", "yaml", "yml", "toml", "ini", "env", "xml", "html", "css", "sql",
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt", "swift", "c", "h", "cpp", "cs",
  "php", "sh", "zsh", "bash", "gd", "lua",
]);

/** MIME types of text outside `text/*`. */
const TEXT_MIMES = new Set(["application/json", "application/xml", "application/x-yaml", "application/toml"]);

const extensionOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot + 1).toLowerCase();
};

/**
 * The name decides first — a browser often sends no type for `.md` and `.log`, and the server then stores
 * `application/octet-stream`; the type covers a text file whose name says nothing.
 */
export function attachmentPreviewKind(fileName: string, mime: string): AttachmentPreviewKind | undefined {
  const extension = extensionOf(fileName);
  const type = mime.split(";", 1)[0]!.trim().toLowerCase();
  if (MARKDOWN_EXTENSIONS.has(extension) || type === "text/markdown") return "markdown";
  if (TEXT_EXTENSIONS.has(extension) || type.startsWith("text/") || TEXT_MIMES.has(type)) return "text";
  return undefined;
}
