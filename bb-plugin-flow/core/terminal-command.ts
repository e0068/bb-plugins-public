// Слой 1 — чисто. Команда владельцу уходит в терминал одной строкой, а терминал берёт строку не длиннее предела:
// длиннее он обрезает, и выполняется кусок. Длинную команду отбиваем у агента с путём через скрипт.
import { TERMINAL_COMMAND_MAX_CHARS } from "../lib/agent-limits";

/** Отказ длинной команде: предел и путь через скрипт в хранилище треда; команда в пределе — `null`. */
export const terminalCommandIssue = (command: string, where: string): string | null =>
  command.length <= TERMINAL_COMMAND_MAX_CHARS
    ? null
    : `${where} is ${command.length} characters, and the owner's terminal takes a line of at most ${TERMINAL_COMMAND_MAX_CHARS}: the rest is cut off and only a piece of the command runs. Write the commands into a script file in the thread storage ($BB_THREAD_STORAGE) and hand the owner one short command that runs it, e.g. bash /path/to/thread-storage/run.sh.`;
