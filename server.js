const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server);

const store = require('./data/datastore');
const suppliersCfg = require('./data/suppliers.json');
const fetch = require('node-fetch');

// Data comes from persistent store
function readCenters(){
  return store.getCenters();
}

// Utility: broadcast current snapshot
function broadcastSnapshot() {
  io.emit('snapshot', { ts: Date.now(), centers: readCenters() });
}

// Simulate small random changes and broadcast every 30s
setInterval(() => {
  const centers = readCenters().map(h => {
    const delta = Math.round((Math.random() - 0.5) * 10);
    const patients = Math.max(0, h.patientsPerDay + delta);
    const medicineUse = Math.round(patients * 0.6);
    const medicine = Math.max(0, h.medicine - medicineUse);
    // persist small simulation changes
    store.updateCenter(h.id, { patientsPerDay: patients, medicine });
    return { ...h, patientsPerDay: patients, medicine };
  });
  broadcastSnapshot();
}, 30_000);

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// API: list health centers
app.get('/api/healthcenters', (req, res) => {
  res.json({ centers: readCenters() });
});

// API: update center (stub)
app.post('/api/center/:id/update', requireAuth, requireRole(['facility','admin']), (req, res) => {
  const id = req.params.id;
  const data = req.body;
  const updated = store.updateCenter(id, data);
  if (!updated) return res.status(404).json({ error: 'not found' });
  broadcastSnapshot();
  res.json({ ok: true, center: updated });
});

// Manual order to manufacturer (admin triggered)
app.post('/api/center/:id/order', requireAuth, requireRole(['facility','admin']), (req, res) => {
  const id = req.params.id;
  const { quantity, reason, to } = req.body || {};
  const center = store.getCenter(id);
  if (!center) return res.status(404).json({ error: 'center not found' });
  if (!quantity || quantity <= 0) return res.status(400).json({ error: 'quantity required' });
  const order = store.addOrder({ centerId: id, quantity, reason: reason || 'manual', to: to || 'manufacturer' });
  // notify via socket
  io.emit('supply_order', order);
  res.json({ ok: true, order });

  // Enqueue jobs for order dispatch using job queue worker
  const jobqueue = require('./data/jobqueue');
  jobqueue.enqueueJobsForOrder(order);
  jobqueue.startWorker();
});

async function dispatchOrderToSuppliers(order){
  const center = store.getCenter(order.centerId);
  const country = center && center.country ? center.country : 'GLOBAL';
  const suppliers = suppliersCfg[country] || suppliersCfg['IN'] || [];
  if (!suppliers.length){
    store.updateOrder(order.id, { status: 'no_suppliers' });
    return;
  }

  // try each supplier until one accepts (simple fallback)
  for (let i=0;i<suppliers.length;i++){
    const s = suppliers[i];
    try{
      const resp = await fetch(s.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(order), timeout: 5000 });
      const text = await resp.text().catch(()=>null);
      const ok = resp.ok;
      // record supplier result
      const prev = (order.supplierResults || []).slice();
      prev.push({ supplier: s.name, url: s.url, ok, status: resp.status, response: text });
      store.updateOrder(order.id, { supplierResults: prev, status: ok ? 'sent' : 'failed' });
      if (ok) {
        io.emit('supply_order_update', { orderId: order.id, supplier: s.name, status: 'sent' });
        return;
      }
    }catch(err){
      const prev = (order.supplierResults || []).slice();
      prev.push({ supplier: s.name, url: s.url, ok: false, error: String(err) });
      store.updateOrder(order.id, { supplierResults: prev, status: 'failed' });
      // continue to next supplier
    }
  }
  // none accepted
  store.updateOrder(order.id, { status: 'no_accept' });
  io.emit('supply_order_update', { orderId: order.id, status: 'no_accept' });
}

const auth = require('./data/auth');
const fs = require('fs');
const AUTH_LOG_PATH = path.join(__dirname, 'data', 'auth_logs.json');

