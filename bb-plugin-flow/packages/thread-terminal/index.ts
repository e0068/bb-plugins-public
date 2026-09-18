// Доставка команды в терминал треда — общая для Apply Bash и Flow. Знает
// про терминалы bb, но не про markdown, rpc и плагин: на вход готовая команда,
// на выход что случилось. Без сторонних импортов — пакет собирается внутрь
// плагина при git-установке.

/** Состояния, в которых терминал ещё способен принять ввод. */
const LIVE_STATUSES = new Set(["running", "starting"]);

export interface TerminalSession {
  id: string;
  status: string;
  updatedAt: number;
}

/**
 * Узкий срез bb.sdk: только терминалы и только те три метода, что нужны
 * применению. Так слой тестируется заглушкой, а не фейковым хостом целиком.
 */
export interface TerminalsSdk {
  terminals: {
    list(args: {
      scope: { kind: "thread"; threadId: string };
    }): Promise<{ sessions: TerminalSession[] }>;
    create(args: {
      cols: number;
      rows: number;
      scope: { kind: "thread"; threadId: string };
    }): Promise<{ id: string }>;
    input(args: { terminalId: string; dataBase64: string }): Promise<unknown>;
  };
}

export interface ApplyResult {
  terminalId: string;
  /** Терминала в треде не было и он создан этим применением. */
  created: boolean;
}

/** Размер нового терминала. Значения — обычное дефолтное окно pty. */
const NEW_TERMINAL_COLS = 120;
const NEW_TERMINAL_ROWS = 30;

/**
 * Отправляет команду в терминал треда: в самый свежий живой, а если живых
 * нет — в созданный на месте.
 *
 * Завершённый терминал (`exited`) ввод молча проглотит, поэтому выбираем
 * только `running`/`starting`. Команда уходит с `\r` на конце: pty ждёт
 * возврат каретки, а с `\n` строка появится в терминале, но не выполнится.
 */
export async function applyToTerminal(
  sdk: TerminalsSdk,
  args: { threadId: string; command: string },
): Promise<ApplyResult> {
  const command = args.command.trim();
  if (command === "") throw new Error("Пустая команда");

  const scope = { kind: "thread", threadId: args.threadId } as const;
  const { sessions } = await sdk.terminals.list({ scope });

  const live = sessions
    .filter((session) => LIVE_STATUSES.has(session.status))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];

  const target =
    live ??
    (await sdk.terminals.create({
      cols: NEW_TERMINAL_COLS,
      rows: NEW_TERMINAL_ROWS,
      scope,
    }));

  await sdk.terminals.input({
    terminalId: target.id,
    dataBase64: Buffer.from(command + "\r", "utf8").toString("base64"),
  });

  return { terminalId: target.id, created: live === undefined };
}
