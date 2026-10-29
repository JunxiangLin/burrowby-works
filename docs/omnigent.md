# Databricks Omnigent integration (BW-13)

## What Omnigent is: NOT VERIFIED
The context library has no notes on Omnigent, and the worker that wrote this had no web access.
Nothing here is confirmed from Databricks documentation. Please confirm before building on it.

## Approach
Databricks products are normally reached over REST, so the smallest integration is a thin adapter
(`src/omnigent.js`) that calls a Databricks serving endpoint:

    POST {DATABRICKS_HOST}/serving-endpoints/{OMNIGENT_ENDPOINT}/invocations
    Authorization: Bearer {DATABRICKS_TOKEN}

It is not yet wired into the engine, foreman or UI. It has no dependencies (uses Node's built-in `fetch`).
If Omnigent is an SDK or CLI instead, only `invoke()` needs replacing; the config and status shape stay.

## Setup
Set these environment variables before `npm start` (nothing is stored in the repo or app data):

- `DATABRICKS_HOST`: workspace URL, `https://...`
- `DATABRICKS_TOKEN`: personal access token or OAuth token
- `OMNIGENT_ENDPOINT`: endpoint name (default `omnigent`)

Test: `node scripts/test-omnigent.js` (offline, fake fetch).

## Open questions
1. What does Omnigent actually do, and is it accessed by REST, SDK or CLI? Link to the docs please.
2. If REST: is it a serving endpoint, or a different API path? What is the request/response schema?
3. Which auth is wanted: PAT, OAuth M2M, or the Databricks CLI profile?
4. Where should it plug in: a new worker capability, a foreman tool, or a context source?
5. Worker agents run with token-like env vars scrubbed, so calls must come from the app process, not a worker.
6. Is there a sandbox workspace for testing, and any cost or rate limits?