function appendAuthLog(entry){
  try{
    const raw = fs.readFileSync(AUTH_LOG_PATH, 'utf8');
    const db = JSON.parse(raw);
    db.logs = db.logs || [];
    db.logs.push(entry);
    fs.writeFileSync(AUTH_LOG_PATH, JSON.stringify(db, null, 2), 'utf8');
  }catch(e){
    console.warn('appendAuthLog error', e);
  }
}

// Auth endpoint: returns JWT token and profile. Country-specific validation is simulated.
app.post('/api/auth', async (req, res) => {
  const { country, id } = req.body || {};
  if (!country || !id) return res.status(400).json({ error: 'country and id required' });

  // Try country-specific verification connector first
  try{
    const connectors = require('./data/connectors');
    const verified = await connectors.verify(country, id);
    if (verified && verified.verified){
      const token = auth.sign(verified);
      appendAuthLog({ ts: Date.now(), country, id, success: true, method: 'connector', profile: verified });
      return res.json({ profile: verified, token });
    }
    appendAuthLog({ ts: Date.now(), country, id, success: false, method: 'connector', reason: 'not verified' });
  }catch(e){
    console.warn('connector error', e);
    appendAuthLog({ ts: Date.now(), country, id, success: false, method: 'connector', error: String(e) });
  }

  // Fallback simple validation rules (STUBS)
  let role = 'citizen';
  if (typeof id === 'string' && id.startsWith('ADMIN')) role = 'admin';
  else if (typeof id === 'string' && id.startsWith('HOSP')) role = 'facility';
  else if (country === 'IN' && /^[0-9]{12}$/.test(id)) role = 'citizen';
  else if (country === 'BR' && /^\d{11,14}$/.test(id)) role = 'citizen';
  else if (country === 'CN' && id.length >= 6) role = 'citizen';
  if (typeof id === 'string' && id.startsWith('LIC_')) role = 'facility';

  const profile = { id, country, role, name: (role === 'facility' ? 'Demo Facility' : (role === 'admin' ? 'Admin User' : 'Demo User')) };
  const token = auth.sign(profile);
  appendAuthLog({ ts: Date.now(), country, id, success: true, method: 'fallback', profile });
  res.json({ profile, token });
});

// middleware to verify JWT
function requireAuth(req, res, next){
  const h = req.headers['authorization'] || '';
  const parts = h.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return res.status(401).json({ error: 'missing token' });
  const payload = auth.verify(parts[1]);
  if (!payload) return res.status(401).json({ error: 'invalid token' });
  req.user = payload;
  next();
}

function requireRole(role){
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'not authenticated' });
    if (Array.isArray(role)){
      if (!role.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    } else {
      if (req.user.role !== role) return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };
}

// Admin: expose auth logs (admin only)
app.get('/api/auth-logs', requireAuth, requireRole(['admin']), (req, res) => {
  try{
    const raw = fs.readFileSync(AUTH_LOG_PATH, 'utf8');
    const db = JSON.parse(raw);
    res.json({ logs: db.logs || [] });
  }catch(e){
    res.status(500).json({ error: 'failed to read logs' });
  }
});

const ambulanceRequests = new Map();

function getNearbyCenters(lat, lng, max = 5) {
  const centers = readCenters();
  return centers
    .map(h => ({ h, d: (h.lat - lat) ** 2 + (h.lng - lng) ** 2 }))
    .filter(x => x.h.doctors > 0 && x.h.beds > 0)
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map(x => x.h);
}

function notifyFacilityForAmbulance(requestId, center, payload) {
  io.to(center.id).emit('ambulance_request', {
    requestId,
    centerId: center.id,
    centerName: center.name,
    ts: Date.now(),
    lat: payload.lat,
    lng: payload.lng,
    symptoms: payload.symptoms,
    status: 'pending'
  });
}

function acceptAmbulanceRequest(requestId, facilityId) {
  const req = ambulanceRequests.get(requestId);
  if (!req || req.status !== 'pending') return null;
  req.status = 'accepted';
  req.assignedFacilityId = facilityId;
  req.assignedAt = Date.now();
  ambulanceRequests.set(requestId, req);
  io.emit('ambulance_assigned', {
    requestId,
    facilityId,
    centerId: req.centerId,
    centerName: req.centerName,
    ts: req.assignedAt
  });
  return req;
}

