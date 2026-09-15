# QA performance framework

Простой TypeScript-фреймворк для Playwright UI/API, k6, Allure 2 и Grafana.
Рассчитан на локальный запуск, без CI/CD и без базы данных.

## Структура

```
core/                  — общее ядро фреймворка, ни к одному проекту не привязано
  cli.ts               — команда `npm run qa`: запускает тесты, собирает Allure и метрики
  clean.ts             — команда `npm run clean`: удаляет artifacts/
  config.ts            — типы и валидация project.config.ts
  data.ts              — чтение CSV с тест-данными
  env.ts               — чтение .env-файла (системные переменные в приоритете)
  events.ts            — запись событий/метрик в JSONL
  prometheus.ts        — сборка metrics.prom для Grafana
  playwright/          — fixtures и reporter для Playwright

projects/<name>/        — конкретный сайт или API под тестом (например, orange, eshop, accountApi)
  project.config.ts     — окружения, бюджеты и UI-профили ДЛЯ ЭТОГО проекта
  pages/                — Page Object (locators + методы)
  tests/ui, tests/api   — тесты
  load/scenario.js      — k6-сценарий нагрузки (только если проекту вообще нужна нагрузка)
  after-run.ts          — необязательная проверка после всех тестов
  data/*.csv            — тест-данные (без логинов и паролей — они в переменных окружения)
```

`core/` ничего не знает про конкретные проекты: он одинаково работает для любой папки
в `projects/`. Всё специфичное для сайта/API — URL, бюджеты, шаги теста, нагрузка —
живёт внутри папки этого проекта.

Готовый рабочий пример — `projects/orange` (см. `projects/orange/README.md`).
Чтобы добавить свой проект — скопируйте папку `projects/orange` как шаблон,
поменяйте `project.config.ts`, Page Object и тесты. В `core/` для этого заходить не нужно.

## Установка

```bash
npm ci
npx playwright install chromium
```

