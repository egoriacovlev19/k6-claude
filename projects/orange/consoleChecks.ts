/**
 * Разбор сообщений консоли (console.log) дашборда my.orange.md после входа.
 * Сайт сам пишет туда значения виджетов в момент рендера — тест сверяет их с тем,
 * что реально показано на странице (DashboardPage). Только этот проект знает про формат
 * этих строк.
 */

/** Ищет первое сообщение вида "Label - число" (метка сравнивается точно, с учётом регистра —
 * иначе "Balance" и "Account balance" перепутаются) и возвращает число из хвоста. */
function findNumber(consoleMessages: string[], label: string): number | null {
  const pattern = new RegExp(`^${label}\\s*-\\s*(\\d+(?:[.,]\\d+)?)$`);
  for (const message of consoleMessages) {
    const match = message.trim().match(pattern);
    if (match) return parseFloat(match[1].replace(',', '.'));
  }
  return null;
}

/** То же самое, но хвост сообщения — произвольный текст (название тарифа, опции и т.п.). */
function findText(consoleMessages: string[], label: string): string | null {
  const pattern = new RegExp(`^${label}\\s*-\\s*(.+)$`);
  for (const message of consoleMessages) {
    const match = message.trim().match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}

/** Номера линий B2B-аккаунта из консоли ("Admin line - N" / "Child line - N"), в порядке появления. */
export function parseConsoleLineNumbers(consoleMessages: string[]): string[] {
  const numbers: string[] = [];
  const pattern = /^(?:Admin|Child) line\s*-\s*(\d+)$/;
  for (const message of consoleMessages) {
    const match = message.trim().match(pattern);
    if (match) numbers.push(match[1]);
  }
  return numbers;
}

export const parseAboName = (consoleMessages: string[]) => findText(consoleMessages, 'Abo name');
export const parseLineBalance = (consoleMessages: string[]) => findNumber(consoleMessages, 'Balance');
export const parseAccountBalance = (consoleMessages: string[]) => findNumber(consoleMessages, 'Account balance');
export const parseLastInvoice = (consoleMessages: string[]) => findNumber(consoleMessages, 'Last invoice');
export const parseActivatedOptionName = (consoleMessages: string[]) =>
  findText(consoleMessages, 'Activated Option Name');

/**
 * Число из суммы на UI вида "1252.00 MDL" / "80 MDL". Сравнивать нужно как число, а не строку:
 * тогда "1252" из консоли и "1252.00 MDL" на UI считаются равными (лишние ",00"/".00" не мешают).
 */
export function parseUiAmount(text: string): number | null {
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*MDL/i);
  return match ? parseFloat(match[1].replace(',', '.')) : null;
}
