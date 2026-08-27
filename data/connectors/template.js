// Connector template: copy this file to implement a secure connector for a country.
// Features shown: secure token retrieval (OAuth2 client credentials), HMAC signing, retries.

const { postJson } = require('./httpClient');

// Example config you should supply from environment or secrets manager.
const CONFIG = {
  // Default to local mock verifier for end-to-end testing
  endpoint: process.env.CONNECTOR_ENDPOINT || 'http://localhost:4000/verify/IN',
  oauth: {
    tokenUrl: process.env.CONNECTOR_OAUTH_TOKEN_URL || 'http://localhost:4000/oauth/token',
    clientId: process.env.CONNECTOR_OAUTH_CLIENT_ID || 'client-id-demo',
    clientSecret: process.env.CONNECTOR_OAUTH_CLIENT_SECRET || 'client-secret-demo'
  },
  hmacSecret: process.env.CONNECTOR_HMAC_SECRET || null
};

async function obtainToken(){
  // Implement OAuth2 client_credentials here. This is a template stub.
  if (!CONFIG.oauth.clientId || !CONFIG.oauth.clientSecret) return null;
  // Use node-fetch to POST token request and return access_token.
  return null; // replace with real token fetch
}

async function verify(id){
  // Build payload according to national API
  const payload = { id };
  // Optionally obtain bearer token
  const token = await obtainToken();
  const opts = { hmacSecret: CONFIG.hmacSecret, bearerToken: token };
  const res = await postJson(CONFIG.endpoint, payload, opts);
  if (!res) return null;
  if (!res.ok) {
    // handle error codes and map to null
    return null;
  }
  const data = await res.json().catch(()=>null);
  // Map data to connector return shape: { id, name, country, role, verified }
  return { id, name: data.name || 'Unknown', country: data.country || 'XX', role: data.role || 'citizen', verified: true };
}

module.exports = { verify };
