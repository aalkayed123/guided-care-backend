module.exports = (req,res) => {
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  const has = !!process.env.OPENAI_API_KEY;
  res.setHeader("Content-Type","application/json; charset=utf-8");
  return res.end(JSON.stringify({ ok:true, OPENAI_API_KEY_present: has }));
};
