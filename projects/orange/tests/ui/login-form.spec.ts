import { test, expect } from '../../../../core/playwright/fixtures';
import * as allure from 'allure-js-commons';
import { readCases } from '../../../../core/data';
import { LoginPage } from '../../pages/LoginPage';
import { DashboardPage } from '../../pages/DashboardPage';
import { appendSessionRecord } from '../../sessionLog';
import {
  parseConsoleLineNumbers,
  parseAboName,
  parseLineBalance,
  parseAccountBalance,
  parseLastInvoice,
  parseActivatedOptionName,
  parseUiAmount,
} from '../../consoleChecks';
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
    // QA_PROFILE всегда выставляет core/cli.ts и заранее проверяет, что такой профиль есть.
    const profile = config.profiles[process.env.QA_PROFILE!];

    // Тесты стартуют параллельно, но каждая следующая строка ждёт свой интервал:
    // первая идёт сразу, вторая через lineIntervalSeconds, третья — через два интервала.
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
      await qa.measure('action.loginRedirect', () => loginPage.expectLoggedIn(new URL(data.url).origin));
      sessionId = await loginPage.sessionId();
      expect(sessionId, 'После входа должен установиться cookie MyoWeb.BrowserSessionId').not.toBeNull();
    }, page);

    await qa.step('Сохранить session id для проверки на уникальность', async () => {
      // Сравнить session id разных аккаунтов можно только после того, как отработают все тесты,
      // поэтому здесь просто сохраняем свою запись — сверяет их after-run.ts.
      const recordId = appendSessionRecord({ case_id: caseId, login: data.login, password: data.password, sessionId });
      // Метка связывает запись с результатом этого теста в Allure: если session id совпадёт
      // с другим аккаунтом, after-run.ts найдёт по ней именно этот тест и пометит его упавшим.
      await allure.label('session_record', recordId);
      await qa.attach('session-id', { login: data.login, password: data.password, sessionId });
    }, page);

    // Дашборд сам пишет ключевые значения виджетов в консоль браузера при рендере —
    // дальше сверяем их с тем, что реально показано на странице (DashboardPage).
    const dashboardPage = new DashboardPage(page);
    await qa.attach('console-messages', consoleMessages);

    await qa.step('Сверить номера линий из консоли со списком в селекторе (не валит тест)', async () => {
      await qa.measure('check.dashboard.lines', async () => {
        const consoleLines = parseConsoleLineNumbers(consoleMessages);
        const uiLines = await dashboardPage.openLineSelectorAndGetMsisdns();
        const missingOnUi = consoleLines.filter(number => !uiLines.includes(number));
        await qa.attach('lines-comparison', { consoleLines, uiLines, missingOnUi });
        // По просьбе владельца проекта: расхождение тут — не повод ронять тест, только сигнал.
        if (missingOnUi.length > 0) {
          console.warn(`Номера из консоли отсутствуют в селекторе линий на UI: ${missingOnUi.join(', ')}`);
        }
      });
    }, page);

    await qa.step('Сверить тариф (Abo name) из консоли с виджетом Plan tarifar', async () => {
      await qa.measure('check.dashboard.planName', async () => {
        const consoleName = parseAboName(consoleMessages);
        const uiName = await dashboardPage.planNameText();
        await qa.attach('plan-name-comparison', { consoleName, uiName });

        expect(consoleName, 'В консоли должно быть сообщение с названием тарифа (Abo name - ...)').not.toBeNull();
        expect(uiName, 'Название тарифа на UI должно совпадать с консолью').toBe(consoleName);
      });
    }, page);

    await qa.step('Сверить баланс номера из консоли с виджетом Balanţa numărului', async () => {
      await qa.measure('check.dashboard.lineBalance', async () => {
        const consoleBalance = parseLineBalance(consoleMessages);
        const uiText = await dashboardPage.lineBalanceText();
        const uiBalance = parseUiAmount(uiText);
        await qa.attach('line-balance-comparison', { consoleBalance, uiText, uiBalance });

        expect(consoleBalance, 'В консоли должно быть сообщение с балансом номера (Balance - ...)').not.toBeNull();
        expect(uiBalance, `Не удалось распознать баланс номера на UI: "${uiText}"`).not.toBeNull();
        expect(uiBalance, 'Баланс номера на UI должен совпадать с консолью').toBe(consoleBalance);
      });
    }, page);

    await qa.step('Сверить баланс счёта из консоли с виджетом Balanţa contului', async () => {
      await qa.measure('check.dashboard.accountBalance', async () => {
        const consoleBalance = parseAccountBalance(consoleMessages);
        const uiText = await dashboardPage.accountBalanceText();
        const uiBalance = parseUiAmount(uiText);
        await qa.attach('account-balance-comparison', { consoleBalance, uiText, uiBalance });

        expect(consoleBalance, 'В консоли должно быть сообщение с балансом счёта (Account balance - ...)').not.toBeNull();
        expect(uiBalance, `Не удалось распознать баланс счёта на UI: "${uiText}"`).not.toBeNull();
        expect(uiBalance, 'Баланс счёта на UI должен совпадать с консолью').toBe(consoleBalance);
      });
    }, page);

    await qa.step('Сверить сумму последнего счёта из консоли с виджетом Factura', async () => {
      await qa.measure('check.dashboard.lastInvoice', async () => {
        const consoleAmount = parseLastInvoice(consoleMessages);
        const uiText = await dashboardPage.lastInvoiceText();
        const uiAmount = parseUiAmount(uiText);
        await qa.attach('last-invoice-comparison', { consoleAmount, uiText, uiAmount });

        expect(consoleAmount, 'В консоли должно быть сообщение с суммой последнего счёта (Last invoice - ...)').not.toBeNull();
        expect(uiAmount, `Не удалось распознать сумму счёта на UI: "${uiText}"`).not.toBeNull();
        expect(uiAmount, 'Сумма последнего счёта на UI должна совпадать с консолью').toBe(consoleAmount);
      });
    }, page);

    await qa.step('Сверить активную опцию из консоли с виджетом опций и услуг', async () => {
      await qa.measure('check.dashboard.activeOption', async () => {
        const consoleOptionName = parseActivatedOptionName(consoleMessages);
        const uiOptionNames = await dashboardPage.activeOptionNamesList();
        await qa.attach('active-option-comparison', { consoleOptionName, uiOptionNames });

        expect(consoleOptionName, 'В консоли должно быть сообщение об активной опции (Activated Option Name - ...)').not.toBeNull();
        expect(uiOptionNames, 'Опция из консоли должна быть среди опций на UI').toContain(consoleOptionName);
      });
    }, page);

    await qa.step('Сохранить загрузку документа и адрес после перенаправления', async () => {
      await qa.navigation(page);
      await allure.parameter('final_url', page.url());
      await qa.attachContext(page);
    }, page);
  });
});
