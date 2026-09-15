import fs from 'node:fs';

/**
 * Загружает переменные из .env-файла в process.env.
 *
 * Системные переменные окружения всегда в приоритете: если переменная уже задана
 * в системе, значение из файла игнорируется. Благодаря этому один и тот же код работает
 * и на машине разработчика (файл рядом с проектом), и на сервере, где переменные заданы
 * в системе — менять код не нужно.
 *
 * Формат файла — обычные строки `KEY=VALUE`. Пустые строки и строки, начинающиеся с `#`,
 * пропускаются. Ядро не знает, какие именно переменные читает проект: имена переменных —
 * дело самого проекта.
 */
export function loadEnvFile(file: string): void {
  if (!fs.existsSync(file)) return;

  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const text = line.trim();
    if (!text || text.startsWith('#')) continue;

    const separator = text.indexOf('=');
    if (separator === -1) continue;

    const key = text.slice(0, separator).trim();
    const value = text.slice(separator + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
