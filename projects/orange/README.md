# Orange UI test

Перед первым запуском заполните тест-данные (см. раздел "Тест-данные (CSV)" ниже) —
без них логиниться не под кем.

Запуск из корня фреймворка:

```bash
npm run orange
```

Перед запуском команда удаляет старые файлы из `artifacts`. Новый запуск создаёт:

- `allure-results` — исходные Allure 2 результаты;
- `allure-report` — готовый Allure 2 HTML;
- `events` — понятные JSONL-события;
- `metrics.prom` — метрики для Grafana;
- `run.json` — настройки и статус запуска;
- `playwright-*` — trace и screenshot при падении.

Открыть Allure:

```bash
npx allure open artifacts/allure-report
```

## Изменение настроек

Откройте `project.config.ts`:

- `environments.production` — адрес сайта;
- `timeoutMs` — общий timeout теста;
- `budgets.pageReadyMs` — лимит всей формы;
- `budgets.elementReadyMs` — лимит элемента, максимум 3000 мс;
- `profiles.smoke.ui.workers` — параллельные браузеры;
- `profiles.smoke.ui.lineIntervalSeconds` — интервал между стартами аккаунтов;
- `profiles.smoke.ui.repeats` — число повторов, когда `durationSeconds` равно 0.

Сейчас интервал 5 секунд: первый аккаунт стартует сразу, второй через 5 секунд,
третий через 10 и так далее. Тесты при этом остаются параллельными.

## Тест-данные (CSV)

Файл `data/pages.csv`, колонки `login,password` — по строке на аккаунт:

```
login,password
abc,1234
abc1,2345
abc3,3456
```

Каждая строка становится отдельным тестом: логин и пароль реально вводятся в форму.
`case_id` в CSV не указан — им становится номер строки (1, 2, 3...), он же идёт в Allure,
события и журнал session id. Чтобы добавить аккаунт — допишите строку, код менять не нужно.
Все колонки CSV автоматически становятся параметрами Allure и попадают в context attachment.

Сам файл в `.gitignore` — пароли в репозиторий не попадают. В git лежит только шаблон
`data/pages.csv.example`: на новой машине скопируйте его в `data/pages.csv` и впишите значения.

## Проверки

Сначала — форма без ввода: `Intră în cont`, поле логина `#mail-log`, пароль `#login-mask`,
точные тексты, доступность полей, password type, `Continuă` отключена для пустой формы,
`Creează cont Orange` доступна.

Дальше тест **вводит логин и пароль и нажимает Continuă**, проверяет переход на
`my.orange.md` и появление блока профиля (без привязки к конкретному имени — оно у каждого
логина своё), читает cookie `MyoWeb.BrowserSessionId` и сохраняет его в Allure-вложение вместе
с логином/паролем. После того как отработают все аккаунты, отдельный шаг (`after-run.ts`)
сверяет все session id между собой и пишет ещё один Allure-тест "Session id уникален для
каждого логина" — passed, если дублей нет, failed с перечислением совпавших логинов, если есть.

Ещё один шаг собирает сообщения браузерной консоли за весь тест (`console-messages` во
вложениях) — сам разбор этих сообщений и сверка с UI пока не написаны, шаг подготовлен под это.

Каждая проверка — отдельный читаемый шаг Allure. Ошибка внутри шага сразу сохраняет screenshot,
исходный Playwright error, обработанный error JSON и текущий URL.

## Нагрузка (k6)

```bash
npm run qa -- --project orange --env production --suite api-load --profile smoke
```

Сценарий — `load/scenario.js`: 1 запрос каждые 5 секунд на страницу логина, 60 секунд
(≈ 12 запросов). Это нагрузка на страницу, а не на API — у Orange нет отдельного API,
который мы бы тестировали, поэтому скрипт просто грузит тот же адрес, что открывает
браузер в UI-тесте. Числа (rate, duration, пороги) правятся прямо в `scenario.js`.

## Grafana

```bash
open -a Docker
docker compose up -d
npm run orange
```

Откройте http://localhost:3000 и dashboard `QA runs and page performance`.
Отдельные графики показывают загрузку элементов, страницу, проверки и passed/failed события.
База данных не используется: Prometheus читает файл `artifacts/metrics.prom`.
