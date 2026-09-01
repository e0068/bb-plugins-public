// Слой 3 (оболочка) — общий порт эффекта запуска git и разбор его вывода в
// читаемое сообщение. Используется всеми оркестраторами git-команд плагина
// (fast-forward.ts, local-main-pull.ts); сам процесс запускает git-client.ts.

export interface GitRun {
  code: number;
  stdout: string;
  stderr: string;
}

/** Единственный порт эффекта: выполнить git с argv и вернуть код и вывод. Не бросает на коде. */
export interface GitPorts {
  run(args: readonly string[]): Promise<GitRun>;
}

export function gitRunMessage(run: GitRun): string {
  const text = run.stderr.trim() || run.stdout.trim();
  return text === "" ? `код ${run.code}` : text;
}
