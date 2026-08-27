const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const crypto = require('crypto');
const store = require('./datastore');

const JOBS_PATH = path.join(__dirname, 'jobs.json');
const SUPPLIERS_PATH = path.join(__dirname, 'suppliers.json');
const suppliersCfg = require(SUPPLIERS_PATH);

function loadJobs(){
  try{ return JSON.parse(fs.readFileSync(JOBS_PATH,'utf8')).jobs || []; }
  catch(e){ return []; }
}

function saveJobs(jobs){
  fs.writeFileSync(JOBS_PATH, JSON.stringify({ jobs }, null, 2), 'utf8');
}

function enqueueJobsForOrder(order){
  const center = store.getCenter(order.centerId);
  const country = center && center.country ? center.country : 'IN';
  const suppliers = suppliersCfg[country] || suppliersCfg['IN'] || [];
  const jobs = loadJobs();
  suppliers.forEach((s, idx) => {
    const job = {
      id: `job-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      orderId: order.id,
      supplierIndex: idx,
      supplier: s.name,
      url: s.url,
      secret: s.secret || null,
      attempts: 0,
      maxAttempts: s.maxAttempts || 5,
      nextAttempt: Date.now(),
      status: 'queued',
      createdAt: Date.now(),
      payload: order
    };
    jobs.push(job);
  });
  saveJobs(jobs);
}

async function processJob(job){
  const body = JSON.stringify(job.payload);
  const headers = { 'content-type': 'application/json' };
  if (job.secret){
    const h = crypto.createHmac('sha256', job.secret).update(body).digest('hex');
    headers['x-signature'] = `sha256=${h}`;
  }
  try{
    const resp = await fetch(job.url, { method: 'POST', headers, body, timeout: 8000 });
    const text = await resp.text().catch(()=>null);
    job.attempts += 1;
    if (resp.ok){
      job.status = 'done';
      job.lastResponse = text;
      // update order record
      const prev = (store.getCenter && store.getCenter(job.payload.centerId)) || null;
      const order = store.updateOrder(job.payload.id, { status: 'sent' }) || job.payload;
      // append supplierResult
      const prevResults = order.supplierResults || [];
      prevResults.push({ supplier: job.supplier, ok: true, status: resp.status, response: text });
      store.updateOrder(order.id, { supplierResults: prevResults });
      return { ok: true };
    } else {
      job.lastError = `http:${resp.status}`;
    }
  }catch(err){
    job.attempts += 1;
    job.lastError = String(err);
  }
  // schedule retry
  if (job.attempts >= job.maxAttempts){
    job.status = 'failed';
    const order = store.updateOrder(job.payload.id, { status: 'no_accept' }) || job.payload;
    const prevResults = order.supplierResults || [];
    prevResults.push({ supplier: job.supplier, ok: false, error: job.lastError });
    store.updateOrder(order.id, { supplierResults: prevResults });
  } else {
    job.status = 'retry';
    const base = 5000; // 5s
    const delay = base * Math.pow(2, job.attempts - 1);
    job.nextAttempt = Date.now() + delay;
  }
  return { ok: false };
}

let workerInterval = null;

function startWorker(pollMs = 3000){
  if (workerInterval) return;
  workerInterval = setInterval(async ()=>{
    const jobs = loadJobs();
    const now = Date.now();
    let changed = false;
    for (let job of jobs){
      if (job.status === 'done' || job.status === 'failed') continue;
      if (job.nextAttempt && job.nextAttempt > now) continue;
      // process job
      job.status = 'processing';
      changed = true;
      await processJob(job);
      changed = true;
      // small pause to avoid burst
      await new Promise(r=>setTimeout(r, 200));
    }
    if (changed) saveJobs(jobs);
  }, pollMs);
}

function stopWorker(){ if (workerInterval) clearInterval(workerInterval); workerInterval = null; }

module.exports = { enqueueJobsForOrder, startWorker, stopWorker, loadJobs };
