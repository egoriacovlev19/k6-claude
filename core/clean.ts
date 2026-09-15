import fs from 'node:fs';
import path from 'node:path';

// Отдельная команда: удаляет старые артефакты (Allure, события, metrics.prom для Grafana).
// core/cli.ts и так чистит artifacts перед каждым запуском тестов — эта команда нужна,
// когда надо просто очистить папку без запуска тестов (например, перед новым прогоном вручную).
//
// Важно: удаляем только СОДЕРЖИМОЕ artifacts, а не саму папку. docker-compose.yml
// монтирует artifacts в контейнер metrics-exporter, а Docker bind mount привязан
// к конкретной директории (inode) — пересоздание папки его ломает, и Grafana
// после этого показывает "No data", даже когда на хосте свежие метрики есть.
const directory = path.resolve('artifacts');
fs.mkdirSync(directory, { recursive: true });
for (const entry of fs.readdirSync(directory)) fs.rmSync(path.join(directory, entry), { recursive: true, force: true });
console.log(`Очищено: ${directory}`);