// Ambulance request: notify nearest facility, keep fallback chain, and accept on facility response.
app.post('/api/request-ambulance', async (req, res) => {
  const { lat, lng, symptoms } = req.body || {};
  if (lat == null || lng == null) return res.status(400).json({ error: 'lat,lng required' });

  const candidates = getNearbyCenters(lat, lng, 5);
  if (!candidates.length) return res.status(503).json({ error: 'no available facility nearby' });

  const requestId = `amb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const request = { requestId, status: 'pending', lat, lng, symptoms, candidates: candidates.map(c => c.id), centerId: null, centerName: null };

  for (const center of candidates) {
    request.centerId = center.id;
    request.centerName = center.name;
    ambulanceRequests.set(requestId, { ...request });
    notifyFacilityForAmbulance(requestId, center, { lat, lng, symptoms });

    const accepted = await new Promise(resolve => {
      const timer = setTimeout(() => {
        const current = ambulanceRequests.get(requestId);
        if (current && current.status === 'pending') {
          io.to(center.id).emit('ambulance_request', { requestId, centerId: center.id, centerName: center.name, status: 'timed_out' });
        }
        resolve(null);
      }, 8000);

      const watcher = setInterval(() => {
        const current = ambulanceRequests.get(requestId);
        if (current && current.status === 'accepted') {
          clearInterval(watcher);
          clearTimeout(timer);
          resolve(current);
        }
      }, 200);
    });

    if (accepted) {
      return res.json({ requestId, assigned: accepted.assignedFacilityId || accepted.centerId, name: accepted.centerName });
    }
  }

  ambulanceRequests.delete(requestId);
  return res.status(503).json({ error: 'no facility accepted the ambulance request' });
});

app.post('/api/facility/:id/accept-ambulance', requireAuth, requireRole(['facility', 'admin']), (req, res) => {
  const facilityId = req.params.id;
  const { requestId } = req.body || {};
  if (!requestId) return res.status(400).json({ error: 'requestId required' });

  const accepted = acceptAmbulanceRequest(requestId, facilityId);
  if (!accepted) return res.status(409).json({ error: 'request already resolved or not found' });

  io.to(facilityId).emit('ambulance_request', {
    requestId,
    facilityId,
    centerId: accepted.centerId,
    centerName: accepted.centerName,
    status: 'accepted'
  });

  res.json({ ok: true, requestId, assigned: facilityId, name: accepted.centerName });
});

io.on('connection', socket => {
  socket.on('join_facility', id => {
    socket.join(id);
  });

  socket.on('accept_ambulance', payload => {
    if (!payload || !payload.requestId) return;
    const facilityId = payload.facilityId || socket.id;
    const accepted = acceptAmbulanceRequest(payload.requestId, facilityId);
    if (accepted) {
      socket.emit('ambulance_assigned', {
        requestId: payload.requestId,
        facilityId,
        centerId: accepted.centerId,
        centerName: accepted.centerName
      });
    }
  });

  socket.emit('snapshot', { ts: Date.now(), centers: readCenters() });
});

// Symptom search: return ranked list of nearby centers / recommended doctors
app.post('/api/symptom-search', (req, res) => {
  const { symptoms, lat, lng, max } = req.body || {};
  if (!symptoms) return res.status(400).json({ error: 'symptoms required' });
  const centers = readCenters();
  const text = String(symptoms).toLowerCase();

  const keywordMap = {
    fever: 'general',
    cough: 'general',
    cold: 'general',
    flu: 'general',
    headache: 'general',
    chest: 'cardiology',
    chestpain: 'cardiology',
    pain: 'general',
    trauma: 'emergency',
    bleed: 'emergency',
    pregnancy: 'obstetrics',
    delivery: 'obstetrics'
  };

  const matchedKeys = Object.keys(keywordMap).filter(k => text.includes(k));
  const desired = new Set(matchedKeys.map(k => keywordMap[k]));

  const results = centers.map(c => {
    const d = (lat != null && lng != null) ? ((c.lat - lat) ** 2 + (c.lng - lng) ** 2) : 0;
    // simple specialty match if center advertises specialties
    const specialties = c.specialties || [];
    const specMatch = specialties.some(s => desired.has(s)) ? 1 : 0;
    const score = (c.doctors || 0) * 2 + (c.beds || 0) * 0.2 + specMatch * 5 - d * 1000;
    return { center: c, score, distanceSq: d };
  }).sort((a,b) => b.score - a.score).slice(0, max || 5);

  res.json({ query: symptoms, results });
});

// Upload medical report (base64 JSON payload) and persist metadata
app.post('/api/upload-report', requireAuth, (req, res) => {
  const { filename, dataBase64, centerId, patientId } = req.body || {};
  if (!filename || !dataBase64) return res.status(400).json({ error: 'filename and dataBase64 required' });
  const UPLOADS_DIR = path.join(__dirname, 'uploads');
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const safe = Date.now() + '-' + filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const outPath = path.join(UPLOADS_DIR, safe);

  // validate size and type
  try{
    const buf = Buffer.from(dataBase64, 'base64');
    const sizeBytes = buf.length;
    const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
    if (sizeBytes > MAX_BYTES) return res.status(413).json({ error: 'file too large', maxBytes: MAX_BYTES });

    function detectType(b, name){
      if (b.slice(0,4).toString() === '%PDF') return 'pdf';
      if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'png';
      if (b[0] === 0xFF && b[1] === 0xD8) return 'jpg';
      const ext = (name||'').split('.').pop().toLowerCase();
      if (['pdf','png','jpg','jpeg'].includes(ext)) return ext === 'jpeg' ? 'jpg' : ext;
      return 'unknown';
    }

    function scanBuffer(b){
      const s = b.toString('utf8', 0, Math.min(b.length, 10000));
      if (s.includes('<script')) return { safe: false, reason: 'contains script tags' };
      if (b.slice(0,2).toString('hex') === '4d5a') return { safe: false, reason: 'executable (MZ) found' };
      // basic: no threats found
      return { safe: true };
    }

    const ftype = detectType(buf, filename);
    if (ftype === 'unknown') return res.status(415).json({ error: 'unsupported file type' });

    const scan = scanBuffer(buf);
    if (!scan.safe) return res.status(400).json({ error: 'file failed security scan', reason: scan.reason });

    fs.writeFileSync(outPath, buf);
    const reportsPath = path.join(__dirname, 'data', 'reports.json');
    let repo = { reports: [] };
    try{ repo = JSON.parse(fs.readFileSync(reportsPath,'utf8')); }catch(e){}
    repo.reports = repo.reports || [];
    const meta = { id: 'r-'+Date.now(), filename: safe, originalName: filename, centerId: centerId || null, patientId: patientId || null, uploader: req.user && req.user.id ? req.user.id : null, path: outPath, ts: Date.now(), size: sizeBytes, ftype, scan };
    repo.reports.push(meta);
    fs.writeFileSync(reportsPath, JSON.stringify(repo, null, 2), 'utf8');
    res.json({ ok: true, meta });
  }catch(e){
    console.warn('upload error', e);
    res.status(500).json({ error: 'failed to save' });
  }
});

// Admin: list all uploaded reports
app.get('/api/reports', requireAuth, requireRole(['admin']), (req, res) => {
  try{
    const reportsPath = path.join(__dirname, 'data', 'reports.json');
    let repo = { reports: [] };
    try{ repo = JSON.parse(fs.readFileSync(reportsPath,'utf8')); }catch(e){}
    res.json({ reports: repo.reports || [] });
  }catch(e){
    res.status(500).json({ error: 'failed to read reports' });
  }
});

// Socket.io: allow clients to join room by facility id
io.on('connection', socket => {
  socket.on('join_facility', id => {
    socket.join(id);
  });
  // send immediate snapshot
  socket.emit('snapshot', { ts: Date.now(), centers: readCenters() });
});

// Simple download proxy for saved uploads (admin-only)
app.get('/download', requireAuth, requireRole(['admin']), (req, res) => {
  const p = req.query.path;
  if (!p) return res.status(400).send('path required');
  // ensure path is under uploads
  const uploads = path.join(__dirname, 'uploads');
  const abs = path.resolve(p);
  if (!abs.startsWith(uploads)) return res.status(403).send('forbidden');
  res.sendFile(abs);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on ${PORT}`));

