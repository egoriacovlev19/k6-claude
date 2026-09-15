# QA performance framework

Документация перенесена в [docs/README.md](docs/README.md).
Технический и бизнес-контекст для ИИ/новых участников — [docs/CONTEXT.md](docs/CONTEXT.md).
Стиль кода и правила — [docs/AGENTS.md](docs/AGENTS.md).

## Что это и зачем

Простой enterprise-фреймворк для UI/API тестирования и нагрузочного тестирования сайтов и API.
Ядро (`core/`) и конфигурация тестируемых проектов (`projects/<name>/`) разделены: чтобы
протестировать новый сайт или API, не нужно трогать ядро — только добавить папку проекта.
Результаты — в Allure 2 (шаги, параметры, скриншоты и ошибки при падении) и в Grafana
(графики времени загрузки и статусов), без базы данных. Рассчитан на локальный запуск.

**Стек:** TypeScript (Node.js, без сборки) + Playwright (UI/API) + k6 (нагрузка) + Allure 2 +
Prometheus/Grafana в Docker.

## Установка с нуля (macOS)

```bash
# 1. Node.js 22+
brew install node@22

# 2. Docker Desktop — для Grafana/Prometheus (без БД)
brew install --cask docker
open -a Docker

# 3. Java 17+ — нужна для генерации отчёта Allure 2
brew install openjdk@17

# 4. k6 — только если будете гонять нагрузочные тесты (--suite api-load)
brew install k6

# 5. Зависимости проекта и браузер для Playwright
npm ci
npx playwright install chromium
```

## Перед первым запуском (macOS)

```bash
# Тест-данные: скопируйте шаблон и впишите реальные логины/пароли (файл не попадёт в git)
cp projects/orange/data/pages.csv.example projects/orange/data/pages.csv

# Необязательно: переменные окружения (порты, путь к k6, вход в Grafana).
# Вместо файла их можно задать в системных переменных окружения — они в приоритете.
cp .env.k6_performance.example .env.k6_performance
```

## Запуск тестов

Базовая команда — подходит для любого проекта из `projects/`:

```bash
npm run qa -- --project <name> --env <env> --suite ui --profile smoke --data projects/<name>/data/cases.csv
```

Пример для готового проекта **Orange** (реальный кейс, лежит в `projects/orange`):

```bash
npm run qa -- --project orange --env production --suite ui --profile smoke --data projects/orange/data/pages.csv
```

Или полный локальный прогон в 5 шагов (очистка артефактов → Docker → тесты → сбор статистики →
открытие Allure и Grafana) готовой командой:

```bash
npm run orange
```

На Windows эта команда не работает — используйте `bash scripts/run-local.sh ...` в Git Bash
(см. раздел «Windows: установка и запуск»).

Подробности всех команд, параметров и структуры — в [docs/README.md](docs/README.md).

## Windows: установка и запуск

### 1. Установить программы (PowerShell)

```powershell
winget install OpenJS.NodeJS.LTS                # Node.js
winget install Docker.DockerDesktop             # Docker — для Grafana/Prometheus
winget install EclipseAdoptium.Temurin.17.JDK   # Java 17 — для отчёта Allure
winget install Git.Git                          # Git + Git Bash
winget install k6 --source winget               # k6 — только для нагрузки (--suite api-load)
```

После установки:

- **закройте терминал и откройте заново** — иначе новые программы не появятся в PATH;
- **запустите Docker Desktop** и дождитесь статуса *Engine running*. При первом запуске он может
  попросить включить WSL 2 и перезагрузить компьютер — это нормально.

### 2. Все дальнейшие команды — в Git Bash

Откройте **Git Bash** (Пуск → Git Bash) и перейдите в папку проекта:

```bash
cd /c/путь/до/проекта
```

Почему Git Bash, а не PowerShell или cmd: полный прогон — это bash-скрипт, а `npm run orange`
на Windows запускает не Git Bash, а bash из WSL (он появляется вместе с Docker Desktop),
и скрипт не отработает. В PowerShell к тому же часто заблокирован запуск `npx`.

Проверить, что всё установилось:

```bash
node -v
java -version
docker version
k6 version
```

### 3. Подготовить проект (один раз)

```bash
npm ci
npx playwright install chromium

# Тест-данные: скопируйте шаблон и впишите реальные логины/пароли (файл не попадёт в git)
cp projects/orange/data/pages.csv.example projects/orange/data/pages.csv

# Необязательно: переменные окружения (порты, путь к k6, вход в Grafana)
cp .env.k6_performance.example .env.k6_performance
```

### 4. Запуск

Только тесты:

```bash
npm run qa -- --project orange --env production --suite ui --profile smoke --data projects/orange/data/pages.csv
```

Полный прогон в 5 шагов (очистка → Docker → тесты → статистика → Allure и Grafana).
**На Windows — вместо `npm run orange`:**

```bash
bash scripts/run-local.sh --project orange --env production --suite ui --profile smoke --data projects/orange/data/pages.csv
```

Остановить Grafana/Prometheus:

```bash
npm run stack:down
```

### Переменные окружения в системе Windows

Вместо файла `.env.k6_performance` переменные `K6_PERFORMANCE_*` можно задать в системе —
они в приоритете над файлом. Список — в `.env.k6_performance.example`.

- через окно: Win+R → `sysdm.cpl` → «Дополнительно» → «Переменные среды»;
- или командой: `setx K6_PERFORMANCE_GRAFANA_PORT 3100`.

После этого откройте терминал заново — уже открытые окна новые переменные не видят.

### Если что-то не запускается

| Ошибка | Что делать |
|---|---|
| `$'\r': command not found` при запуске `run-local.sh` | у файла Windows-переносы строк: `sed -i 's/\r$//' scripts/run-local.sh` |
| `node` / `java` / `docker` / `k6`: command not found | терминал открыт до установки — откройте заново |
| `Cannot connect to the Docker daemon` / `docker compose` падает | Docker Desktop не запущен или ещё стартует |
| `Allure generation failed ... Check Java installation` | `java -version` должен показать 17 или выше |
| `running scripts is disabled on this system` | команда запущена в PowerShell — выполните её в Git Bash |

---

*Imagined by us. Generated by AI.*
*Used AI — Claude Sonnet 5 ([Claude Code](https://claude.com/claude-code)).*
