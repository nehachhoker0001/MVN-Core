# BRICS Health Digital Twin — Starter Scaffold

This repository contains a minimal starter scaffold for a BRICS-capable "digital twin" for healthcare.

Run:

```bash
npm install
npm start
```

This creates a simple Express + Socket.IO backend and a responsive single-page frontend in `public/` with basic i18n stubs and endpoints for listing health centres, requesting ambulances, and sending updates.

Notes:
- This is a starter prototype intended to be extended. Replace in-memory data with a database and implement secure national-ID and license validation for production.
- i18n: translations live in `public/locales/` and supported languages are listed in `public/config/languages.json`.
 - Orders: the server will attempt to POST order payloads to supplier webhooks configured in `data/suppliers.json`. These are placeholder URLs — replace with real manufacturer/distributor endpoints. The server records supplier responses in `data/db.json` under `orders[].supplierResults`.
 - National ID verification: mock per-country connectors live under `data/connectors/`. For production integrate with the official national identity verification APIs (examples and guidance below).

National ID verification integration guidance
- India: use UIDAI Aadhaar authentication APIs or approved authentication service providers. Implement server-side secure channels; do not send raw Aadhaar numbers to clients. Use OTP or e-KYC flows where allowed and comply with local privacy law.
- Brazil: integrate with CPF validation services or government registries where available; use secure service accounts and signed requests.
- China: integrate with local identity verification providers and follow national regulations on identity data.
- Russia & South Africa: use their respective government or approved commercial identity verification APIs.

For all countries follow these rules:
- Keep verification server-side and never expose raw national ID APIs to end-users.
- Use HTTPS, mutual TLS or OAuth where supported.
- Store only hashed or tokenized identifiers when possible; prefer short-lived verification tokens.
- Log verification attempts for audit, but redact personal identifiers in logs.
- Use a secrets manager for API keys (`JWT_SECRET`, supplier secrets, connector credentials).

Connector template
- A connector template is included at `data/connectors/template.js` and an HTTP helper at `data/connectors/httpClient.js` showing:
	- `postJson(url, payload, {hmacSecret, bearerToken})` — posts JSON with optional HMAC signature and bearer token.
	- `fetchWithRetries` — simple retry/backoff wrapper.
	- `signHmac(body, secret)` — HMAC-SHA256 signing to send in `x-signature` header.

Usage
- Copy `data/connectors/template.js` to a new file `data/connectors/<country>.js` and implement `obtainToken()` and `verify()` for the country's official API, using the HTTP helper. Keep secrets in environment variables or a secrets manager and never commit them to the repo.

End-to-end demo with mock verifier
1. Start the mock verifier (opens port 4000):
```bash
npm run start:mock-verifier
```
2. Start the main server in another terminal:
```bash
npm start
```
3. Use the admin UI to login and exercise the flow. The connector template defaults to `http://localhost:4000` for token and verify endpoints so the demo performs a full end-to-end verification and returns a JWT.

Notes: The mock verifier is for development only — it accepts simple client credentials and returns demo profiles. Replace with real connectors for production.


