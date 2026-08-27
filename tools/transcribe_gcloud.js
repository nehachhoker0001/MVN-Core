#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { SpeechClient } = require('@google-cloud/speech');

async function main(){
  const key = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!key) {
    console.error('ERROR: Set GOOGLE_APPLICATION_CREDENTIALS env to service account JSON file');
    process.exit(2);
  }

  const file = process.argv[2];
  const lang = process.argv[3] || 'en-US';
  if (!file) {
    console.error('Usage: node tools/transcribe_gcloud.js <filepath> [languageCode]');
    process.exit(2);
  }
  if (!fs.existsSync(file)) {
    console.error('File not found:', file);
    process.exit(2);
  }

  const client = new SpeechClient();

  // Read file and detect if it's WAV/LINEAR16 or other.
  const buf = fs.readFileSync(file);
  const audioBytes = buf.toString('base64');
  const config = {
    encoding: 'LINEAR16',
    sampleRateHertz: 16000,
    languageCode: lang,
    enableAutomaticPunctuation: true
  };

  const audio = {
    content: audioBytes
  };

  const request = { audio, config };

  try{
    const SIZE_THRESHOLD = 5 * 1024 * 1024; // 5 MB
    if (buf.length > SIZE_THRESHOLD){
      // Use longRunningRecognize for large files
      console.error('Large file detected, using longRunningRecognize');
      const [operation] = await client.longRunningRecognize(request);
      const [response] = await operation.promise();
      const transcription = (response.results || []).map(r => (r.alternatives && r.alternatives[0] && r.alternatives[0].transcript) || '').join('\n');
      console.log(transcription.trim());
      return;
    }

    const [response] = await client.recognize(request);
    const transcription = (response.results || []).map(r => (r.alternatives && r.alternatives[0] && r.alternatives[0].transcript) || '').join('\n');
    console.log(transcription.trim());
  }catch(err){
    console.error('Transcription failed:', err);
    process.exit(3);
  }
}

main();
