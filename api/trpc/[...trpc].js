// api/trpc/[...trpc].js
// Simple CORS + OPTIONS preflight handler for all /api/trpc/* requests.
//
// This makes the browser preflight succeed (204) so your frontend can send POSTs.
// Later you will wire this file to the real tRPC handler (below is a small placeholder).

module.exports = function (req, res) {
  // Allow CORS from any origin while debugging (change '*' to your front-end origin in production)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Preflight request -> respond immediately with 204 No Content
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  // ----- Temporary placeholder for actual tRPC handling -----
  // If you already have a tRPC server handler, call it here instead of returning 404.
  // Example (if you add a real handler): require('./trpc-handler').default(req, res)
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.statusCode = 404;
  res.end('Not implemented: tRPC handler not attached yet');
};

