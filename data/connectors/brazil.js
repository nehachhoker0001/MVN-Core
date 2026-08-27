// Mock connector for Brazil national ID verification (CPF-like)
async function verify(id){
  // accept 11-digit numbers as valid
  if (typeof id === 'string' && /^\d{11}$/.test(id)){
    return { id, name: 'Citizen (BR)', country: 'BR', role: 'citizen', verified: true };
  }
  if (typeof id === 'string' && id.startsWith('LIC_')){
    return { id, name: 'Facility (BR)', country: 'BR', role: 'facility', verified: true };
  }
  return null;
}

module.exports = { verify };
