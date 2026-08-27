// Mock connector for South Africa national ID verification
async function verify(id){
  if (typeof id === 'string' && id.length >= 6){
    return { id, name: 'Citizen (ZA)', country: 'ZA', role: 'citizen', verified: true };
  }
  if (typeof id === 'string' && id.startsWith('LIC_')){
    return { id, name: 'Facility (ZA)', country: 'ZA', role: 'facility', verified: true };
  }
  return null;
}

module.exports = { verify };
