// Layer 1 — what a git command returned, as the pure readers see it. Zero
// effects.
//
// Its own module rather than a field of whichever reader needed it first: the
// exit code and stdout are the shared shape EVERY git reader parses, and
// hanging it off one of them (it used to live in merged-content.ts) made
// unrelated readers import a neighbour they have nothing to do with. The shell
// maps its own `GitRun` — which also carries stderr — onto this.

export interface CommandOutcome {
  code: number;
  stdout: string;
}
