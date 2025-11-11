/**
 * api/analyze-report.js
 * Minimal safe multipart receiver (debug only).
 */
module.exports = function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204; return res.end();
  }
  if (req.method !== 'POST') {
    res.statusCode = 405; return res.end('Method Not Allowed');
  }

  const chunks = [];
  req.on('data', (c) => chunks.push(Buffer.from(c)));
  req.on('end', () => {
    const buf = Buffer.concat(chunks);
    // Try to extract filename from multipart headers (best-effort)
    let filename = null;
    try {
      const s = buf.toString('latin1');
      const m = s.match(/filename="([^"]+)"/);
      if (m) filename = m[1];
    } catch (e) {}

    const snippet = buf.slice(0, 800).toString('base64');

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.statusCode = 200;
    res.end(JSON.stringify({
      ok: true,
      message: 'Received raw multipart body (debug).',
      filename,
      length: buf.length,
      snippet_base64: snippet
    }));
  });

  req.on('error', (err) => {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok:false, error: err.message }));
  });
};
