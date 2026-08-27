const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');

const app = express();
app.use(bodyParser.json());

// Simple in-memory client creds for OAuth simulation
const clients = {
  'client-id-demo': 'client-secret-demo'
};

// OAuth token endpoint (client_credentials)
app.post('/oauth/token', (req, res) => {
  const auth = req.headers['authorization'] || '';
  // Accept basic auth or JSON body
  let clientId, clientSecret;
  if (auth.startsWith('Basic ')){
    const raw = Buffer.from(auth.slice(6), 'base64').toString();
    const parts = raw.split(':'); clientId = parts[0]; clientSecret = parts[1];
  } else {
    clientId = req.body.client_id; clientSecret = req.body.client_secret;
  }
  if (!clientId || clients[clientId] !== clientSecret) return res.status(401).json({ error: 'invalid_client' });
  const token = crypto.randomBytes(20).toString('hex');
  res.json({ access_token: token, token_type: 'bearer', expires_in: 3600 });
});

// Verification endpoint accepts POST /verify/:country
app.post('/verify/:country', (req, res) => {
  const country = (req.params.country || 'IN').toUpperCase();
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });

  // Optionally validate HMAC if x-signature present and secret known
  const sig = req.headers['x-signature'];
  if (sig){
    // For demo, accept any signature
  }

  // Simple mapping for demo: return a profile object
  const profile = { id, name: `Demo ${country} User`, country, verified: true };
  // If id starts with HOSP or LIC, mark facility
  if (typeof id === 'string' && (id.startsWith('HOSP') || id.startsWith('LIC_'))) profile.role = 'facility';
  else profile.role = 'citizen';

  res.json(profile);
});

const PORT = process.env.MOCK_VERIFIER_PORT || 4000;
app.listen(PORT, () => console.log(`Mock verifier listening on ${PORT}`));
