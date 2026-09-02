// Layer 1 — scaffolds for new config files and name normalization. Pure
// code with no I/O: input is a raw name from the user, output is a safe
// slug name and template text. Writing the file and picking the folder are
// in server.ts.
//
// A skill's or agent's name in Claude Code is a slug of lowercase Latin
// letters, digits and hyphens: it names the skill folder (`<name>/SKILL.md`)
// and the agent file (`<name>.md`), and it's also the value of the `name`
// field in frontmatter.

/**
 * Turns a raw name into a slug: lowercase Latin letters and digits,
 * separators collapsed into a single hyphen, leading/trailing hyphens
 * trimmed. An empty string means the input had no valid characters left —
 * the caller checks for that.
 */
export function slugifyName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A name is valid if its slug is non-empty (at least one Latin letter/digit). */
export function isValidName(raw: string): boolean {
  return slugifyName(raw).length > 0;
}

/**
 * Scaffold for a new skill's `SKILL.md`: a minimal valid frontmatter
 * (`name`, `description`) and a hint in the body. `name` is already a slug.
 */
export function skillTemplate(name: string): string {
  return [
    "---",
    `name: ${name}`,
    "description: Describe when to use this skill and what it does.",
    "---",
    "",
    `# ${name}`,
    "",
    "Describe the skill's instructions here.",
    "",
  ].join("\n");
}

/**
 * Scaffold for a new agent file: frontmatter with `name` and `description`
 * and a body that's the system prompt. `name` is already a slug.
 */
export function agentTemplate(name: string): string {
  return [
    "---",
    `name: ${name}`,
    "description: Describe when to invoke this agent and what it does.",
    "---",
    "",
    "Describe the agent's system prompt here: its role, tasks and constraints.",
    "",
  ].join("\n");
}
