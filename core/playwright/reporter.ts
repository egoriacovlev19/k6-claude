import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { saveEvent } from '../events';

/**
 * Репортер Playwright: записывает длительность и итоговый статус каждого теста.
 *
 * Нужен отдельно от фикстуры `qa`, потому что видит финальный статус теста — включая
 * случаи, когда сам тест до кода не дошёл (упал в setup) или был пропущен.
 */
export default class MetricsReporter implements Reporter {
  onTestEnd(test: TestCase, result: TestResult) {
    saveEvent({
      kind: 'test',
      test: test.title,
      case_id: test.annotations.find(annotation => annotation.type === 'case_id')?.description || '',
      iteration: Number(process.env.QA_ITERATION || 0),
      retry: result.retry,
      name: 'test.duration',
      value: result.duration,
      status: result.status,
    });
  }
}
