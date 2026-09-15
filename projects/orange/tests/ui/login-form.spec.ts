import { test, expect } from '../../../../core/playwright/fixtures';
import * as allure from 'allure-js-commons';
import { readCases } from '../../../../core/data';
import { LoginPage } from '../../pages/LoginPage';
import { appendSessionRecord } from '../../sessionLog';
import config from '../../project.config';

// Тест-данные для входа — в data/pages.csv (колонки login,password). Путь передаётся
// флагом --data; без него будет один случай с адресом из project.config.ts.
const cases = readCases(process.env.QA_DATA, process.env.QA_BASE_URL!);

// Обычно тесты одного файла идут по очереди. Этот режим разрешает им работать параллельно.
test.describe.configure({ mode: 'parallel' });

cases.forEach((data, index) => {
  // case_id из CSV, а если колонки нет — номер строки. Он же идентификатор в Allure,
  // событиях и журнале session id.
  const caseId = data.case_id;

  test(`Orange: форма входа [${caseId}]`, {
    annotation: { type: 'case_id', description: caseId },
  }, async ({ page, qa }) => {
    // Тесты стартуют параллельно, но каждая следующая строка ждёт свой интервал:
    // первая идёт сразу, вторая через lineIntervalSeconds, третья — через два интервала.
    const profile = config.profiles[process.env.QA_PROFILE || 'smoke'];
    const interval = (profile.ui.lineIntervalSeconds || 0) * 1000;
    if (interval > 0 && index > 0) await new Promise(resolve => setTimeout(resolve, index * interval));

    await qa.parameters(data, index + 1);
    const loginPage = new LoginPage(page);

    // Слушатель вешаем заранее, до логина: сообщения консоли, появившиеся до подписки, поймать нельзя.
    const consoleMessages: string[] = [];
    page.on('console', message => consoleMessages.push(message.text()));

    await qa.step('Открыть Orange и дождаться формы входа', async () => {
      await qa.measure('page.login.ready', async () => {
        // Каждый элемент получает свой шаг Allure и свою метрику.
        // Отсчёт времени для всех начинается одновременно, до открытия сайта.
        await qa.measureElements(() => loginPage.open(data.url), [
          { name: 'element.login.form', title: 'Форма входа отображается', locator: loginPage.form },
          { name: 'element.login.title', title: 'Заголовок входа отображается', locator: loginPage.title },
          { name: 'element.login.email', title: 'Поле E-mail или номер Orange отображается', locator: loginPage.emailInput },
          { name: 'element.login.password', title: 'Поле пароля отображается', locator: loginPage.passwordInput },
          { name: 'element.login.continue', title: 'Кнопка Continuă отображается', locator: loginPage.continueButton },
          { name: 'element.login.createAccount', title: 'Кнопка создания аккаунта отображается', locator: loginPage.createAccountButton },
          { name: 'element.login.forgotPassword', title: 'Ссылка восстановления пароля отображается', locator: loginPage.forgotPassword },
          { name: 'element.login.google', title: 'Вход через Google отображается', locator: loginPage.googleLogin },
          { name: 'element.login.sms', title: 'Вход через SMS отображается', locator: loginPage.smsLogin },
        ], config.budgets.elementReadyMs, page);
      }, config.budgets.pageReadyMs);
    }, page);

    // Дальше метрики check.* — это время самой проверки, а не время появления элемента.
    await qa.step('Заголовок содержит Intră în cont', async () => {
      await qa.measure('check.login.title', () => loginPage.checkTitle());
    }, page);

    await qa.step('Поля пустые и доступны для ввода', async () => {
      await qa.measure('check.login.inputs', () => loginPage.checkEmptyInputs());
    }, page);

    await qa.step('Кнопка Continuă отключена для пустой формы', async () => {
      await qa.measure('check.login.continueDisabled', () => loginPage.checkContinueButton());
    }, page);

    await qa.step('Кнопка Creează cont Orange доступна', async () => {
      await qa.measure('check.login.createAccount', () => loginPage.checkCreateAccountButton());
    }, page);

    await qa.step('Ввести логин и пароль, нажать Continuă', async () => {
      await qa.measure('action.login', () => loginPage.login(data.login, data.password));
    }, page);

    let sessionId: string | null = null;
    await qa.step('Проверить переход на my.orange.md и загрузку профиля', async () => {
      await qa.measure('action.loginRedirect', () => loginPage.expectLoggedIn());
      sessionId = await loginPage.sessionId();
      expect(sessionId, 'После входа должен установиться cookie MyoWeb.BrowserSessionId').not.toBeNull();
    }, page);

    await qa.step('Сохранить session id для проверки на уникальность', async () => {
      // Сравнение session id разных аккаунтов возможно только после того, как отработают все
      // тесты, поэтому здесь просто сохраняем свою запись — сверяет её after-run.ts.
      appendSessionRecord({ case_id: caseId, login: data.login, password: data.password, sessionId });
      await qa.attach('session-id', { login: data.login, password: data.password, sessionId });
    }, page);

    await qa.step('Сверить данные из консоли с UI', async () => {
      // Сообщения браузерной консоли за весь тест уже собраны в consoleMessages, по порядку.
      // Дальше — разбор: найти нужное сообщение, распарсить и сверить с элементами страницы.
      await qa.attach('console-messages', consoleMessages);
    }, page);

    await qa.step('Сохранить загрузку документа и адрес после перенаправления', async () => {
      await qa.navigation(page);
      await allure.parameter('final_url', page.url());
      await qa.attachContext(page);
    }, page);
  });
});
