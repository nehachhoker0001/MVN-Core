const india = require('./india');
const brazil = require('./brazil');
const china = require('./china');
const russia = require('./russia');
const southafrica = require('./southafrica');

async function verify(country, id){
  switch((country||'').toUpperCase()){
    case 'IN': return india.verify(id);
    case 'BR': return brazil.verify(id);
    case 'CN': return china.verify(id);
    case 'RU': return russia.verify(id);
    case 'ZA': return southafrica.verify(id);
    default: return null;
  }
}

module.exports = { verify };
