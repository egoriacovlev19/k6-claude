import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { Status, Stage } from 'allure-js-commons';
import { ReporterRuntime, FileSystemWriter } from 'allure-js-commons/sdk/reporter';
import { loadProject, type ProjectConfig } from './config';
import { readCases } from './data';
import { loadEnvFile } from './env';
import { errorDetails } from './errors';
import { saveEvent } from './events';
import { writePrometheusFile } from './prometheus';

// Точка входа фреймворка (npm run qa). Запускает тесты любого проекта из projects/
// и собирает результаты: Allure-отчёт и метрики для Grafana.

/** Какой набор тестов запускаем. */
type Suite = 'ui' | 'api' | 'api-load';

/** Аргументы командной строки. */
interface CliArgs {
  project: string;  // Имя папки из projects/.
  env: string;      // Ключ из environments в конфиге проекта.
  suite: Suite;
  profile: string;  // Ключ из profiles в конфиге проекта.
  data?: string;    // Путь к CSV с тест-данными (не обязателен).
}

/** Один профиль прогона из конфига проекта. */
type Profile = ProjectConfig['profiles'][string];

/** Стал ли прогон прерванным (Ctrl+C) — влияет на итоговый статус в run.json. */
let interrupted = false;

/**
 * Запускает внешнюю программу (Playwright, k6, allure) и ждёт её завершения.
 *
 * Запускаем без оболочки (shell), напрямую — так аргументы не нужно экранировать
 * и не получится случайно выполнить лишнюю команду. Ctrl+C пробрасываем дочернему
 * процессу, чтобы он успел корректно завершиться.
 */
async function command(binary: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: 'inherit', env });

    const stop = () => {
      interrupted = true;
      child.kill('SIGTERM');
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);

    const cleanup = () => {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    };

    child.once('error', error => { cleanup(); reject(error); });
    child.once('exit', code => { cleanup(); resolve(interrupted ? 130 : code ?? 1); });
  });
}

/** Разбирает и проверяет аргументы командной строки. */
function parseCliArgs(): CliArgs {
  const { values } = parseArgs({
    options: {
      project: { type: 'string' },
      env: { type: 'string' },
      suite: { type: 'string', default: 'ui' },
      profile: { type: 'string' },
      data: { type: 'string' },
    },
  });

  if (!values.project) throw new Error('Укажите --project <имя папки из projects/>');
  if (!values.env) throw new Error('Укажите --env <окружение из environments в project.config.ts>');
  if (!values.profile) throw new Error('Укажите --profile <профиль из profiles в project.config.ts>');
  if (!['ui', 'api', 'api-load'].includes(values.suite!)) throw new Error('suite must be ui, api or api-load');

  return {
    project: values.project,
    env: values.env,
    suite: values.suite as Suite,
    profile: values.profile,
    data: values.data,
  };
}

/**
 * Собирает переменные окружения для дочерних процессов (Playwright, k6, after-run).
 * Через них тесты узнают, что за прогон идёт и куда складывать результаты.
 *
 * QA_DATA (CSV) передаётся любому набору тестов, включая api-load: читать его или нет —
 * решает сам k6-скрипт проекта.
 */
function buildRunEnv(args: CliArgs, config: ProjectConfig, baseURL: string, directory: string, runId: string, profile: Profile): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    QA_PROJECT: args.project,
    QA_ENV: args.env,
    QA_SUITE: args.suite,
    QA_PROFILE: args.profile,
    QA_BASE_URL: baseURL,
    QA_CONFIG: JSON.stringify(config),
    QA_RUN_DIR: directory,
    QA_RUN_ID: runId,
    QA_WORKERS: String(profile.ui.workers),
  };
  if (args.data) env.QA_DATA = path.resolve(args.data);
  return env;
}

/**
 * Готовит папку artifacts к новому прогону.
 *
 * Удаляем только СОДЕРЖИМОЕ папки, саму папку не трогаем: docker-compose.yml монтирует её
 * в контейнер metrics-exporter, а bind mount в Docker привязан к конкретной директории (inode).
 * Если удалить и создать artifacts заново, контейнер продолжит смотреть в старую, уже удалённую
 * папку и будет отдавать "no test results yet" — Grafana в этом случае показывает "No data",
 * хотя на хосте свежие метрики есть.
 */
function prepareRunDirectory(): string {
  const directory = path.resolve('artifacts');
  fs.mkdirSync(directory, { recursive: true });
  for (const entry of fs.readdirSync(directory)) fs.rmSync(path.join(directory, entry), { recursive: true, force: true });
  fs.mkdirSync(path.join(directory, 'allure-results'), { recursive: true });
  return directory;
}

/** Кладёт сводку о прогоне в Allure — она видна на вкладке Environment. */
function writeAllureEnvironmentInfo(directory: string, args: CliArgs, runId: string): void {
  fs.writeFileSync(path.join(directory, 'allure-results', 'environment.properties'), [
    `Project=${args.project}`,
    `Environment=${args.env}`,
    `Profile=${args.profile}`,
    `Suite=${args.suite}`,
    `Started=${runId}`,
  ].join('\n') + '\n');
}

