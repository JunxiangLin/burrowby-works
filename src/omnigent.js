'use strict';
// Minimal Databricks "Omnigent" adapter.
//
// ASSUMPTION (unverified, see docs/omnigent.md): Omnigent is reachable as a Databricks
// model-serving endpoint, i.e. POST {host}/serving-endpoints/{name}/invocations with a
// bearer token. If Omnigent turns out to be an SDK or CLI, only call() below needs to change.
//
// Config comes from environment variables, never from files in the repo:
//   DATABRICKS_HOST            e.g. https://adb-123.4.azuredatabricks.net
//   DATABRICKS_TOKEN           personal access token or OAuth token
//   OMNIGENT_ENDPOINT          serving endpoint name (default "omnigent")
//
// Usage:
//   const { createOmnigent } = require('./omnigent');
//   const og = createOmnigent();
//   const out = await og.invoke({ messages: [{ role: 'user', content: 'hello' }] });

function createOmnigent(opts = {}) {
  const env = opts.env || process.env;
  const fetchFn = opts.fetch || globalThis.fetch; // Node 18+ has fetch
  const host = String(opts.host || env.DATABRICKS_HOST || '').replace(/\/+$/, '');
  const token = opts.token || env.DATABRICKS_TOKEN || '';
  const endpoint = opts.endpoint || env.OMNIGENT_ENDPOINT || 'omnigent';

  // Report what is missing without ever exposing the token value.
  function status() {
    const missing = [];
    if (!host) missing.push('DATABRICKS_HOST');
    if (!token) missing.push('DATABRICKS_TOKEN');
    return { configured: missing.length === 0, missing, endpoint };
  }

  async function invoke(payload, { timeoutMs = 60000 } = {}) {
    const s = status();
    if (!s.configured) throw new Error('Omnigent not configured, missing: ' + s.missing.join(', '));
    if (!/^https:\/\//i.test(host)) throw new Error('DATABRICKS_HOST must start with https://');
    const url = `${host}/serving-endpoints/${encodeURIComponent(endpoint)}/invocations`;
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Omnigent HTTP ${res.status}: ${text.slice(0, 300)}`);
    try { return JSON.parse(text); } catch { return { raw: text }; }
  }

  return { status, invoke };
}

module.exports = { createOmnigent };
