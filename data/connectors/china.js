// Mock connector for China national ID verification
async function verify(id){
  if (typeof id === 'string' && id.length >= 6){
    return { id, name: 'Citizen (CN)', country: 'CN', role: 'citizen', verified: true };
  }
  if (typeof id === 'string' && id.startsWith('LIC_')){
    return { id, name: 'Facility (CN)', country: 'CN', role: 'facility', verified: true };
  }
  return null;
}

module.exports = { verify };
