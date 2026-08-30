// Слой 3 — точка эффекта: чтение токена из авторизованного `gh` на машине bb.
// `gh auth token` печатает валидный bearer-токен для api.github.com; так PR
// открывается без личного токена в настройках. Ошибку (нет gh / не залогинен)
// глушим в null — выше это станет понятным сообщением пользователю.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function ghAuthToken(): Promise<string | null> {
  try {
    const { stdout } = await run("gh", ["auth", "token"], { timeout: 5000 });
    const token = stdout.trim();
    return token === "" ? null : token;
  } catch {
    return null;
  }
}
