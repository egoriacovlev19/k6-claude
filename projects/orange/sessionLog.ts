import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Журнал session id за один прогон: тесты пишут сюда свои значения, after-run.ts потом
// сверяет их между собой. Лежит в проекте, а не в core: только Orange знает про этот cookie
// и только Orange решает, что с ним делать.

/** Что запомнили про один вход: под каким аккаунтом и какой session id выдал сайт. */
export interface SessionRecord {
  recordId: string;         // Уникальный id записи. Им же помечен результат теста в Allure.
  case_id: string;          // Номер строки CSV.
  iteration: number;        // Номер повтора прогона (при repeats > 1 одна строка идёт несколько раз).
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
 * Дописывает одну запись и возвращает её id.
 *
 * Тест должен поставить этот id меткой на свой результат в Allure (см. login-form.spec.ts) —
 * по нему after-run.ts найдёт именно этот тест, если его session id совпадёт с другим.
 *
 * Каждый процесс пишет в свой файл (по pid) — тот же приём, что и в core/events.ts.
 * Так параллельные тесты не перетирают записи друг друга и результат не «съезжает».
 */
export function appendSessionRecord(record: Pick<SessionRecord, 'case_id' | 'login' | 'password' | 'sessionId'>): string {
  const full: SessionRecord = {
    recordId: randomUUID(),
    iteration: Number(process.env.QA_ITERATION || 0),
    ...record,
  };
  fs.appendFileSync(path.join(directory(), `${process.pid}.jsonl`), JSON.stringify(full) + '\n');
  return full.recordId;
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
