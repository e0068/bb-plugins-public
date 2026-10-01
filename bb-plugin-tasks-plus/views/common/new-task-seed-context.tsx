import { createContext, useContext, useEffect } from "react";
import type { NewTaskSeed } from "./new-task-seed.js";

/**
 * How a list hands its new-task draft up to the shell, whose New task button
 * and "c" key sit above the list and never see its filters. The default does
 * nothing, so a list rendered without the shell (tests, embeds) still works.
 */
export const NewTaskSeedContext = createContext<
  (seed: NewTaskSeed | null) => void
>(() => {});

/** Publishes the list's draft while it is mounted, and withdraws it after. */
export function usePublishNewTaskSeed(seed: NewTaskSeed): void {
  const publish = useContext(NewTaskSeedContext);
  useEffect(() => {
    publish(seed);
  }, [publish, seed]);
  useEffect(() => () => publish(null), [publish]);
}
