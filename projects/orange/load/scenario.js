import http from 'k6/http';
import { check } from 'k6';

// k6-сценарий для Orange — как test plan в JMeter: вся настройка нагрузки лежит
// прямо здесь, в проекте. Ядро фреймворка (core/) этот файл просто запускает
// и ничего в нём не подставляет.
//
// Это нагрузка на страницу логина, а не на API: у Orange нет отдельного API,
// который мы тестируем, — грузим тот же GET, что открывает браузер в UI-тесте.
export const options = {
  scenarios: {
    requests: {
      executor: 'constant-arrival-rate',
      rate: 1,             // 1 запрос...
      timeUnit: '5s',       // ...каждые 5 секунд...
      duration: '60s',      // ...в течение 60 секунд (≈ 12 запросов).
      preAllocatedVUs: 1,   // Такой редкий трафик обслуживает один виртуальный пользователь.
      maxVUs: 2,            // Небольшой запас на случай, если ответ сайта задержится.
      gracefulStop: '10s',
    },
  },
  thresholds: {
    // Стартовая прикидка. Поправьте на реальный p95 после первого прогона
    // (artifacts/allure-report → API load → вложение k6 summary).
    http_req_duration: ['p(95)<5000'],
    http_req_failed: ['rate==0'],
    checks: ['rate==1'],
  },
};

export default function () {
  const response = http.get(__ENV.QA_BASE_URL, { redirects: 0, timeout: '5s', tags: { name: 'orange-login-page' } });
  check(response, { 'page is reachable': r => r.status === 200 || (r.status >= 300 && r.status < 400) });
}
