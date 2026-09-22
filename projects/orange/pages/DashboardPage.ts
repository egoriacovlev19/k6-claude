import { type Locator, type Page } from '@playwright/test';

/**
 * Page Object дашборда my.orange.md — страница, которая открывается сразу после входа.
 *
 * Сайт сам пишет ключевые значения виджетов в консоль браузера (console.log) в момент
 * рендера. Тест сверяет то, что написано в консоли, с тем, что реально показано на странице.
 * Здесь только локаторы и чтение текста/атрибутов — сама сверка с консолью живёт в тесте
 * и в consoleChecks.ts.
 */
export class DashboardPage {
  /** Свёрнутый селектор текущего номера — при наведении мышью раскрывает список линий аккаунта. */
  readonly lineSelector: Locator;
  /** Ссылки на линии внутри раскрытого селектора, у каждой — атрибут data-line-msisdn. */
  readonly lineOptions: Locator;
  /** Название тарифа в виджете "Plan tarifar", например "M2M 80". */
  readonly planName: Locator;
  /** Баланс номера в виджете "Balanţa numărului" (карусель), например "1252.00 MDL". */
  readonly lineBalance: Locator;
  /** Баланс счёта компании в виджете "Balanţa contului" (тот же карусель), например "1025.30 MDL". */
  readonly accountBalance: Locator;
  /** Сумма последнего счёта в виджете "Factura", например "80 MDL". */
  readonly lastInvoiceAmount: Locator;
  /** Названия активных опций в виджете "Opţiunile şi serviciile mele". */
  readonly activeOptionNames: Locator;

  constructor(private page: Page) {
    this.lineSelector = page.locator('#lines_list_container');
    this.lineOptions = this.lineSelector.locator('.selector-options a[data-line-msisdn]');
    // id дублируется на сайте (внешний и вложенный div с одним id) — .first() берёт любой из них,
    // структура внутри одинаковая.
    this.planName = page.locator('#dashboard-widget-widget-plan .inv-c-tab h1.m').first();
    // Карусель содержит клонированные слайды (бесконечная прокрутка) с одинаковым текстом —
    // ищем по тексту заголовка блока, а не по "active"/"cloned", и берём первое совпадение.
    this.lineBalance = page
      .locator('#dashboard-widget-balance li')
      .filter({ has: page.locator('h3', { hasText: 'Balanţa numărului' }) })
      .locator('span.txt-color-positive')
      .first();
    this.accountBalance = page
      .locator('#dashboard-widget-balance li')
      .filter({ has: page.locator('h3', { hasText: 'Balanţa contului' }) })
      .locator('span.txt-color-positive')
      .first();
    this.lastInvoiceAmount = page.locator('#dashboard-widget-last-invoice h1.txt-color-black').first();
    this.activeOptionNames = page.locator('#dashboard-widget-ons .normal-circles li b');
  }

  /** Наводит мышь на селектор номеров, ждёт раскрытия списка и возвращает msisdn всех линий на UI. */
  async openLineSelectorAndGetMsisdns(): Promise<string[]> {
    await this.lineSelector.hover();
    await this.lineOptions.first().waitFor({ state: 'visible' });
    return this.lineOptions.evaluateAll(links => links.map(link => link.getAttribute('data-line-msisdn') || ''));
  }

  async planNameText(): Promise<string> {
    return (await this.planName.innerText()).trim();
  }

  async lineBalanceText(): Promise<string> {
    return (await this.lineBalance.innerText()).trim();
  }

  async accountBalanceText(): Promise<string> {
    return (await this.accountBalance.innerText()).trim();
  }

  async lastInvoiceText(): Promise<string> {
    return (await this.lastInvoiceAmount.innerText()).trim();
  }

  async activeOptionNamesList(): Promise<string[]> {
    return this.activeOptionNames.allInnerTexts();
  }
}
