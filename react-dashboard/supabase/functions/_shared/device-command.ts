const reply = (status: number, body: unknown) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
});
const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
async function sameToken(a: string, b: string) {
  const hash = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [x,y] = await Promise.all([hash(a),hash(b)]);
  let difference = 0;
  for (let i=0;i<x.length;i++) difference |= x[i]^y[i];
  return difference === 0;
}
export function deviceCommandHandler(report: boolean) {
  return async (req: Request) => {
    if (req.method !== 'POST') return reply(405,{error:'POST required'});
    const credentials = [5,201].map(masterId => ({masterId, token:Deno.env.get(`MASTER_${masterId}_DEVICE_TOKEN`)})).filter(c => c.token && c.token.length >= 32);
    const key = Deno.env.get('INGEST_DB_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const url = Deno.env.get('SUPABASE_URL');
    if (!credentials.length || !key || !url) return reply(503,{error:'Server configuration incomplete'});
    const supplied = req.headers.get('X-Device-Token') || '';
    if (supplied.length>256) return reply(401,{error:'Invalid device token'});
    const matches = [];
    for (const c of credentials) if (await sameToken(supplied,c.token!)) matches.push(c.masterId);
    if (matches.length !== 1) return reply(401,{error:'Invalid or ambiguous device token'});
    const masterId = matches[0];
    try {
      const reader = req.body?.getReader();
      if (!reader) return reply(400,{error:'Missing body'});
      const chunks: Uint8Array[]=[]; let size=0;
      for (;;) {
        const {done,value}=await reader.read(); if(done) break;
        size+=value.length; if(size>2048) {await reader.cancel(); return reply(413,{error:'Body too large'});}
        chunks.push(value);
      }
      const bytes=new Uint8Array(size); let offset=0;
      for(const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.length;}
      let body;
      try {body=JSON.parse(new TextDecoder().decode(bytes));} catch {return reply(400,{error:'Invalid JSON'});}
      if(!body || typeof body!=='object' || Array.isArray(body)) return reply(400,{error:'Invalid body'});
      const args: Record<string,unknown>={p_master_id:masterId};
      if(report) {
        if(!uuid(body.id) || !uuid(body.claim_token) || !Number.isInteger(body.radio_command_id)
          || body.radio_command_id<1 || body.radio_command_id>2147483647
          || !['confirmed','rejected','unconfirmed','expired'].includes(body.outcome)
          || (body.reported_mode!=null && ![0,1].includes(body.reported_mode))
          || (body.outcome==='confirmed' && ![0,1].includes(body.reported_mode))) return reply(400,{error:'Invalid report'});
        Object.assign(args,{p_id:body.id,p_claim_token:body.claim_token,p_radio_command_id:body.radio_command_id,
          p_outcome:body.outcome,p_reported_mode:body.reported_mode??null});
      }
      const result=await fetch(url+'/rest/v1/rpc/'+(report?'report_master_command':'claim_master_command'),{
        method:'POST', headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
        body:JSON.stringify(args), signal:AbortSignal.timeout(10000),
      });
      if(!result.ok) return reply(503,{error:'Command database unavailable'});
      const data=await result.json();
      return reply(data?.conflict?409:200,data);
    } catch {return reply(503,{error:'Command service unavailable'});}
  };
}
