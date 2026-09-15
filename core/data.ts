import fs from 'node:fs';
import { parse } from 'csv-parse/sync';

/**
 * Одна строка тест-данных.
 *
 * case_id и url есть всегда (подставляются автоматически, если их нет в файле),
 * остальные колонки произвольные — они автоматически становятся параметрами Allure.
 */
export type CaseData = { case_id: string; url: string; [key: string]: string };

/**
 * Читает CSV с тест-данными.
 *
 * Если файл не передан — возвращает один случай с адресом окружения (прогон без тест-данных).
 * Значения остаются строками, поэтому ведущие нули (например, в номерах телефонов) не теряются.
 *
 * Читаем и проверяем ДО запуска браузеров: ошибка в данных должна ронять прогон сразу,
 * а не через десять минут.
 */
export function readCases(file: string | undefined, baseURL: string): CaseData[] {
  if (!file) return [{ case_id: 'default', url: baseURL }];

  const rows = parse(fs.readFileSync(file, 'utf8'), { columns: true, bom: true, skip_empty_lines: true, trim: true }) as CaseData[];
  if (!rows.length) throw new Error('CSV has no data rows');

  const ids = new Set<string>();
  rows.forEach((row, index) => {
    // Колонка case_id не обязательна: без неё идентификатором служит номер строки (с 1).
    row.case_id ||= String(index + 1);
    if (ids.has(row.case_id)) throw new Error('CSV case_id must be unique');
    ids.add(row.case_id);

    // Колонка url тоже не обязательна: по умолчанию берём адрес окружения.
    row.url ||= baseURL;
    if (!['http:', 'https:'].includes(new URL(row.url).protocol)) throw new Error('CSV URL must use HTTP(S)');
  });

  return rows;
}
