import fs from 'node:fs';
import path from 'node:path';

// Журнал session id за один прогон: тесты пишут сюда свои значения, after-run.ts потом
// сверяет их между собой. Лежит в проекте, а не в core: только Orange знает про этот cookie
// и только Orange решает, что с ним делать.

/** Что запомнили про один вход: под каким аккаунтом и какой session id выдал сайт. */
export interface SessionRecord {
  case_id: string;
  login: string;
  password: string;
  sessionId: string | null; // null — вход не удался, cookie не появился.
}

/** Папка журнала внутри артефактов прогона. */
function directory(): string {
  const dir = path.join(process.env.QA_RUN_DIR!, 'session-ids');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Дописывает одну запись.
 *
 * Каждый процесс пишет в свой файл (по pid) — тот же приём, что и в core/events.ts.
 * Так параллельные тесты не перетирают записи друг друга и результат не «съезжает».
 */
export function appendSessionRecord(record: SessionRecord): void {
  fs.appendFileSync(path.join(directory(), `${process.pid}.jsonl`), JSON.stringify(record) + '\n');
}

/** Читает записи всех процессов. Вызывать только после того, как тесты завершились. */
export function readAllSessionRecords(): SessionRecord[] {
  const dir = path.join(process.env.QA_RUN_DIR!, 'session-ids');
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter(file => file.endsWith('.jsonl'))
    .flatMap(file => fs.readFileSync(path.join(dir, file), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as SessionRecord));
}
