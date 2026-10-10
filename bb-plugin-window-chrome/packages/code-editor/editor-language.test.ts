import { describe, expect, it } from "vitest";
import { languageOf } from "./editor-language";

describe("languageOf", () => {
  it.each([
    ["src/a.ts", "typescript"],
    ["src/a.mts", "typescript"],
    ["src/a.tsx", "tsx"],
    ["lib/a.js", "javascript"],
    ["lib/a.mjs", "javascript"],
    ["lib/a.cjs", "javascript"],
    ["ui/a.jsx", "jsx"],
    ["package.json", "json"],
    ["tsconfig.jsonc", "json"],
    ["app.css", "css"],
    ["index.html", "html"],
    ["index.htm", "html"],
    ["README.md", "markdown"],
    ["doc.mdx", "markdown"],
    [".bb/config.yml", "yaml"],
    ["ci.yaml", "yaml"],
    ["scripts/x.sh", "shell"],
    ["scripts/x.bash", "shell"],
    ["scripts/x.zsh", "shell"],
  ] as const)("%s → %s", (path, language) => {
    expect(languageOf(path)).toBe(language);
  });

  it("is case-blind on the extension", () => {
    expect(languageOf("NOTES.MD")).toBe("markdown");
  });

  it("is null for an extension it does not know", () => {
    expect(languageOf("image.png")).toBeNull();
  });

  it("is null for a file with no extension", () => {
    expect(languageOf("Makefile")).toBeNull();
    expect(languageOf(".gitignore")).toBeNull();
  });

  it("reads the extension off the name, not off a dotted directory", () => {
    expect(languageOf("v1.2/README")).toBeNull();
  });
});
