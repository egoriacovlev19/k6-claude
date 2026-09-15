const fs = require('node:fs');
const http = require('node:http');

// Маленький read-only exporter. Он отдаёт актуальный metrics.prom, который создал тестовый runner.
http.createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200);
    response.end('ok');
    return;
  }
  if (request.url !== '/metrics') {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  const file = '/artifacts/metrics.prom';
  const body = fs.existsSync(file) ? fs.readFileSync(file) : '# no test results yet\n';
  response.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
  response.end(body);
}).listen(9100, '0.0.0.0');
