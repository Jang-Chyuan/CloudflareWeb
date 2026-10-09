import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { corsHeaders } from '@supabase/supabase-js/cors';

function loadHandler() {
  const source = readFileSync('supabase/functions/unlock-fixed-location/index.ts', 'utf8').replace(/^import .*;\r?$/gm, '');
  const code = transformSync(source, { loader: 'ts', format: 'cjs' }).code;
  let handler;
  runInNewContext(code, {
    Deno: { serve(value) { handler = value; }, env: { get() { return undefined; } } },
    Response, corsHeaders,
    createClient() { throw new Error('Preflight and unauthenticated requests must not create clients'); },
  });
  return handler;
}

test('browser preflight accepts Authorization and publishable-key headers without bypassing POST authentication', async () => {
  const handler = loadHandler();
  const preflight = await handler(new Request('https://example.test/unlock', { method: 'OPTIONS', headers: {
    Origin: 'https://cloudflareweb.jjchyuan.workers.dev',
    'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,apikey,content-type',
  } }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  assert.match(preflight.headers.get('access-control-allow-headers'), /authorization/);
  assert.match(preflight.headers.get('access-control-allow-headers'), /apikey/);
  const denied = await handler(new Request('https://example.test/unlock', { method: 'POST' }));
  assert.equal(denied.status, 401); assert.equal((await denied.json()).error, 'Login required');
  assert.equal(denied.headers.get('access-control-allow-origin'), '*');
  const wrongMethod = await handler(new Request('https://example.test/unlock'));
  assert.equal(wrongMethod.status, 405);
});
