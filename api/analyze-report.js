/**
 * api/analyze-report.js -- module-load safe handler
 * If pdf-parse fails to load during require(), this still starts and returns a JSON error.
 * Replace current file with this exact content.
 */
let multiparty;
let fs;
let pdfParse;
let _pdfparse_load_error = null;

try {
  multiparty = require('multiparty');
  fs = require('fs');
  // attempt robust import of pdf-parse
  const _pdf = require('pdf-parse');
  pdfParse = (typeof _pdf === 'function')
    ? _pdf
    : (_pdf && (_pdf.default || _pdf).parse ? (_pdf.default || _pdf).parse : (_pdf.default || _pdf));
} catch (e) {
  // capture error but don't rethrow — allow module to load
  _pdfparse_load_error = String(e);
  // minimal fallbacks so code referencing multiparty/fs doesn't crash if missing
  try { multiparty = multiparty || require('multiparty'); } catch (_) {}
  try { fs = fs || require('fs'); } catch (_) {}
  pdfParse = null;
  console.error('module-load: pdf-parse require failed:', _pdfparse_load_error);
  console.error('module-load stack (short):', (e && e.stack) ? e.stack.split("\\n").slice(0,4).join(" | ") : '');
}

module.exports = function (req, res) {
  // always log top-level entry
  console.log('analyze-report handler entry; method=', req && req.method, 'url=', req && req.url, 'pdfParse-available=', !!pdfParse);

  // CORS + preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (!req || !res) return;

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ ok:false, error:'Method Not Allowed' }));
    return;
  }

  // If pdf-parse failed to load at module time, return helpful JSON (no crash).
  if (_pdfparse_load_error || !pdfParse) {
    console.error('pdf-parse unavailable at runtime. module-load error:', _pdfparse_load_error);
    res.statusCode = 500;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    return res.end(JSON.stringify({
      ok:false,
      error:'pdf-parse not available in runtime',
      details: _pdfparse_load_error || 'pdfParse === null'
    }));
  }

  const form = new multiparty.Form({ maxFilesSize: 50 * 1024 * 1024 });

  form.parse(req, async (err, fields, files) => {
    try {
      if (err) {
        console.error('multipart parse error:', String(err));
        res.statusCode = 500;
        return res.end(JSON.stringify({ ok:false, error:'multipart parse error', details: String(err) }));
      }

      const fileArr = files?.file;
      if (!fileArr || !fileArr[0]) {
        console.warn('no file uploaded in field "file"; fields keys:', Object.keys(fields || {}));
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok:false, error:'no file uploaded (field must be named \"file\")' }));
      }

      const f = fileArr[0];
      console.log('uploaded file:', { originalFilename: f.originalFilename, path: f.path, size: f.size });

      let buffer;
      try {
        buffer = fs.readFileSync(f.path);
      } catch (readErr) {
        console.error('readFileSync error:', String(readErr));
        res.statusCode = 500;
        return res.end(JSON.stringify({ ok:false, error:'could not read uploaded file', details: String(readErr) }));
      }

      let data;
      try {
        data = await pdfParse(buffer);
      } catch (parseErr) {
        console.error('pdfParse failed:', String(parseErr));
        res.statusCode = 500;
        return res.end(JSON.stringify({ ok:false, error:'pdfParse failed', details: String(parseErr) }));
      }

      res.statusCode = 200;
      res.setHeader('Content-Type','application/json; charset=utf-8');
      res.end(JSON.stringify({
        ok:true,
        filename: f.originalFilename || null,
        length: buffer.length,
        pages: data.numpages || null,
        info: data.info || null,
        text_snippet: (data.text || '').slice(0,2000)
      }));
    } catch (outer) {
      console.error('unexpected handler error:', String(outer));
      res.statusCode = 500;
      res.end(JSON.stringify({ ok:false, error:'unexpected error', details: String(outer) }));
    }
  });

  req.on('error', e => console.error('req error event:', String(e)));
};
