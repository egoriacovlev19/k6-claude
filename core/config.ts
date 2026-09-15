import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Настройки одного проекта из папки projects/.
 *
 * Проект владеет адресами, бюджетами по времени и профилями UI-прогона.
 * Ядро только проверяет, что значения осмысленные.
 *
 * Настройки k6-нагрузки сюда НЕ входят: они живут внутри самого k6-скрипта проекта
 * (projects/<name>/load/scenario.js) — ядро их не читает и не знает про них.
 */
export interface ProjectConfig {
  /** Адрес сайта/API для каждого окружения: ключ — значение флага --env. */
  environments: Record<string, string>;
  /** Профили прогона: ключ — значение флага --profile (например, smoke). */
  profiles: Record<string, {
    ui: {
      workers: number;              // Сколько тестов может выполняться одновременно.
      durationSeconds: number;      // 0 — выполнить repeats раз; иначе повторять партии N секунд.
      repeats: number;              // Сколько раз повторить прогон, когда durationSeconds = 0.
      lineIntervalSeconds?: number; // Задержка старта между строками тест-данных.
    };
  }>;
  /** Максимальное время одного теста, миллисекунды. */
  timeoutMs: number;
  /** Допуски по времени, миллисекунды. */
  budgets: {
    pageReadyMs: number;    // За сколько должна быть готова вся страница/форма.
    elementReadyMs: number; // За сколько должен появиться отдельный элемент (максимум 3000).
  };
}

/** Проверяет, что число — целое и положительное (или ноль, если allowZero). */
export function positive(value: number, name: string, allowZero = false): void {
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) throw new Error(`Invalid ${name}: ${value}`);
}

/**
 * Проверяет конфиг проекта перед запуском.
 *
 * Лучше упасть здесь с понятным сообщением, чем через десять минут прогона
 * из-за опечатки в числе.
 */
export function validate(config: ProjectConfig): ProjectConfig {
  positive(config.timeoutMs, 'timeoutMs');

  for (const url of Object.values(config.environments)) {
    if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('Only HTTP(S) URLs allowed');
  }

  for (const [name, profile] of Object.entries(config.profiles)) {
    positive(profile.ui.workers, `${name}.workers`);
    positive(profile.ui.repeats, `${name}.repeats`);
    positive(profile.ui.durationSeconds, `${name}.ui.durationSeconds`, true);
    if (profile.ui.lineIntervalSeconds !== undefined) {
      positive(profile.ui.lineIntervalSeconds, `${name}.ui.lineIntervalSeconds`, true);
    }
  }

  for (const [name, value] of Object.entries(config.budgets)) positive(value, name);

  // Правило фреймворка: отдельный элемент ждём максимум 3 секунды, каким бы ни был бюджет страницы.
  if (config.budgets.elementReadyMs > 3000) throw new Error('elementReadyMs cannot be more than 3000 ms');

  return config;
}

/** Загружает и проверяет projects/<name>/project.config.ts. */
export async function loadProject(name: string): Promise<ProjectConfig> {
  // Имя проекта приходит из аргументов командной строки и подставляется в путь,
  // поэтому разрешаем только безопасные символы.
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid project name');

  const module = await import(pathToFileURL(path.resolve('projects', name, 'project.config.ts')).href);
  return validate(module.default);
}
