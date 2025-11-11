const multiparty = require("multiparty");
const pdfParse = require("pdf-parse");

module.exports = async function (req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const form = new multiparty.Form();

  form.parse(req, async (err, fields, files) => {
    if (err) {
      res.status(400).json({ ok: false, error: "File parse error" });
      return;
    }

    const file = files.file?.[0];
    if (!file) {
      res.status(400).json({ ok: false, error: "No file uploaded" });
      return;
    }

    try {
      const dataBuffer = require("fs").readFileSync(file.path);
      const pdfData = await pdfParse(dataBuffer);

      res.status(200).json({
        ok: true,
        filename: file.originalFilename,
        text: pdfData.text.slice(0, 1000), // first 1000 chars
        pages: pdfData.numpages
      });

    } catch (pdfErr) {
      res.status(500).json({ ok: false, error: "PDF parse failed", details: pdfErr.message });
    }
  });
};
