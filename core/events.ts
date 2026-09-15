import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Одна запись о прогоне: либо измеренная метрика, либо результат теста. */
export interface Event {
  id: string;            // Уникальный id записи.
  timestamp: string;     // Момент записи, ISO-строка.
  run_id: string;        // Общий id прогона — одинаковый у всех записей одного запуска.
  project: string;       // Имя папки из projects/.
  environment: string;   // Окружение (--env), например production.
  suite: string;         // ui, api или api-load.
  test: string;          // Название теста.
  case_id: string;       // Идентификатор кейса (строка тест-данных).
  iteration: number;     // Номер повтора, если прогон повторяется.
  retry: number;         // Номер ретрая Playwright.
  kind: 'metric' | 'test';
  name: string;          // Имя метрики (page.login.ready) или события (test.duration).
  value: number | null;  // Значение в миллисекундах; null — измерение не удалось.
  status: string;        // passed / failed / skipped.
}

/**
 * Дописывает событие в журнал прогона (`artifacts/events/<pid>.jsonl`).
 *
 * Каждый процесс пишет в свой файл — поэтому параллельные Playwright-воркеры не мешают
 * друг другу и не портят записи. Позже prometheus.ts собирает из всех файлов один metrics.prom.
 *
 * Общие поля (какой прогон, проект, окружение) берутся из переменных окружения, которые
 * выставляет core/cli.ts — вызывающему коду их передавать не нужно.
 */
export function saveEvent(event: Omit<Event, 'id' | 'timestamp' | 'run_id' | 'project' | 'environment' | 'suite'>): void {
  const directory = process.env.QA_RUN_DIR;
  if (!directory) throw new Error('Run tests using npm run qa');

  fs.mkdirSync(path.join(directory, 'events'), { recursive: true });
  const full: Event = {
    ...event,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    run_id: process.env.QA_RUN_ID!,
    project: process.env.QA_PROJECT!,
    environment: process.env.QA_ENV!,
    suite: process.env.QA_SUITE!,
  };
  fs.appendFileSync(path.join(directory, 'events', `${process.pid}.jsonl`), JSON.stringify(full) + '\n');
}
