const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execP = util.promisify(exec);
const { Storage } = require('@google-cloud/storage');
const { SpeechClient } = require('@google-cloud/speech');

const JOBS_PATH = path.join(__dirname, 'transcribe_jobs.json');

function loadJobs(){
  try{ return JSON.parse(fs.readFileSync(JOBS_PATH,'utf8')).jobs || []; }
  catch(e){ return []; }
}

function saveJobs(jobs){
  fs.writeFileSync(JOBS_PATH, JSON.stringify({ jobs }, null, 2), 'utf8');
}

function enqueue(job){
  const jobs = loadJobs();
  jobs.push(job);
  saveJobs(jobs);
}

function getJob(id){
  const jobs = loadJobs();
  return jobs.find(j=>j.id===id);
}

async function processJob(job, emitProgress){
  job.status = 'processing';
  saveJobs(loadJobs().map(j=> j.id===job.id ? job : j ));
  try{
    // convert to wav using ffmpeg if needed
    const orig = job.origPath;
    const wav = job.wavPath;
    try{ await execP('ffmpeg -version'); }catch(e){ job.status='failed'; job.error='ffmpeg_missing'; saveJobs(loadJobs().map(j=> j.id===job.id ? job : j )); return; }
    const ffmpegCmd = `ffmpeg -y -i ${JSON.stringify(orig)} -ac 1 -ar 16000 -sample_fmt s16 ${JSON.stringify(wav)}`;
    await execP(ffmpegCmd, { timeout: 30000 });

    const baseCmd = process.env.TRANSCRIBE_CMD;
    const langArgFmt = process.env.TRANSCRIBE_CMD_LANG_FORMAT || '';
    const fallbackEnv = process.env.TRANSCRIBE_FALLBACK_LANGS || 'en,hi,pt,ru,zh';
    const fallbacks = fallbackEnv.split(',').map(x=>x.trim()).filter(Boolean);
    const attempts = [];

    async function runCmdWithLang(lang){
      const langPart = (lang && langArgFmt) ? (' ' + langArgFmt.replace('{lang}', lang)) : '';
      const full = `${baseCmd}${langPart} ${JSON.stringify(wav)}`;
      try{
        const { stdout, stderr } = await execP(full, { timeout: 60000, maxBuffer: 10*1024*1024 });
        const t = String(stdout || '').trim();
        attempts.push({ lang: lang || null, ok: true, transcript: t, stderr: stderr && String(stderr).slice(0,2000) });
        return t;
      }catch(err){
        attempts.push({ lang: lang || null, ok: false, error: String(err).slice(0,2000) });
        return null;
      }
    }

    // If a GCS bucket is configured, prefer uploading the WAV there and using Google Speech longRunningRecognize directly for large files
    const gcsBucket = process.env.GCLOUD_GCS_BUCKET || null;
    if (gcsBucket){
      try{
        const storage = new Storage();
        const bucket = storage.bucket(gcsBucket);
        const destName = path.basename(wav);
        const file = bucket.file(destName);
        // upload WAV
        await bucket.upload(wav, { destination: destName });
        const gcsUri = `gs://${gcsBucket}/${destName}`;
        emitProgress && emitProgress(job.id, { status: 'processing', step: 'uploaded_gcs', uri: gcsUri });

        const speechClient = new SpeechClient();
        const request = {
          config: { encoding: 'LINEAR16', sampleRateHertz: 16000, languageCode: job.preferredLang || 'en-US', enableAutomaticPunctuation: true },
          audio: { uri: gcsUri }
        };
        // use longRunningRecognize for GCS URIs
        const [operation] = await speechClient.longRunningRecognize(request);
        const [response] = await operation.promise();
        const transcription = (response.results || []).map(r => (r.alternatives && r.alternatives[0] && r.alternatives[0].transcript) || '').join('\n');
        if (transcription && transcription.length>0){
          job.status = 'done'; job.transcript = transcription; job.attempts = attempts; saveJobs(loadJobs().map(j=> j.id===job.id ? job : j));
          emitProgress && emitProgress(job.id, { status: 'done', transcript: transcription });
          return;
        }
      }catch(e){
        // fallback to CLI flow below
        emitProgress && emitProgress(job.id, { status: 'processing', step: 'gcs_transcribe_failed', error: String(e).slice(0,1000) });
      }
    }

    if (job.preferredLang){
      const t = await runCmdWithLang(job.preferredLang);
      emitProgress && emitProgress(job.id, { status: 'processing', step: 'tried_preferred', lang: job.preferredLang });
      if (t && t.length>5){ job.status='done'; job.transcript = t; job.attempts=attempts; saveJobs(loadJobs().map(j=> j.id===job.id ? job : j )); return; }
    }

    const tAuto = await runCmdWithLang(null);
    emitProgress && emitProgress(job.id, { status: 'processing', step: 'tried_auto' });
    if (tAuto && tAuto.length>5){ job.status='done'; job.transcript=tAuto; job.attempts=attempts; saveJobs(loadJobs().map(j=> j.id===job.id ? job : j )); return; }

    for (const L of fallbacks){
      const t = await runCmdWithLang(L);
      emitProgress && emitProgress(job.id, { status: 'processing', step: 'tried_fallback', lang: L });
      if (t && t.length>5){ job.status='done'; job.transcript=t; job.attempts=attempts; saveJobs(loadJobs().map(j=> j.id===job.id ? job : j )); return; }
    }

    job.status='failed'; job.error='no_transcript'; job.attempts=attempts; saveJobs(loadJobs().map(j=> j.id===job.id ? job : j ));
  }catch(e){
    job.status='failed'; job.error=String(e).slice(0,2000); saveJobs(loadJobs().map(j=> j.id===job.id ? job : j ));
  }
}

let workerInterval = null;
function startWorker(io){
  if (workerInterval) return;
  workerInterval = setInterval(async ()=>{
    const jobs = loadJobs();
    for (const job of jobs){
      if (job.status === 'queued'){
        // process one at a time
        job.status='processing';
        saveJobs(jobs.map(j=> j.id===job.id ? job : j));
        await processJob(job, (id, progress)=>{ if (io) io.emit('transcribe_update', { id, progress }); });
        if (io) io.emit('transcribe_update', { id: job.id, status: job.status });
      }
    }
  }, 2000);
}

function stopWorker(){ if (workerInterval) clearInterval(workerInterval); workerInterval=null; }

module.exports = { enqueue, loadJobs, saveJobs, getJob, startWorker, stopWorker };
