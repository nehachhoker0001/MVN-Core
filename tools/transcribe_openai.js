#!/usr/bin/env node
const fs = require('fs');
const fetch = require('node-fetch');
const FormData = require('form-data');

async function main(){
  const key = process.env.OPENAI_API_KEY;
  if (!key){
    console.error('ERROR: OPENAI_API_KEY env var is required');
    process.exit(2);
  }
  const file = process.argv[2];
  const lang = process.argv[3];
  if (!file){
    console.error('Usage: node tools/transcribe_openai.js <filepath> [language]');
    process.exit(2);
  }
  if (!fs.existsSync(file)){
    console.error('File not found:', file);
    process.exit(2);
  }

  const form = new FormData();
  form.append('file', fs.createReadStream(file));
  form.append('model', 'whisper-1');
  if (lang) form.append('language', lang);

  try{
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key },
      body: form
    });
    const j = await res.json();
    if (!res.ok){
      console.error('OpenAI error:', j);
      process.exit(3);
    }
    // Whisper returns `text` in a successful response
    console.log(j.text || j.transcript || '');
  }catch(err){
    console.error('Request failed:', err);
    process.exit(1);
  }
}

main();
