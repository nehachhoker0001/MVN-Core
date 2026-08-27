const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function sign(profile, opts){
  const payload = { id: profile.id, country: profile.country, role: profile.role, name: profile.name };
  return jwt.sign(payload, SECRET, { expiresIn: opts && opts.expiresIn || '8h' });
}

function verify(token){
  try{
    return jwt.verify(token, SECRET);
  }catch(e){ return null; }
}

module.exports = { sign, verify };