// Transcription queue: enqueue jobs and allow polling
const transcribeQueue = require('./data/transcribe_queue');
// start worker with socket.io so clients can receive updates
transcribeQueue.startWorker(io);

app.post('/api/transcribe', requireAuth, (req, res) => {
  const { filename, dataBase64, preferredLang } = req.body || {};
  if (!filename || !dataBase64) return res.status(400).json({ error: 'filename and dataBase64 required' });
  const UPLOADS_DIR = path.join(__dirname, 'uploads');
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const id = 't-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
  const safeBase = id + '-' + filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const origPath = path.join(UPLOADS_DIR, safeBase + '.in');
  const wavPath = path.join(UPLOADS_DIR, safeBase + '.wav');
  try{
    fs.writeFileSync(origPath, Buffer.from(dataBase64, 'base64'));
    const job = { id, filename: filename, origPath, wavPath, preferredLang: preferredLang || null, status: 'queued', createdAt: Date.now(), uploader: req.user && req.user.id ? req.user.id : null };
    transcribeQueue.enqueue(job);
    // start worker (already started) and notify clients
    io.emit('transcribe_update', { id, status: 'queued' });
    res.json({ jobId: id });
  }catch(e){ res.status(500).json({ error: 'failed to enqueue' }); }
});

app.get('/api/transcribe/:id', requireAuth, (req, res) => {
  const id = req.params.id;
  const job = transcribeQueue.getJob(id);
  if (!job) return res.status(404).json({ error: 'not found' });
  res.json({ job });
});

