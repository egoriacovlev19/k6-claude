import path from 'node:path';
import { Status, Stage } from 'allure-js-commons';
import { ReporterRuntime, FileSystemWriter } from 'allure-js-commons/sdk/reporter';
import { readAllSessionRecords, type SessionRecord } from './sessionLog';

// Запускается автоматически core/cli.ts после всех тестов, до сборки Allure-отчёта.
// Ядро не знает, что здесь происходит — это бизнес-проверка самого проекта:
// session id не должен повторяться у разных аккаунтов одного прогона.
//
// Почему отдельным файлом, а не внутри теста: тесты идут параллельно и в разных процессах,
// поэтому тест физически не видит session id других тестов. Сравнить их можно только тут,
// когда все уже отработали и записали свои значения.

const records = readAllSessionRecords();
// Прогон был не про логин (например, api-load) — сверять нечего.
if (records.length === 0) process.exit(0);

// Группируем аккаунты по session id: группа больше одного — это совпадение.
// Записи без session id пропускаем: пустое значение означает неудачный вход,
// а два неудачных входа — не «одинаковый session id», и считать их дублем нельзя.
const bySessionId = new Map<string, SessionRecord[]>();
for (const record of records) {
  if (!record.sessionId) continue;
  const group = bySessionId.get(record.sessionId) ?? [];
  group.push(record);
  bySessionId.set(record.sessionId, group);
}

const duplicates = [...bySessionId.values()].filter(group => group.length > 1);
const checkedCount = records.filter(record => record.sessionId).length;

// Пишем результат как обычный тест Allure — тем же SDK, что и остальной фреймворк,
// чтобы он появился в отчёте рядом с UI-тестами.
const runtime = new ReporterRuntime({
  writer: new FileSystemWriter({ resultsDir: path.join(process.env.QA_RUN_DIR!, 'allure-results') }),
});
const uuid = runtime.startTest({
  name: 'Session id уникален для каждого логина',
  fullName: 'orange.session-id-uniqueness',
  start: Date.now(),
});
runtime.updateTest(uuid, result => {
  result.status = duplicates.length ? Status.FAILED : Status.PASSED;
  result.stage = Stage.FINISHED;
  result.statusDetails = {
    message: duplicates.length
      ? `Совпадающий session id у: ${duplicates.map(group => group.map(record => record.login).join(' и ')).join('; ')}`
      : `Проверено логинов: ${checkedCount}, все session id уникальны`,
  };
});
runtime.writeAttachment(uuid, undefined, 'session-ids', Buffer.from(JSON.stringify(records, null, 2)), { contentType: 'application/json' });
runtime.stopTest(uuid, { stop: Date.now() });
runtime.writeTest(uuid);

// Ненулевой код возврата помечает весь прогон упавшим — иначе совпадение
// осталось бы только в отчёте, и его легко было бы не заметить.
if (duplicates.length) {
  console.error('Session id повторяется:', JSON.stringify(duplicates, null, 2));
  process.exit(1);
}
