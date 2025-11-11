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
  pdfParse = (typeof _pdf === 'function') ? _pdf
    : (_pdf && (_pdf.default || _pdf).parse ? (_pdf.default || _pdf).parse : (_pdf.default || _pdf));
} catch (e) {
  _pdfloadError = String(e);
  try { multiparty = multiparty || require('multiparty'); } catch (_) {}
  try { fs = fs || require('fs'); } catch (_) {}
  pdfParse = null;
  console.error('pdf-parse load error:', _pdfloadError);
}

const OPENAI_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY?.trim();

async function callOpenAI(prompt) {
  if (!OPENAI_KEY) throw new Error('Missing OPENAI_API_KEY environment variable');

  // Use fetch (available in Node 18+ / Node 24)
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',        // change if needed
      messages: [
        { role: 'system', content: 'You are a strict JSON-only extractor. Return valid JSON only.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.0,
      max_tokens: 1000
    })
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${txt}`);
  }

  const j = await res.json();
  // Extract assistant text (handle multiple choices)
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
    return res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }));
  }

  // If pdf-parse didn't load, return helpful error
  if (_pdfloadError || !pdfParse) {
    console.error('pdf-parse unavailable:', _pdfloadError);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ ok: false, error: 'pdf-parse not available', details: _pdfloadError || 'pdfParse === null' }));
  }

  const form = new multiparty.Form({ maxFilesSize: 80 * 1024 * 1024 });

  form.parse(req, async (err, fields, files) => {
    try {
      if (err) {
        console.error('multipart parse error:', String(err));
        res.statusCode = 500;
        return res.end(JSON.stringify({ ok: false, error: 'multipart parse error', details: String(err) }));
      }

      const fileArr = files?.file;
      if (!fileArr || !fileArr[0]) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok: false, error: 'no file uploaded (field must be named "file")' }));
      }

      const f = fileArr[0];
      let buffer;
      try { buffer = fs.readFileSync(f.path); } catch (readErr) {
        console.error('readFileSync error:', String(readErr));
        res.statusCode = 500;
        return res.end(JSON.stringify({ ok: false, error: 'could not read uploaded file', details: String(readErr) }));
      }

      let data;
      try {
        data = await pdfParse(buffer);
      } catch (parseErr) {
        console.error('pdfParse failed:', String(parseErr));
        res.statusCode = 500;
        return res.end(JSON.stringify({ ok: false, error: 'pdfParse failed', details: String(parseErr) }));
      }

      const rawText = (data.text || '').trim();
      // Build extraction prompt (conservative length)
      const prompt = `You are a medical-report extraction assistant.
INPUT: a radiology/pathology/clinical REPORT. OUTPUT: strictly valid JSON only (no commentary, no surrounding text, no markdown).

Return EXACTLY one JSON object with the following keys (use null when information is missing):
- patient_name (string|null)
- patient_id (string|null)
- age_gender (string|null)
- study (string|null)           // e.g., "DORSAL SPINE MRI WITH CONTRAST"
- findings (string|null)        // concise sentence(s)
- impression (string|null)      // concise
- recommended_next_steps (string|null) // concrete next steps: e.g. "urgent neurosurgery referral within 48 hrs", "schedule outpatient neurosurgery", "conservative management and follow-up 6 weeks"
- triage_urgency (one of: "emergent", "urgent (<72h)", "soon (1-2 weeks)", "routine", null)
- specialty_referral (string|null) // e.g., "Neurosurgery", "Orthopedics", "Neurology"
- important_numbers (object) { WBC, Hb, platelets, other_lab_values: {} } // use nulls or empty object if none
- clinician_summary (string|null) // 1-2 sentence plain-language summary for the treating clinician
- confidence_notes (string|null) // short note if uncertain (e.g., 'report truncated', 'inference: likely meningioma')

IMPORTANT:
1) Return STRICT valid JSON only. Nothing else.
2) For recommended_next_steps, infer reasonable actionable next steps even if not explicitly stated.
3) If there is cord compression or severe spinal canal compromise, set triage_urgency to 'urgent (<72h)' or 'emergent' as appropriate.
4) Keep values concise.
5) Put clinical inferences in clinician_summary and mention uncertainty in confidence_notes.

REPORT_TEXT:
\"\"\"${rawText.slice(0,24000)}\"\"\"
`;


      // Call OpenAI
      let aiResult;
      try {
        aiResult = await callOpenAI(prompt);
      } catch (aiErr) {
        console.error('OpenAI call failed:', String(aiErr));
        res.statusCode = 500;
        return res.end(JSON.stringify({ ok: false, error: 'OpenAI call failed', details: String(aiErr) }));
      }

      // Try to parse assistant JSON; if parse fails return raw assistant text
      let parsed = null;
      try {
        parsed = JSON.parse(aiResult.assistantText);
      } catch (jsonErr) {
        parsed = null;
        console.warn('Failed to parse AI JSON. Returning raw assistant text instead.');
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({
        ok: true,
        filename: f.originalFilename || null,
        length: buffer.length,
        pages: data.numpages || null,
        info: data.info || null,
        raw_text: rawText,
        ai_raw: aiResult.assistantText,
        ai_response_full: aiResult.rawResponse,
        extracted: parsed
      }));
    } catch (outer) {
      console.error('unexpected handler error:', String(outer));
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, error: 'unexpected error', details: String(outer) }));
    }
  });
};
