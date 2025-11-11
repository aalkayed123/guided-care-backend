/**
 * api/analyze-report.js -- fail-safe debug handler for Vercel
 * - robust pdf-parse require
 * - extensive logging (console.log/console.error)
 * - never throws (always responds JSON)
 */
const multiparty = require('multiparty');
const fs = require('fs');

// robust require for pdf-parse (works with different module shapes)
const _pdfparse_lib = require('pdf-parse');
const pdfParse = (typeof _pdfparse_lib === 'function')
  ? _pdfparse_lib
  : (_pdfparse_lib && (_pdfparse_lib.default || _pdfparse_lib).parse ? (_pdfparse_lib.default || _pdfparse_lib).parse : (_pdfparse_lib.default || _pdfparse_lib));

console.log('analyze-report loaded, pdfParse type:', typeof pdfParse);

module.exports = function (req, res) {
  console.log('handler invoked, method=', req.method, 'url=', req.url);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok:false, error:'Method Not Allowed' }));
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
        console.warn('no file uploaded in field "file" (fields keys):', Object.keys(fields || {}));
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok:false, error:'no file uploaded (field must be named \"file\")' }));
      }

      const f = fileArr[0];
      console.log('uploaded file info:', { fieldName: f.fieldName, originalFilename: f.originalFilename, path: f.path, size: f.size });

      let buffer;
      try {
        buffer = fs.readFileSync(f.path);
      } catch (readErr) {
        console.error('readFileSync error:', String(readErr));
        res.statusCode = 500;
        return res.end(JSON.stringify({ ok:false, error:'could not read uploaded file', details: String(readErr) }));
      }

      if (!pdfParse || typeof pdfParse !== 'function') {
        console.error('pdfParse is not a function. typeof pdfParse=', typeof pdfParse, 'pdf-parse lib keys:', Object.keys(require('pdf-parse') || {}));
        res.statusCode = 500;
        return res.end(JSON.stringify({ ok:false, error:'pdf-parse not available in runtime', details: 'pdfParse is not a function' }));
      }

      let data;
      try {
        data = await pdfParse(buffer);
      } catch (parseErr) {
        console.error('pdfParse failed:', String(parseErr));
        res.statusCode = 500;
        return res.end(JSON.stringify({ ok:false, error:'pdfParse failed', details: String(parseErr) }));
      }

      // success
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({
        ok: true,
        filename: f.originalFilename || null,
        length: buffer.length,
        pages: data.numpages || null,
        info: data.info || null,
        text_snippet: (data.text || '').slice(0, 1000)
      }));
    } catch (outer) {
      console.error('unexpected handler error:', String(outer));
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok:false, error:'unexpected error', details: String(outer) }));
    }
  });

  req.on('error', e => {
    console.error('req error event:', String(e));
  });
};