// Admin: list all transcription jobs (admin-only)
app.get('/api/transcribe/jobs', requireAuth, requireRole(['admin']), (req, res) => {
  try{
    const jobs = transcribeQueue.loadJobs ? transcribeQueue.loadJobs() : [];
    res.json({ jobs });
  }catch(e){ res.status(500).json({ error: 'failed to read jobs' }); }
});

// Admin: re-run (reset) a transcription job to queued state
app.post('/api/transcribe/:id/rerun', requireAuth, requireRole(['admin']), (req, res) => {
  const id = req.params.id;
  const job = transcribeQueue.getJob(id);
  if (!job) return res.status(404).json({ error: 'not found' });
  try{
    // clone the job (new id) and enqueue so the worker treats it as a fresh job
    const newId = 't-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
    const newJob = Object.assign({}, job, { id: newId, status: 'queued', createdAt: Date.now() });
    delete newJob.transcript; delete newJob.error; newJob.attempts = [];
    const all = transcribeQueue.loadJobs();
    all.push(newJob);
    transcribeQueue.saveJobs(all);
    io.emit('transcribe_update', { id: newJob.id, status: 'queued' });
    res.json({ ok: true, job: newJob });
  }catch(e){ res.status(500).json({ error: 'failed to rerun', detail: String(e) }); }
});

// Admin: delete a transcription job and associated storage (local files, optional GCS)
app.delete('/api/transcribe/:id', requireAuth, requireRole(['admin']), async (req, res) => {
  const id = req.params.id;
  const job = transcribeQueue.getJob(id);
  if (!job) return res.status(404).json({ error: 'not found' });
  try{
    // delete local files if present and within uploads dir
    const uploadsDir = path.join(__dirname, 'uploads');
    function safeUnlink(fp){
      try{
        const abs = path.resolve(fp);
        if (abs.startsWith(uploadsDir) && fs.existsSync(abs)) fs.unlinkSync(abs);
      }catch(e){ /* ignore */ }
    }
    if (job.origPath) safeUnlink(job.origPath);
    if (job.wavPath) safeUnlink(job.wavPath);

    // delete GCS object if configured and file likely uploaded
    const gcsBucket = process.env.GCLOUD_GCS_BUCKET || null;
    if (gcsBucket && job.wavPath){
      try{
        const { Storage } = require('@google-cloud/storage');
        const storage = new Storage();
        const destName = path.basename(job.wavPath);
        const bucket = storage.bucket(gcsBucket);
        const file = bucket.file(destName);
        await file.delete().catch(()=>null);
      }catch(e){ /* ignore GCS deletion errors */ }
    }

    // remove job record
    const all = transcribeQueue.loadJobs();
    const remaining = all.filter(j=> j.id !== job.id);
    transcribeQueue.saveJobs(remaining);
    io.emit('transcribe_update', { id: job.id, status: 'deleted' });
    res.json({ ok: true });
  }catch(e){ res.status(500).json({ error: 'delete failed', detail: String(e) }); }
});

