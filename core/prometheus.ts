import fs from 'node:fs';
import path from 'node:path';
import type { Event } from './events';

// Prometheus читает обычный текстовый файл metrics.prom через маленький exporter
// (infra/prometheus/exporter.js), поэтому отдельная база данных для метрик не нужна.

/** Экранирует значение, чтобы оно не сломало синтаксис лейбла Prometheus. */
function escapeLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', ' ');
}

/** Собирает лейблы в строку вида `key="value",key2="value2"`. */
function formatLabels(event: Event): string {
  const labels: Record<string, string | number> = {
    project: event.project,
    environment: event.environment,
    suite: event.suite,
    test: event.test,
    case_id: event.case_id,
    name: event.name,
    status: event.status,
    iteration: event.iteration,
    retry: event.retry,
    event_id: event.id,
  };
  return Object.entries(labels)
    .map(([key, value]) => `${key}="${escapeLabel(String(value))}"`)
    .join(',');
}

/** Читает все события прогона из `artifacts/events/*.jsonl`. */
function readEvents(eventsDirectory: string): Event[] {
  const events: Event[] = [];
  for (const file of fs.readdirSync(eventsDirectory)) {
    if (!file.endsWith('.jsonl')) continue;
    for (const line of fs.readFileSync(path.join(eventsDirectory, file), 'utf8').split('\n').filter(Boolean)) {
      events.push(JSON.parse(line) as Event);
    }
  }
  return events;
}

/**
 * Пересобирает `artifacts/metrics.prom` из всех событий прогона.
 *
 * Пишем через временный файл и переименование: Prometheus может читать файл в любой момент,
 * а переименование атомарно — он никогда не увидит наполовину записанный файл.
 */
export function writePrometheusFile(directory: string): void {
  const eventsDirectory = path.join(directory, 'events');
  if (!fs.existsSync(eventsDirectory)) return;

  const lines = [
    '# HELP qa_event_value Value recorded by a QA test.',
    '# TYPE qa_event_value gauge',
    '# HELP qa_event_status Whether the QA event passed (1) or failed (0).',
    '# TYPE qa_event_status gauge',
  ];
  for (const event of readEvents(eventsDirectory)) {
    const labels = formatLabels(event);
    const timestamp = Date.parse(event.timestamp);
    lines.push(`qa_event_status{${labels}} ${event.status === 'passed' ? 1 : 0} ${timestamp}`);
    if (event.value !== null) lines.push(`qa_event_value{${labels}} ${event.value} ${timestamp}`);
  }

  const temporaryFile = path.join(directory, 'metrics.prom.tmp');
  fs.writeFileSync(temporaryFile, `${lines.join('\n')}\n`);
  fs.renameSync(temporaryFile, path.join(directory, 'metrics.prom'));
}
