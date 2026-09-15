import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Stage, Status, type StepResult, type TestResult } from 'allure-js-commons';
import { FileSystemWriter } from 'allure-js-commons/sdk/reporter';
import { saveEvent } from '../../core/events';
import { readAllSessionRecords, type SessionRecord } from './sessionLog';

// Запускается автоматически core/cli.ts после всех тестов, до сборки Allure-отчёта.
// Ядро не знает, что здесь происходит — это бизнес-проверка самого проекта:
// session id не должен повторяться у разных аккаунтов одного прогона.
//
// Почему не внутри теста: тесты идут параллельно и в разных процессах, поэтому тест физически
// не видит session id других тестов. Сравнить их можно только здесь, когда все уже отработали.
//
// Что делаем: в результат КАЖДОГО теста логина в Allure добавляем шаг
// «Session id уникален среди всех логинов прогона». Если session id совпал с другим аккаунтом,
// шаг и сам тест становятся упавшими, с перечислением, с кем именно совпало.
// Остальные тесты остаются зелёными.

const STEP_NAME = 'Session id уникален среди всех логинов прогона';

const records = readAllSessionRecords();
// Прогон был не про логин (например, api-load) — сверять нечего.
if (records.length === 0) process.exit(0);

// Группируем записи по session id. Записи без session id пропускаем: пустое значение означает
// неудачный вход, а два неудачных входа — не «одинаковый session id», и считать их дублем нельзя.
const bySessionId = new Map<string, SessionRecord[]>();
for (const record of records) {
  if (!record.sessionId) continue;
  const group = bySessionId.get(record.sessionId) ?? [];
  group.push(record);
  bySessionId.set(record.sessionId, group);
}

/** Другие записи прогона с тем же session id. Пустой список — session id уникален. */
function sameSessionIdAs(record: SessionRecord): SessionRecord[] {
  if (!record.sessionId) return [];
  return (bySessionId.get(record.sessionId) ?? []).filter(other => other.recordId !== record.recordId);
}

const recordsById = new Map(records.map(record => [record.recordId, record]));
const resultsDir = path.join(process.env.QA_RUN_DIR!, 'allure-results');
const writer = new FileSystemWriter({ resultsDir });
let checkedTests = 0;
let failedTests = 0;

// Результаты тестов Allure — обычные JSON-файлы. Отчёт из них ещё не собран, поэтому их можно
// дополнить: находим тест по метке session_record и дописываем в него шаг проверки.
for (const file of fs.readdirSync(resultsDir).filter(name => name.endsWith('-result.json'))) {
  const result = JSON.parse(fs.readFileSync(path.join(resultsDir, file), 'utf8')) as TestResult;
  const recordId = result.labels.find(label => label.name === 'session_record')?.value;
  const record = recordId ? recordsById.get(recordId) : undefined;
  if (!record || !record.sessionId) continue;

  checkedTests++;
  const duplicates = sameSessionIdAs(record);
  const now = Date.now();
  const step: StepResult = {
    name: STEP_NAME,
    status: duplicates.length ? Status.FAILED : Status.PASSED,
    statusDetails: {},
    stage: Stage.FINISHED,
    steps: [],
    attachments: [],
    parameters: [],
    start: now,
    stop: now,
  };

  if (duplicates.length) {
    failedTests++;
    const message = `Session id совпадает с: ${duplicates.map(other => `${other.login} (строка ${other.case_id})`).join(', ')}`;
    step.statusDetails = { message };

    const attachmentFile = `${randomUUID()}-attachment.json`;
    writer.writeAttachment(attachmentFile, Buffer.from(JSON.stringify({
      sessionId: record.sessionId,
      thisTest: { login: record.login, case_id: record.case_id },
      sameSessionIdAs: duplicates.map(other => ({ login: other.login, case_id: other.case_id })),
    }, null, 2)));
    step.attachments.push({ name: 'совпадения session id', source: attachmentFile, type: 'application/json' });

    // Если тест уже упал по другой причине, её не перетираем — просто добавляем шаг.
    if (result.status === Status.PASSED) {
      result.status = Status.FAILED;
      result.statusDetails = { message };
    }
  }

  // Ставим шаг перед служебным «After Hooks», чтобы в Allure он шёл сразу за шагами теста.
  const afterHooks = result.steps.findIndex(existing => existing.name === 'After Hooks');
  if (afterHooks === -1) result.steps.push(step);
  else result.steps.splice(afterHooks, 0, step);
  writer.writeResult(result);

  // То же событие — в Grafana, чтобы панель «Failed events» совпадала с Allure.
  saveEvent({
    kind: 'metric', test: result.name ?? '', case_id: record.case_id, iteration: record.iteration, retry: 0,
    name: 'check.login.sessionIdUnique', value: null, status: step.status!,
  });
}

// Ненулевой код возврата — как у любого упавшего теста: прогон с упавшими тестами не «зелёный».
if (failedTests) {
  console.error(`Session id повторяется: упавшими помечено тестов — ${failedTests} (подробности в Allure).`);
  process.exit(1);
}
console.log(`Session id: проверено тестов — ${checkedTests}, все уникальны.`);