// Server-side transcription adapter with audio normalization (ffmpeg) and fallback languages
const { exec } = require('child_process');
const util = require('util');
const execP = util.promisify(exec);

app.post('/api/transcribe', requireAuth, async (req, res) => {
  const { filename, dataBase64, format, preferredLang } = req.body || {};
  if (!filename || !dataBase64) return res.status(400).json({ error: 'filename and dataBase64 required' });
  const UPLOADS_DIR = path.join(__dirname, 'uploads');
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const safeBase = Date.now() + '-' + filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const origPath = path.join(UPLOADS_DIR, safeBase + '.raw');
  const wavPath = path.join(UPLOADS_DIR, safeBase + '.wav');

  try{
    const buf = Buffer.from(dataBase64, 'base64');
    fs.writeFileSync(origPath, buf);

    // Ensure ffmpeg exists and convert to 16k mono WAV
    try{
      await execP('ffmpeg -version');
    }catch(e){
      return res.status(501).json({ error: 'ffmpeg not available on server', hint: 'install ffmpeg or set TRANSCRIBE_CMD to handle input format directly' });
    }

    // Convert using ffmpeg (overwrite)
    const ffmpegCmd = `ffmpeg -y -i ${JSON.stringify(origPath)} -ac 1 -ar 16000 -sample_fmt s16 ${JSON.stringify(wavPath)}`;
    try{
      await execP(ffmpegCmd, { timeout: 30_000 });
    }catch(e){
      console.warn('ffmpeg convert failed', e);
      return res.status(500).json({ error: 'audio normalization failed', detail: String(e) });
    }

    // prepare transcription command
    const baseCmd = process.env.TRANSCRIBE_CMD;
    if (!baseCmd) return res.status(501).json({ error: 'server STT not configured', hint: 'set TRANSCRIBE_CMD env to a CLI that consumes the WAV file and prints transcript to stdout' });

    const langArgFmt = process.env.TRANSCRIBE_CMD_LANG_FORMAT || ''; // e.g. "--lang {lang}"
    const fallbackEnv = process.env.TRANSCRIBE_FALLBACK_LANGS || 'en,hi,pt,ru,zh';
    const fallbacks = fallbackEnv.split(',').map(x=>x.trim()).filter(Boolean);
    const attempts = [];

    async function runCmdWithLang(lang){
      const langPart = lang ? (' ' + langArgFmt.replace('{lang}', lang)) : '';
      const full = `${baseCmd}${langPart} ${JSON.stringify(wavPath)}`;
      try{
        const { stdout, stderr } = await execP(full, { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 });
        const t = String(stdout || '').trim();
        attempts.push({ lang: lang || null, ok: true, transcript: t, stderr: stderr && String(stderr).slice(0,2000) });
        return t;
      }catch(err){
        attempts.push({ lang: lang || null, ok: false, error: String(err).slice(0,2000) });
        return null;
      }
    }

    // Try preferredLang first if provided
    if (preferredLang) {
      const t = await runCmdWithLang(preferredLang);
      if (t && t.length > 5) return res.json({ transcript: t, attempts });
    }

    // Try without lang (auto-detect)
    const tAuto = await runCmdWithLang(null);
    if (tAuto && tAuto.length > 5) return res.json({ transcript: tAuto, attempts });

    // Try fallbacks
    for (const L of fallbacks){
      const t = await runCmdWithLang(L);
      if (t && t.length > 5) return res.json({ transcript: t, attempts });
    }

    // nothing produced
    res.status(502).json({ error: 'no transcript produced', attempts });
  }catch(e){
    console.warn('transcribe save error', e);
    res.status(500).json({ error: 'failed to save audio' });
  }
});