/** Сохраняет artifacts/run.json — настройки и статус прогона. */
function saveManifest(directory: string, manifest: unknown): void {
  fs.writeFileSync(path.join(directory, 'run.json'), JSON.stringify(manifest, null, 2));
}

/**
 * Запускает Playwright (наборы ui и api).
 *
 * Если в профиле задан durationSeconds — повторяет прогон партиями, пока не выйдет время;
 * иначе выполняет repeats раз. Начатая партия всегда доходит до конца: после дедлайна
 * просто не начинается новая. На первой же упавшей партии останавливаемся.
 */
async function runPlaywrightSuite(args: CliArgs, profile: Profile, env: NodeJS.ProcessEnv): Promise<number> {
  const deadline = Date.now() + profile.ui.durationSeconds * 1000;
  let iteration = 0;
  let exitCode = 0;

  do {
    const code = await command(
      process.execPath,
      [path.resolve('node_modules/@playwright/test/cli.js'), 'test'],
      { ...env, QA_ITERATION: String(iteration) },
    );
    if (code) exitCode = code;
    iteration++;
    if (interrupted || code !== 0) break;
  } while (args.suite === 'ui' && (profile.ui.durationSeconds > 0 ? Date.now() < deadline : iteration < profile.ui.repeats));

  return exitCode;
}

/** Переносит числа из summary k6 в метрики фреймворка — чтобы они появились в Grafana. */
function recordK6Metrics(summaryPath: string, exitCode: number): void {
  if (!fs.existsSync(summaryPath)) return;

  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  for (const [name, metric] of Object.entries(summary.metrics) as [string, Record<string, unknown>][]) {
    for (const [stat, value] of Object.entries(metric)) {
      if (typeof value !== 'number') continue;
      saveEvent({
        kind: 'metric', test: 'API load', case_id: '', iteration: 0, retry: 0,
        name: `k6.${name}.${stat}`, value, status: exitCode ? 'failed' : 'passed',
      });
    }
  }
}

/**
 * Записывает весь нагрузочный прогон как один тест Allure.
 *
 * Подробности по каждому HTTP-запросу остаются в k6-summary.json и k6-events.jsonl.
 * Пишем через официальный SDK allure-js-commons (а не собираем JSON руками), чтобы формат
 * совпадал с тем, что пишут обычные Playwright-тесты.
 *
 * Параметры нагрузки (rps, длительность, пороги) ядру неизвестны — они целиком в
 * projects/<project>/load/scenario.js, поэтому здесь только адрес и итог прогона.
 */
function writeK6AllureResult(directory: string, project: string, baseURL: string, exitCode: number, start: number, summaryPath: string): void {
  const runtime = new ReporterRuntime({ writer: new FileSystemWriter({ resultsDir: path.join(directory, 'allure-results') }) });
  const uuid = runtime.startTest({ name: 'API load', fullName: `${project}.api-load`, start });

  runtime.updateTest(uuid, result => {
    result.parameters = [{ name: 'url', value: baseURL }];
    result.status = exitCode ? Status.FAILED : Status.PASSED;
    result.stage = Stage.FINISHED;
  });
  if (fs.existsSync(summaryPath)) {
    runtime.writeAttachment(uuid, undefined, 'k6 summary', fs.readFileSync(summaryPath), { contentType: 'application/json' });
  }

  runtime.stopTest(uuid, { stop: Date.now() });
  runtime.writeTest(uuid);
}

/** Где лежит k6-сценарий проекта. Соглашение фреймворка: один файл load/scenario.js на проект. */
function loadScriptPath(project: string): string {
  return path.resolve('projects', project, 'load', 'scenario.js');
}

/**
 * Запускает нагрузочный тест k6.
 *
 * Сценарий целиком описан в самом скрипте проекта — ядро просто запускает файл,
 * как JMeter запускает test plan, и ничего в нём не подставляет.
 */
async function runApiLoad(args: CliArgs, baseURL: string, directory: string, env: NodeJS.ProcessEnv): Promise<number> {
  const start = Date.now();
  const summaryPath = path.join(directory, 'k6-summary.json');
  const scriptPath = loadScriptPath(args.project);

  // Путь к k6 можно переопределить переменной окружения, если бинарника нет в PATH.
  const exitCode = await command(process.env.K6_PERFORMANCE_K6_BINARY || 'k6', [
    'run',
    '--summary-export', summaryPath,
    '--out', `json=${path.join(directory, 'k6-events.jsonl')}`,
    scriptPath,
  ], env);

  recordK6Metrics(summaryPath, exitCode);
  writeK6AllureResult(directory, args.project, baseURL, exitCode, start, summaryPath);
  saveEvent({
    kind: 'test', test: 'API load', case_id: '', iteration: 0, retry: 0,
    name: 'test.duration', value: Date.now() - start, status: exitCode ? 'failed' : 'passed',
  });
  return exitCode;
}

