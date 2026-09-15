/**
 * Приводит любую пойманную ошибку к единому виду для Allure, run.json и логов.
 *
 * Исходный stack сохраняем как есть: отчёт об ошибке никогда не должен подменять
 * саму ошибку — иначе непонятно, что на самом деле упало.
 *
 * kind помогает отличить таймаут (элемент не появился, страница не загрузилась)
 * от обычной ошибки выполнения — по нему удобно фильтровать в отчётах.
 */
export function errorDetails(error: unknown) {
  const e = error instanceof Error ? error : new Error(String(error));
  return {
    kind: /timeout/i.test(e.name + e.message) ? 'timeout' : 'execution',
    name: e.name,
    message: e.message,
    stack: e.stack,
  };
}
