// api/analyze-and-summarize.js
// Drop-in Vercel / Node handler:
// 1) accepts multipart (field name "file")
// 2) extracts text with pdf-parse
// 3) sends a prompt to OpenAI to extract structured JSON fields
// 4) returns JSON { ok, extracted: {...}, ai_raw: "...", raw_text: "..." }
//
// Requirements:
// - Install pdf-parse & multiparty in package.json (you already have them).
// - Set OPENAI_API_KEY in environment (Vercel: Project > Settings > Environment Variables).
//
// IMPORTANT: This sends PDF text to OpenAI — ensure you have necessary consent for PHI.

let multiparty, fs, pdfParse;
let _pdfloadError = null;
try {
  multiparty = require('multiparty');
  fs = require('fs');
  const _pdf = require('pdf-parse');
  pdfParse =
    typeof _pdf === 'function'
      ? _pdf
      : _pdf && (_pdf.default || _pdf).parse
      ? (_pdf.default || _pdf).parse
      : (_pdf.default || _pdf);
} catch (e) {
  _pdfloadError = String(e);
  try {
    multiparty = multiparty || require('multiparty');
  } catch (_) {}
  try {
    fs = fs || require('fs');
  } catch (_) {}
  pdfParse = null;
  console.error('pdf-parse load error:', _pdfloadError);
}

const OPENAI_KEY =
  process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY?.trim();

async function callOpenAI(prompt) {
  if (!OPENAI_KEY) throw new Error('Missing OPENAI_API_KEY environment variable');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are a strict JSON-only extractor. Return valid JSON only. Never add code fences or explanations.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.0,
      max_tokens: 1000,
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${txt}`);
  }

  const j = await res.json();
  const assistantText = j?.choices?.[0]?.message?.content ?? '';
  return { assistantText, rawResponse: j };
}

module.exports = function (req, res) {
  // CORS + preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(
      JSON.stringify({ ok: false, error: 'Method Not Allowed' })
    );
  }

  // If pdf-parse didn't load, return helpful error
  if (_pdfloadError || !pdfParse) {
    console.error('pdf-parse unavailable:', _pdfloadError);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(
      JSON.stringify({
        ok: false,
        error: 'pdf-parse not available',
        details: _pdfloadError || 'pdfParse === null',
      })
    );
  }

  const form = new multiparty.Form({ maxFilesSize: 80 * 1024 * 1024 });

  form.parse(req, async (err, fields, files) => {
    try {
      if (err) {
        console.error('multipart parse error:', String(err));
        res.statusCode = 500;
        return res.end(
          JSON.stringify({
            ok: false,
            error: 'multipart parse error',
            details: String(err),
          })
        );
      }

      const fileArr = files?.file;
      if (!fileArr || !fileArr[0]) {
        res.statusCode = 400;
        return res.end(
          JSON.stringify({
            ok: false,
            error: 'no file uploaded (field must be named "file")',
          })
        );
      }

      const f = fileArr[0];
      let buffer;
      try {
        buffer = fs.readFileSync(f.path);
      } catch (readErr) {
        console.error('readFileSync error:', String(readErr));
        res.statusCode = 500;
        return res.end(
          JSON.stringify({
            ok: false,
            error: 'could not read uploaded file',
            details: String(readErr),
          })
        );
      }

      let data;
      try {
        data = await pdfParse(buffer);
      } catch (parseErr) {
        console.error('pdfParse failed:', String(parseErr));
        res.statusCode = 500;
        return res.end(
          JSON.stringify({
            ok: false,
            error: 'pdfParse failed',
            details: String(parseErr),
          })
        );
      }

      const rawText = (data.text || '').trim();

      // Build extraction prompt (conservative length)
      const prompt = `
You are Cureon AI. You explain ANY medical report for worried patients and parents.

Your job:
- Give a calm, clear explanation in SIMPLE language.
- Give SPECIFIC next steps and ONE best doctor specialty.
- Never scare the user unnecessarily, but never hide serious problems.

You MUST return ONLY valid JSON. No extra text, no commentary.

Return exactly these fields:

{
  "patient_name": "",
  "age_gender": "",
  "study": "",
  "summary_for_patient": "",
  "impression": "",
  "findings": "",
  "recommended_next_steps": "",
  "specialty_referral": "",
  "triage_urgency": ""
}

FIELD RULES:

1) patient_name
- Extract from the report if clearly visible. Else "Unknown".

2) age_gender
- Combine age + sex, like "3-year-old male". Else "Unknown".

3) study
- Identify type of report: CBC, NIPT, urine test, MRI, ultrasound, etc.

4) summary_for_patient
- 3–4 short sentences maximum.
- NO medical terms. NO lab names. NO values.
- Explain the overall picture in simple, emotional, everyday language.
- Must NOT repeat anything from other fields.

5) impression
- Bullet style only.
- Example:
  • "Term" means …
  • "Another term" means …
- MUST quote at least 2 real medical terms.
- Simple explanations allowed.

6) findings
- Bullet list.
- Each bullet < 12–15 words.
- Specific abnormal results only.
- Must NOT repeat impression or summary sentences.

7) recommended_next_steps
- MUST NOT be empty.
- 3–6 clear bullets.
- Example style:
  • Book an appointment with a [doctor type] within [timeframe].
  • Ask the doctor about [specific issue].
  • Repeat the test in [timeframe].
  • Seek urgent care IF you notice [red flags].

8) specialty_referral
- ONE specialty only.
- Examples: "Pediatric Hematologist", "Pediatric Allergist/Immunologist", "Hematologist", "Pediatrician".
- Choose the MOST relevant based on the report.

9) triage_urgency
- One of: "normal" | "low" | "medium" | "high".
- high = same-day / emergency.
- medium = days.
- low = weeks.
- normal = no concern.

GLOBAL RULES:
- Each field MUST have unique content.
- NO repeated sentences.
- NO headings like "Summary:" inside fields.
- You MUST output ONLY the JSON object.
- If report text is incomplete, still fill all JSON fields based on context.

Report text:
\`\`\`
${rawText.slice(0, 24000)}
\`\`\`
`;

      // Call OpenAI
      let aiResult;
      try {
        aiResult = await callOpenAI(prompt);
      } catch (aiErr) {
        console.error('OpenAI call failed:', String(aiErr));
        res.statusCode = 500;
        return res.end(
          JSON.stringify({
            ok: false,
            error: 'OpenAI call failed',
            details: String(aiErr),
          })
        );
      }

      // Try to parse assistant JSON; if parse fails, return raw assistant text
      let parsed = null;
      try {
        parsed = JSON.parse(aiResult.assistantText);
      } catch (jsonErr) {
        parsed = null;
        console.warn(
          'Failed to parse AI JSON. Returning raw assistant text instead.'
        );
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(
        JSON.stringify({
          ok: true,
          filename: f.originalFilename || null,
          length: buffer.length,
          pages: data.numpages || null,
          info: data.info || null,
          raw_text: rawText,
          ai_raw: aiResult.assistantText,
          ai_response_full: aiResult.rawResponse,
          extracted: parsed,
        })
      );
    } catch (outer) {
      console.error('unexpected handler error:', String(outer));
      res.statusCode = 500;
      return res.end(
        JSON.stringify({
          ok: false,
          error: 'unexpected error',
          details: String(outer),
        })
      );
    }
  });
};