/**
 * Запускает необязательный шаг проекта после тестов — projects/<project>/after-run.ts.
 *
 * Нужен для сквозных проверок, которые нельзя сделать внутри одного теста (например,
 * «id не повторяется между аккаунтами»: тесты идут в разных процессах и не видят друг друга).
 * Ядро не знает, что делает этот файл, — только то, что он может лежать по этому пути.
 * Нет файла — ничего не происходит.
 */
async function runAfterHook(args: CliArgs, env: NodeJS.ProcessEnv): Promise<number> {
  const hookPath = path.resolve('projects', args.project, 'after-run.ts');
  if (!fs.existsSync(hookPath)) return 0;
  return command(process.execPath, ['--import', 'tsx', hookPath], env);
}

/**
 * Собирает HTML-отчёт Allure из сырых результатов.
 * Если не получилось (обычно не установлена Java) — сырые результаты остаются на месте,
 * прогон помечается кодом 2, но уже собранные данные не теряются.
 */
async function generateAllureReport(directory: string, env: NodeJS.ProcessEnv, exitCode: number): Promise<number> {
  try {
    // Запускаем через node, а не node_modules/.bin/allure напрямую: там скрипт без расширения,
    // и на Windows без shell он не запускается. Пакет allure-commandline сам выбирает .bat на Windows.
    const reportCode = await command(process.execPath, [
      path.resolve('node_modules/allure-commandline/bin/allure'),
      'generate', path.join(directory, 'allure-results'), '--clean', '-o', path.join(directory, 'allure-report'),
    ], env);
    if (reportCode) {
      console.error('Allure generation failed; raw results were preserved. Check Java installation.');
      return exitCode || 2;
    }
  } catch (error) {
    console.error('Allure generation:', errorDetails(error));
    return exitCode || 2;
  }
  return exitCode;
}

async function main() {
  // Настройки окружения и инфраструктуры берём из .env.k6_performance, если файл есть.
  // Уже заданные системные переменные не трогаем — они в приоритете.
  loadEnvFile(path.resolve('.env.k6_performance'));

  const args = parseCliArgs();
  const config = await loadProject(args.project);
  const profile = config.profiles[args.profile];
  const baseURL = config.environments[args.env];
  if (!baseURL) {
    throw new Error(`Нет окружения "${args.env}" в project.config.ts. Доступные: ${Object.keys(config.environments).join(', ')}`);
  }
  if (!profile) {
    throw new Error(`Нет профиля "${args.profile}" в project.config.ts. Доступные: ${Object.keys(config.profiles).join(', ')}`);
  }

  // Всё, что можно проверить до запуска браузеров, проверяем заранее — чтобы падать сразу
  // и с понятным сообщением, а не посреди прогона.
  if (args.suite === 'api-load' && !fs.existsSync(loadScriptPath(args.project))) {
    throw new Error(`Нет файла ${loadScriptPath(args.project)} — создайте k6-сценарий для этого проекта`);
  }
  readCases(args.data, baseURL);

  const directory = prepareRunDirectory();
  const runId = new Date().toISOString();
  writeAllureEnvironmentInfo(directory, args, runId);

  const env = buildRunEnv(args, config, baseURL, directory, runId, profile);
  // saveEvent() (core/events.ts) читает QA_* напрямую из process.env, а не из аргументов.
  // cli.ts сам вызывает saveEvent в этом же процессе (run.started, метрики k6) — поэтому
  // переменные нужно продублировать в process.env, а не только передать дочерним процессам.
  Object.assign(process.env, env);

  const manifest = {
    startedId: runId,
    project: args.project,
    environment: args.env,
    suite: args.suite,
    profile: args.profile,
    started: new Date().toISOString(),
    finished: '',
    status: 'running',
    config,
    loadProfile: profile,
    error: null as unknown,
  };
  saveManifest(directory, manifest);
  console.log(`Run started → ${directory}`);

  // Отмечаем сам факт старта: даже если браузер не поднимется, в Grafana будет видно,
  // что прогон начинался.
  saveEvent({ kind: 'test', test: 'run', case_id: '', iteration: 0, retry: 0, name: 'run.started', value: 1, status: 'passed' });
  writePrometheusFile(directory);

  let exitCode = 0;
  try {
    exitCode = args.suite === 'api-load'
      ? await runApiLoad(args, baseURL, directory, env)
      : await runPlaywrightSuite(args, profile, env);
  } catch (error) {
    manifest.error = errorDetails(error);
    console.error(manifest.error);
    exitCode = 1;
  } finally {
    // Отчёты собираем всегда, даже если тесты упали: провал теста — это нормальный результат
    // прогона, а не повод остаться без отчёта.
    exitCode = (await runAfterHook(args, env)) || exitCode;

    manifest.finished = new Date().toISOString();
    manifest.status = interrupted ? 'interrupted' : exitCode ? 'failed' : 'passed';
    saveManifest(directory, manifest);

    // Воркеры уже завершились, поэтому файл для Grafana можно спокойно собрать один раз.
    writePrometheusFile(directory);
    exitCode = await generateAllureReport(directory, env, exitCode);
    console.log(`Saved: ${directory}`);
  }

  process.exitCode = exitCode;
}

main().catch(error => {
  console.error(errorDetails(error));
  process.exitCode = 1;
});
