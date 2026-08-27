const fetch = require('node-fetch');
const crypto = require('crypto');

// Simple HTTP client with retries, optional HMAC signing and OAuth token support.
async function fetchWithRetries(url, options = {}, retries = 3, backoffMs = 500){
  let attempt = 0;
  while (attempt <= retries){
    try{
      const res = await fetch(url, options);
      return res;
    }catch(err){
      attempt += 1;
      if (attempt > retries) throw err;
      await new Promise(r => setTimeout(r, backoffMs * Math.pow(2, attempt-1)));
    }
  }
}

function signHmac(body, secret){
  if (!secret) return null;
  const h = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${h}`;
}

// Example: fetch JSON POST with optional HMAC header and Bearer token
async function postJson(url, payload, { hmacSecret=null, bearerToken=null, timeout=8000 } = {}){
  const body = JSON.stringify(payload);
  const headers = { 'content-type': 'application/json' };
  if (hmacSecret){
    headers['x-signature'] = signHmac(body, hmacSecret);
  }
  if (bearerToken){
    headers['authorization'] = `Bearer ${bearerToken}`;
  }
  const res = await fetchWithRetries(url, { method: 'POST', headers, body, timeout });
  return res;
}

module.exports = { fetchWithRetries, signHmac, postJson };
