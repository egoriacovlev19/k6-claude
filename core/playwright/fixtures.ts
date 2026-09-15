import { test as base, expect, type Page, type Locator, type TestInfo } from '@playwright/test';
import * as allure from 'allure-js-commons';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { MAX_ELEMENT_WAIT_MS } from '../config';
import { saveEvent } from '../events';
import { errorDetails } from '../errors';
import type { CaseData } from '../data';

/**
 * Помощник, доступный в каждом тесте как фикстура `qa`.
 *
 * Отвечает за всё, что фреймворк делает вокруг теста: шаги Allure, замеры времени,
 * запись метрик и сбор вложений при падении. Написан явными методами, без декораторов
 * и магии — чтобы по коду теста было видно каждое измеряемое действие.
 */
export class RunContext {
  /** Данные текущего кейса (строка тест-данных) — попадают в метрики и вложения. */
  private data: Record<string, string> = {};
  /** Номер повтора прогона. */
  private iteration = 0;
  /** Все замеры этого теста — прикладываются к отчёту в конце и при падении. */
  private measurements: { name: string; value: number | null; status: string }[] = [];

  constructor(private info: TestInfo) {}

  /**
   * Регистрирует данные кейса как параметры Allure.
   * Все колонки тест-данных попадают в отчёт автоматически, добавлять их руками не нужно.
   */
  async parameters(data: CaseData, iteration?: number) {
    this.data = data;
    this.iteration = iteration ?? Number(process.env.QA_ITERATION || 0);

    for (const [name, value] of Object.entries(data)) await allure.parameter(name, value);
    await allure.parameter('iteration', String(this.iteration));
    await allure.parameter('environment', process.env.QA_ENV!);
    await allure.parameter('run_id', process.env.QA_RUN_ID || 'local');
    // Только имя файла: полный путь раскрыл бы в отчёте имя пользователя и структуру папок машины.
    if (process.env.QA_DATA) await allure.parameter('csv_file', path.basename(process.env.QA_DATA));
  }

  /** Сохраняет одно измерение: в память теста (для вложений) и в журнал событий (для Grafana). */
  record(name: string, value: number | null, status = 'passed') {
    this.measurements.push({ name, value, status });
    saveEvent({
      kind: 'metric', test: this.info.title, case_id: this.data.case_id || '',
      iteration: this.iteration, retry: this.info.retry, name, value, status,
    });
  }

  /** Прикладывает к тесту общий контекст: данные кейса, текущий URL, собранные метрики и ошибку. */
  async attachContext(page?: Page, error?: unknown) {
    await this.info.attach('context', {
      body: JSON.stringify({
        data: this.data,
        iteration: this.iteration,
        currentURL: page?.url(),
        measurements: this.measurements,
        error: error ? errorDetails(error) : undefined,
      }, null, 2),
      contentType: 'application/json',
    });
  }

  /** Произвольное именованное JSON-вложение — для проверок проекта, которые не сводятся к числу. */
  async attach(name: string, data: unknown) {
    await this.info.attach(name, { body: JSON.stringify(data, null, 2), contentType: 'application/json' });
  }

  /**
   * Выполняет действие как отдельный шаг Allure с понятным названием.
   *
   * Если внутри шага что-то падает, сначала собираем всё, что поможет разобраться
   * (скриншот, исходную ошибку Playwright, обработанную ошибку, контекст), и только потом
   * пробрасываем ошибку дальше. Скриншот делаем до того, как страница закроется.
   *
   * page нужен только для скриншота — для шагов без браузера его можно не передавать.
   */
  async step<T>(name: string, action: () => Promise<T>, page?: Page): Promise<T> {
    return base.step(name, async () => {
      try {
        return await action();
      } catch (error) {
        // Упавший браузер может не отдать скриншот — тогда просто продолжаем собирать остальное.
        if (page && !page.isClosed()) {
          try {
            await this.info.attach('failed-step', { body: await page.screenshot({ timeout: 3000 }), contentType: 'image/png' });
          } catch (attachmentError) {
            console.error('Screenshot unavailable:', errorDetails(attachmentError).message);
          }
        }
        try {
          await this.info.attach('playwright-error', {
            body: error instanceof Error ? `${error.name}: ${error.message}\n\n${error.stack || ''}` : String(error),
            contentType: 'text/plain',
          });
          await this.info.attach('processed-error', {
            body: JSON.stringify(errorDetails(error), null, 2),
            contentType: 'application/json',
          });
        } catch (attachmentError) {
          console.error('Error attachment unavailable:', errorDetails(attachmentError).message);
        }
        try {
          await this.attachContext(page, error);
        } catch (attachmentError) {
          console.error(attachmentError);
        }
        throw error;
      }
    });
  }

