'use strict';
// Offline test for src/omnigent.js using a fake fetch. Run: node scripts/test-omnigent.js
const assert = require('assert');
const { createOmnigent } = require('../src/omnigent');

(async () => {
  // Unconfigured: reports missing vars, refuses to call.
  const bare = createOmnigent({ env: {} });
  assert.deepStrictEqual(bare.status().missing, ['DATABRICKS_HOST', 'DATABRICKS_TOKEN']);
  await assert.rejects(() => bare.invoke({}), /not configured/);

  // Configured: correct URL, auth header and body.
  let seen;
  const fetch = async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200, text: async () => '{"predictions":[1]}' };
  };
  const og = createOmnigent({ env: {}, host: 'https://h.example.com/', token: 't0k', endpoint: 'og', fetch });
  const out = await og.invoke({ inputs: 'x' });
  assert.strictEqual(seen.url, 'https://h.example.com/serving-endpoints/og/invocations');
  assert.strictEqual(seen.init.headers.Authorization, 'Bearer t0k');
  assert.deepStrictEqual(out, { predictions: [1] });

  // HTTP errors surface without leaking the token.
  const bad = createOmnigent({ env: {}, host: 'https://h.example.com', token: 't0k',
    fetch: async () => ({ ok: false, status: 403, text: async () => 'denied' }) });
  await assert.rejects(() => bad.invoke({}), (e) => /403/.test(e.message) && !/t0k/.test(e.message));

  console.log('omnigent: ok');
})().catch((e) => { console.error(e); process.exit(1); });
