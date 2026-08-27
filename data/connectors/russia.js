// Mock connector for Russia national ID verification
async function verify(id){
  if (typeof id === 'string' && id.length >= 6){
    return { id, name: 'Citizen (RU)', country: 'RU', role: 'citizen', verified: true };
  }
  if (typeof id === 'string' && id.startsWith('LIC_')){
    return { id, name: 'Facility (RU)', country: 'RU', role: 'facility', verified: true };
  }
  return null;
}

module.exports = { verify };
