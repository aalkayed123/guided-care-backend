const busboy = require("busboy");
const pdf = require("pdf-parse");

module.exports = function (req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end("Method Not Allowed");
  }

  const bb = busboy({ headers: req.headers });
  let fileBuffer = Buffer.alloc(0);
  let filename = "";

  bb.on("file", (name, file, info) => {
    filename = info.filename;
    file.on("data", (data) => {
      fileBuffer = Buffer.concat([fileBuffer, data]);
    });
  });

  bb.on("finish", async () => {
    try {
      const pdfData = await pdf(fileBuffer);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        ok: true,
        filename,
        text_preview: pdfData.text.slice(0, 500)
      }));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  });

  req.pipe(bb);
};
