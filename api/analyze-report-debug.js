module.exports = function (req,res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, Accept');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method Not Allowed'); }
  const chunks=[];
  req.on('data',c=>chunks.push(Buffer.from(c)));
  req.on('end',()=>{
    try{
      const buf=Buffer.concat(chunks);
      const snippet = buf.slice(0,800).toString('base64');
      res.statusCode=200;
      res.setHeader('Content-Type','application/json; charset=utf-8');
      res.end(JSON.stringify({ok:true, length: buf.length, snippet_base64: snippet}));
    }catch(e){
      res.statusCode=500;
      res.end(JSON.stringify({ok:false,error:String(e)}));
    }
  });
  req.on('error',e=>{ res.statusCode=500; res.end(JSON.stringify({ok:false,error:String(e)})); });
};