  /**
   * Измеряет время появления сразу нескольких элементов от одного старта.
   *
   * Отсчёт для всех элементов начинается одновременно, ещё до завершения действия
   * (открытия страницы) — поэтому получается честное «через сколько секунд после начала
   * загрузки появился этот элемент», а не время ожидания по очереди.
   *
   * На каждый элемент — свой шаг Allure (title), своя метрика (name) и вложение с числами.
   * page нужен для скриншота, если элемент так и не появился.
   */
  async measureElements(
    action: () => Promise<unknown>,
    targets: { name: string; title?: string; locator: Locator }[],
    budgetMs: number,
    page?: Page,
  ) {
    const elementTimeout = Math.min(budgetMs, MAX_ELEMENT_WAIT_MS);
    const start = performance.now();
    const pendingAction = action();

    const waits = targets.map(target => this.step(target.title || target.name, async () => {
      let elapsed: number;
      try {
        await target.locator.waitFor({ state: 'visible', timeout: elementTimeout });
        elapsed = performance.now() - start;
      } catch (error) {
        // Элемент не появился: пишем провал без времени. Таймаут нельзя показывать как время загрузки.
        this.record(target.name, null, 'failed');
        throw error;
      }

      const status = elapsed <= elementTimeout ? 'passed' : 'failed';
      this.record(target.name, elapsed, status);
      await this.attach(target.name, { metric: target.name, elapsedMs: elapsed, budgetMs: elementTimeout, status });
      expect(elapsed, target.title || target.name).toBeLessThanOrEqual(elementTimeout);
    }, page));

    // Дожидаемся всех наблюдений, даже если одно уже упало: иначе метрики остальных элементов
    // потерялись бы, и было бы непонятно, что ещё не загрузилось.
    const results = await Promise.allSettled([pendingAction, ...waits]);
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }

  /**
   * Измеряет время одного действия и записывает его как метрику.
   * Если задан budgetMs — превышение бюджета роняет тест.
   */
  async measure<T>(name: string, action: () => Promise<T>, budgetMs?: number): Promise<T> {
    const start = performance.now();
    let value: T;
    try {
      value = await action();
    } catch (error) {
      this.record(name, null, 'failed');
      throw error;
    }

    const elapsed = performance.now() - start;
    this.record(name, elapsed, budgetMs && elapsed > budgetMs ? 'failed' : 'passed');
    if (budgetMs) expect(elapsed, name).toBeLessThanOrEqual(budgetMs);
    return value;
  }

  /**
   * Записывает Navigation Timing браузера: ttfb, domContentLoaded, load.
   *
   * Это время загрузки документа — оно не заменяет проверку готовности страницы,
   * которую определяет сам проект (особенно у SPA, где документ загружен, а формы ещё нет).
   */
  async navigation(page: Page) {
    await page.waitForLoadState('load');
    const timing = await page.evaluate(() => {
      const entry = window.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      return entry ? {
        ttfb: entry.responseStart - entry.requestStart,
        domContentLoaded: entry.domContentLoadedEventEnd - entry.startTime,
        load: entry.loadEventEnd - entry.startTime,
      } : null;
    });
    if (timing) for (const [name, value] of Object.entries(timing)) this.record(`page.${name}`, value);
  }
}

/**
 * Расширенный `test` с фикстурой `qa`. Тесты проектов импортируют его отсюда,
 * а не из @playwright/test напрямую — иначе фикстуры не будет.
 */
export const test = base.extend<{ qa: RunContext }>({
  qa: async ({}, use, info) => {
    const context = new RunContext(info);
    try {
      await use(context);
    } finally {
      // Контекст прикладываем в любом случае, но ошибка вложения не должна
      // подменить собой настоящую ошибку теста.
      try {
        await context.attachContext();
      } catch (error) {
        console.error('Не удалось приложить контекст:', errorDetails(error));
      }
    }
  },
});

export { expect };
