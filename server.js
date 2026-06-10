const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const port = Number(process.env.PORT || 8000);
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
};

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https:",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
].join('; ');

function send(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(body);
}

function resolveRequestPath(url) {
  const pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.resolve(root, relativePath);

  if (!filePath.startsWith(root + path.sep)) return null;
  return filePath;
}

const server = http.createServer((request, response) => {
  const filePath = resolveRequestPath(request.url);
  if (filePath === null) {
    send(response, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      send(response, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }

    const contentType = contentTypes[path.extname(filePath)] || 'application/octet-stream';
    send(response, 200, data, { 'Content-Type': contentType });
  });
});

server.listen(port, () => {
  console.log(`Serving Life on port ${port}`);
});
