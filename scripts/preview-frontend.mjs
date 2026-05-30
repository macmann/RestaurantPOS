import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const root = join(process.cwd(), 'dist', 'frontend');
const port = Number(process.env.FRONTEND_PORT ?? process.env.PORT ?? 4173);
const host = process.env.HOST ?? '0.0.0.0';
const types = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
]);

function resolvePath(url) {
  const pathname = decodeURIComponent(new URL(url ?? '/', 'http://localhost').pathname);
  const safe = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
  const candidate = join(root, safe);
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return join(root, 'index.html');
}

createServer((req, res) => {
  const file = resolvePath(req.url);
  res.setHeader('content-type', types.get(extname(file)) ?? 'application/octet-stream');
  createReadStream(file).pipe(res);
}).listen(port, host, () => {
  console.log(`RestaurantPOS frontend preview listening on http://${host}:${port}`);
});
