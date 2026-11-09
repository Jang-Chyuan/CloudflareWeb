import assert from 'node:assert/strict';
const secrets = {
  MASTER_5_DEVICE_TOKEN: 'master5-test-token-00000000000000000000',
  MASTER_201_DEVICE_TOKEN: 'master201-test-token-000000000000000000',
  INGEST_DB_SECRET_KEY: 'test-secret', SUPABASE_URL: 'https://test.supabase.co',
};
globalThis.Deno = {env: {get: name => secrets[name]}};
const {deviceCommandHandler} = await import('./functions/_shared/device-command.ts');
const calls = [];
let databaseStatus = 200, databaseReply = {command:null};
globalThis.fetch = async (url, options) => {
  calls.push({url, args:JSON.parse(options.body)});
  return Response.json(databaseReply, {status:databaseStatus});
};
const poll = deviceCommandHandler(false), report = deviceCommandHandler(true);
const send = (handler, body, token) => handler(new Request('https://test.local', {
  method:'POST', headers:{'X-Device-Token':token}, body:JSON.stringify(body),
}));
const reportBody = {id:'00000000-0000-4000-8000-000000000001',
  claim_token:'00000000-0000-4000-8000-000000000002', radio_command_id:7,
  outcome:'confirmed', reported_mode:1};
for (const master of [5,201]) {
  const token = secrets[`MASTER_${master}_DEVICE_TOKEN`];
  assert.equal((await send(poll, {master_id:master === 5 ? 201 : 5}, token)).status,200);
  assert.deepEqual(calls.at(-1).args,{p_master_id:master});
  assert.equal((await send(report, {...reportBody, master_id:99}, token)).status,200);
  assert.equal(calls.at(-1).args.p_master_id,master);
  assert.match(calls.at(-1).url,/report_master_command$/);
}
const before = calls.length;
assert.equal((await send(poll, {}, 'wrong')).status,401);
assert.equal(calls.length,before);
secrets.MASTER_201_DEVICE_TOKEN = secrets.MASTER_5_DEVICE_TOKEN;
assert.equal((await send(poll, {}, secrets.MASTER_5_DEVICE_TOKEN)).status,401);
assert.equal(calls.length,before);
delete secrets.MASTER_201_DEVICE_TOKEN;
assert.equal((await send(poll, {}, secrets.MASTER_5_DEVICE_TOKEN)).status,200);
assert.equal(calls.at(-1).args.p_master_id,5);
const previous = calls.length;
for (const body of [{...reportBody,reported_mode:null},{...reportBody,radio_command_id:2147483648},
  {...reportBody,id:'invalid'},{...reportBody,outcome:'queued'}]) {
  assert.equal((await send(report,body,secrets.MASTER_5_DEVICE_TOKEN)).status,400);
}
assert.equal(calls.length,previous);
databaseReply={conflict:true};
assert.equal((await send(report,reportBody,secrets.MASTER_5_DEVICE_TOKEN)).status,409);
databaseStatus=500;
assert.equal((await send(poll,{},secrets.MASTER_5_DEVICE_TOKEN)).status,503);
console.log('PASS: Master5/201 token isolation, polling/reporting, invalid reports and database failures');
