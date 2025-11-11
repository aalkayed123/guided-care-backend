// api/analyze-report.js
const multiparty = require('multiparty');
const fs = require('fs');
const pdfParse = require('pdf-parse');

module.exports = function (req, res) {
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
    return res.end('Method Not Allowed');
  }

  const form = new multiparty.Form({ maxFilesSize: 50 * 1024 * 1024 });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, error: 'multipart parse error', details: String(err) }));
    }

    const fileArr = files?.file;
    if (!fileArr || !fileArr[0]) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok: false, error: 'no file uploaded (field must be named "file")' }));
    }

    const f = fileArr[0];

    try {
      const buffer = fs.readFileSync(f.path);
      const data = await pdfParse(buffer);

      res.statusCode = 200;
      return res.end(
        JSON.stringify({
          ok: true,
          filename: f.originalFilename || f.path,
          length: buffer.length,
          pages: data.numpages || null,
          info: data.info || null,
          text_snippet: (data.text || '').slice(0, 2000),
        })
      );
    } catch (e) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, error: 'processing failed', details: String(e) }));
    }
  });

  req.on('error', (e) => {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: 'request stream error', details: String(e) }));
  });
};
