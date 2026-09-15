import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Page Object страницы входа Orange.
 *
 * Здесь только элементы страницы и действия/проверки над ними. Сценарий (что за чем делаем,
 * какие метрики пишем) живёт в тесте, а селекторы — в одном месте, чтобы при редизайне сайта
 * править их приходилось только тут.
 */
export class LoginPage {
  readonly form: Locator;
  readonly title: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly continueButton: Locator;
  readonly createAccountButton: Locator;
  readonly forgotPassword: Locator;
  readonly googleLogin: Locator;
  readonly smsLogin: Locator;
  /**
   * Блок профиля на my.orange.md — появляется только после успешного входа.
   * Специально без привязки к имени пользователя: оно у каждого аккаунта своё,
   * поэтому проверяем сам факт загрузки блока, а не текст внутри него.
   */
  readonly profileIndicator: Locator;

  constructor(private page: Page) {
    this.form = page.locator('.login__wrapper');
    this.title = this.form.locator('[data-lang="pl_title"]');
    this.emailInput = this.form.locator('#mail-log');
    this.passwordInput = this.form.locator('#login-mask');
    this.continueButton = this.form.locator('#cta-log');
    this.createAccountButton = this.form.locator('#cta-myo-redirect');
    this.forgotPassword = this.form.locator('[data-lang="pl_forgot"]');
    this.googleLogin = this.form.locator('.googleStyles');
    this.smsLogin = this.form.locator('.smsStyles');
    this.profileIndicator = page.locator('.s-current');
  }

  /** Открывает страницу входа. */
  async open(url: string) {
    // Не ждём networkidle: сторонние запросы (аналитика, баннеры) не определяют готовность формы.
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  /** Заголовок формы — ожидаемый текст на румынском. */
  async checkTitle() {
    await expect(this.title).toHaveText('Intră în cont');
  }

  /** Поля логина и пароля пустые, доступны для ввода, пароль скрыт. */
  async checkEmptyInputs() {
    await expect(this.emailInput).toBeEditable();
    await expect(this.emailInput).toHaveValue('');
    await expect(this.passwordInput).toBeEditable();
    await expect(this.passwordInput).toHaveValue('');
    await expect(this.passwordInput).toHaveAttribute('type', 'password');
  }

  /** Кнопка входа видна, но недоступна, пока логин и пароль не заполнены. */
  async checkContinueButton() {
    await expect(this.continueButton).toHaveText('Continuă');
    await expect(this.continueButton).toBeDisabled();
  }

  /** Кнопка создания аккаунта видна и доступна. */
  async checkCreateAccountButton() {
    await expect(this.createAccountButton).toHaveText('Creează cont Orange');
    await expect(this.createAccountButton).toBeEnabled();
  }

  /** Заполняет форму и отправляет её. */
  async login(login: string, password: string) {
    await this.emailInput.fill(login);
    await this.passwordInput.fill(password);
    await this.continueButton.click();
  }

  /** Проверяет, что вход прошёл: сайт увёл на my.orange.md и блок профиля загрузился. */
  async expectLoggedIn() {
    // Точный путь после редиректа может отличаться (язык, query-параметры), поэтому ждём домен,
    // а не точное совпадение адреса — иначе тест ложно падал бы на безобидных деталях URL.
    await this.page.waitForURL(url => url.href.startsWith('https://my.orange.md'), { timeout: 10000 });
    await expect(this.profileIndicator).toBeVisible();
  }

  /**
   * Возвращает значение cookie MyoWeb.BrowserSessionId.
   * Сайт ставит её после успешного входа, поэтому null означает, что вход не удался.
   */
  async sessionId(): Promise<string | null> {
    const cookies = await this.page.context().cookies();
    return cookies.find(cookie => cookie.name === 'MyoWeb.BrowserSessionId')?.value ?? null;
  }
}