Для Allure 2 нужна Java 17+. Для нагрузочных тестов (`--suite api-load`) нужен k6
(`brew install k6` или https://k6.io/docs/get-started/installation/).

## Тест-данные и переменные окружения

Это разные вещи, и хранятся они по-разному:

**Тест-данные** (логины/пароли и всё, что перебирает data-driven тест) — в CSV:
`projects/<name>/data/*.csv`, путь передаётся флагом `--data`. Одна строка = один тест.
Файлы с реальными данными в `.gitignore`; в репозитории лежат шаблоны `*.csv.example` —
скопируйте шаблон на новой машине и впишите значения.

**Настройки окружения и инфраструктуры** (адреса, порты, доступы, пути к бинарникам) —
в переменных окружения с префиксом `K6_PERFORMANCE_`:

1. скопируйте `.env.k6_performance.example` в `.env.k6_performance` и впишите значения
   (файл в `.gitignore`), **или**
2. задайте те же переменные в системных переменных окружения — они имеют приоритет
   над файлом, поэтому на рабочей машине файл можно не держать вовсе.

В git не попадает ни то, ни другое — только шаблоны.

## Запуск

Ручной запуск одного набора тестов:

```bash
npm run qa -- --project <name> --env <env> --suite ui --profile smoke --data projects/<name>/data/cases.csv
```

Полный локальный прогон в 5 шагов (то, что нужно для разработки/демонстрации):

1. удаляем старые артефакты (`artifacts/`);
2. поднимаем Grafana + Prometheus в Docker;
3-4. запускаем тесты — `core/cli.ts` сам собирает Allure-результаты и `metrics.prom`;
5. открываем готовые отчёты (Allure в браузере, ссылка на Grafana в консоли).

```bash
npm run local -- --project <name> --env <env> --suite ui --profile smoke --data projects/<name>/data/cases.csv
```

Остановить Grafana/Prometheus: `npm run stack:down`.
Просто удалить артефакты без запуска тестов: `npm run clean`.

## Параметры `--suite`

- `ui` — Playwright UI-тесты из `projects/<name>/tests/ui`;
- `api` — функциональные Playwright API-тесты из `projects/<name>/tests/api`;
- `api-load` — нагрузочный тест через k6 (`projects/<name>/load/scenario.js`). Файл должен
  существовать в проекте — сам k6-сценарий (rps, длительность, пороги) целиком лежит внутри
  него, `core/` в это не вмешивается.

## Grafana без базы данных

Нужен только Docker Desktop:

```bash
open -a Docker
docker compose up -d
npm run qa -- --project <name> --env <env> --suite ui --profile smoke
```

Откройте http://localhost:3000, логин `admin`, пароль `admin`, затем dashboard
`QA runs and page performance`. Prometheus забирает `artifacts/metrics.prom` через маленький metrics-exporter.
PostgreSQL и другие базы данных в проекте не используются: у Prometheus нет постоянного volume,
поэтому `docker compose down` полностью сбрасывает его данные, а свежий `metrics.prom` каждый раз
пересобирается заново из `artifacts/events/*.jsonl`.

После каждого запуска метрики обновляются в том же файле. Если Grafana была запущена раньше,
подождите один scrape interval (5 секунд).

## Конфигурация проекта

У каждого проекта свой `project.config.ts`, например:

```ts
budgets: {
  pageReadyMs: 30000,   // Вся форма/страница должна появиться за 30 секунд.
  elementReadyMs: 3000, // Любой конкретный элемент ждём максимум 3 секунды.
},
profiles: {
  smoke: {
    ui: {
      workers: 10,             // Сколько тестов может выполняться одновременно.
      durationSeconds: 0,      // 0 = выполнить CSV один раз. Иначе — повторять партии N секунд.
      repeats: 1,
      lineIntervalSeconds: 5,  // Следующая CSV-строка стартует через N секунд после первой.
    },
  },
},
```

`workers` даёт параллельность. `lineIntervalSeconds` задаёт задержку старта по номеру строки
(строка 1 — сразу, строка 2 — через `lineIntervalSeconds`, строка 3 — через удвоенный интервал
и так далее); тесты при этом остаются параллельными. `elementReadyMs` дополнительно
ограничивается ядром 3000 мс.

## CSV

Обязательных колонок нет. `case_id` — если не указан, берётся номер строки (с 1); если указан,
должен быть уникальным на файл. `url` — если не указан, берётся адрес окружения. Любые другие
колонки автоматически становятся параметрами Allure и попадают в context-вложение при падении
теста — так можно, например, завести колонку-категорию (`segment=b2b`), которая может повторяться
у разных строк, в отличие от `case_id`.

## k6: своя нагрузка на каждый проект

Это enterprise-фреймворк: у разных проектов разные требования к нагрузке, поэтому `core/`
в это не лезет вообще. `load/scenario.js` — это самостоятельный k6-скрипт, как test plan
в JMeter: вся настройка (сколько запросов, с какой скоростью, сколько виртуальных
пользователей, какие пороги) описана прямо в нём. `core/cli.ts` просто запускает файл
командой `k6 run` и передаёт ему `QA_BASE_URL` (и `QA_DATA`, если передан `--data`) —
что дальше делать со скриптом, решает сам проект.

```js
// projects/<name>/load/scenario.js
import http from 'k6/http';
export const options = {
  scenarios: { requests: { executor: 'constant-arrival-rate', rate: 10, timeUnit: '1s', duration: '60s',
    preAllocatedVUs: 5, maxVUs: 10 } },
  thresholds: { http_req_duration: ['p(95)<500'], http_req_failed: ['rate==0'] },
};
export default function () {
  http.get(__ENV.QA_BASE_URL);
}
```

Если нужна нагрузка по тест-данным ("N запросов в секунду по всей CSV", как в JMeter) —
читайте `__ENV.QA_DATA` прямо в скрипте через `open()` и свой парсер (k6 выполняется не
в Node.js, поэтому `core/data.ts` внутри k6-скрипта использовать нельзя). Рабочий пример
без CSV — `projects/orange/load/scenario.js`.

## Что попадёт в Allure

Каждая строка CSV — отдельный тест с `case_id`, остальными колонками CSV, номером итерации,
profile и временем прогона. Внутри теста — пошаговые действия (`qa.step`), у каждого шага
понятное имя, поэтому по названию шага видно, на каком именно элементе/проверке тест упал.

При падении шага helper сразу пытается приложить:

- screenshot текущей страницы;
- исходную ошибку Playwright (текст и stack);
- обработанную ошибку фреймворка (JSON);
- context с URL, CSV-данными и уже собранными метриками.

Playwright также сохраняет screenshot/trace on failure. Если Chromium аварийно закрыт,
скриншот технически невозможен, но ошибка и context всё равно сохраняются.

Для `api-load` в Allure попадает один тест на весь прогон с параметром `url` и вложением
`k6-summary.json`; подробности по каждому HTTP-запросу — в `artifacts/k6-events.jsonl`.

## Метрики

Имена метрик выбирает сам тест при вызове `qa.measure(name, ...)` / `qa.measureElements(...)`.
Соглашение, которого стоит придерживаться: `element.<имя>` — время от начала открытия до
видимости элемента, `page.<имя>.ready` — время до готовности всей страницы/формы,
`check.<имя>` — время конкретной проверки текста/состояния. `page.ttfb`, `page.domContentLoaded`,
`page.load` пишутся автоматически (`qa.navigation()`) — это Navigation Timing браузера.
Для `api-load` метрики k6 попадают как `k6.<metric>.<stat>` (например, `k6.http_req_duration.p95`).
Все события хранятся в JSONL (`artifacts/events/`) и дублируются в Prometheus textfile для Grafana.

## Проверка кода

```bash
npm run check
```

CI/CD (Jenkins, GitHub Actions и т.д.) в этом репозитории намеренно нет — команды выше
рассчитаны на локальный запуск; пайплайн для конкретной инфраструктуры настраивают отдельно.
