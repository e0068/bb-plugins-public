// What the preview window's footer says about a thread: where it runs, how its
// agent runs, and what became of its work. Layer 1, no effects and no SDK —
// the shell gathers the facts from the sidebar view and the backend.

export interface ExecutionFacts {
  model: string;
  reasoningLevel: string;
  permissionMode: string;
}

export interface GitFacts {
  commitsAhead: number;
  uncommitted: boolean;
}

export interface PullRequestFacts {
  number: number;
  state: "closed" | "draft" | "merged" | "open";
}

export interface FooterInput {
  projectName: string;
  branchName: string | null;
  inWorktree: boolean;
  hostName: string | null;
  execution: ExecutionFacts | null;
  git: GitFacts | null;
  pullRequest: PullRequestFacts | null;
}

export interface Footer {
  place: readonly string[];
  execution: readonly string[];
  work: readonly string[];
}

const EFFORT: Readonly<Record<string, string>> = {
  none: "нет",
  low: "низкое",
  medium: "среднее",
  high: "высокое",
  xhigh: "очень высокое",
  max: "максимальное",
};

const MODE: Readonly<Record<string, string>> = {
  readonly: "только чтение",
  "accept-edits": "правки без подтверждения",
  "workspace-write": "запись в рабочей папке",
  auto: "авто",
  full: "полный доступ",
};

const PULL_REQUEST: Readonly<Record<PullRequestFacts["state"], string>> = {
  open: "открыт",
  draft: "черновик",
  merged: "смёржен",
  closed: "закрыт",
};

// The host grows these enums over time; an unknown value is shown as it is.
const say = (labels: Readonly<Record<string, string>>, value: string) =>
  labels[value] ?? value;

const present = (items: readonly (string | null | false)[]): string[] =>
  items.filter((item): item is string => typeof item === "string" && item.length > 0);

export function describeFooter(input: FooterInput): Footer {
  const { execution, git, pullRequest } = input;
  return {
    place: present([
      input.projectName,
      input.inWorktree && input.branchName,
      input.hostName,
    ]),
    execution: execution
      ? [
          execution.model,
          `усилие ${say(EFFORT, execution.reasoningLevel)}`,
          `режим ${say(MODE, execution.permissionMode)}`,
        ]
      : [],
    work: present([
      git && (git.commitsAhead > 0 ? `коммитов: ${git.commitsAhead}` : "коммитов нет"),
      git?.uncommitted === true && "есть незакоммиченные правки",
      pullRequest && `PR #${pullRequest.number} ${PULL_REQUEST[pullRequest.state]}`,
    ]),
  };
}
