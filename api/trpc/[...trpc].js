/**
 * api/trpc/[...trpc].js
 * Minimal handler: CORS + preflight + a simple POST /.../test responder
 */
module.exports = function (req, res) {
  // CORS (keep wide for testing — change '*' in production)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  // If the path contains '/test' return a simple JSON echo
  // (Vercel routes like /api/trpc/test will match this file)
  if (req.method === 'POST' && req.url && req.url.indexOf('/test') !== -1) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, echo: body ? JSON.parse(body) : null }));
    });
    return;
  }

  // default: not implemented (keeps previous behavior)
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.statusCode = 404;
  res.end('Not implemented: tRPC handler not attached yet');
};
