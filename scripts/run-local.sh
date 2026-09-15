#!/usr/bin/env bash
set -e

# Локальный прогон в 5 шагов:
# 1) удалить старые артефакты;
# 2) поднять Docker-образы и контейнеры (Grafana + Prometheus);
# 3) прогнать тесты;
# 4) собрать статистику (Allure-результаты + metrics.prom для Grafana);
# 5) открыть Allure 2 и Grafana.
#
# Шаги 3 и 4 идут одной командой `npm run qa`: core/cli.ts собирает статистику
# сразу после того, как тесты завершились, — раньше собирать нечего.
#
# Аргументы передаются как есть в `npm run qa`, например:
#   npm run local -- --project orange --env production --suite ui --profile smoke --data projects/orange/data/pages.csv

echo "1/5: удаляем старые артефакты"
npm run clean

echo "2/5: поднимаем Docker-образы и контейнеры (Grafana + Prometheus)"
docker compose up -d

echo "3-4/5: запускаем тесты и собираем статистику (Allure-результаты + metrics.prom)"
# Тесты могут падать — это нормальный результат прогона, а не сбой скрипта.
# Отчёты должны собраться в любом случае, поэтому отключаем set -e только на этот шаг.
set +e
npm run qa -- "$@"
qa_exit_code=$?
set -e

echo "5/5: открываем Allure 2 и Grafana"
npx allure open artifacts/allure-report &
echo "Grafana: http://localhost:3000 (admin/admin) -> дашборд 'QA runs and page performance'"

# Код возврата скрипта отражает результат тестов (для CI/автоматизации),
# но отчёты к этому моменту уже собраны и открыты.
exit $qa_exit_code
