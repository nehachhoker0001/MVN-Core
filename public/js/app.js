const socket = io();

function playBeep(){
  try{
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 880;
    o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.9);
    setTimeout(()=>{ try{ o.stop(); ctx.close(); }catch(e){} }, 1000);
  }catch(e){ console.warn('beep failed', e) }
}

async function fetchLanguages() {
  const res = await fetch('/config/languages.json');
  return res.json();
}

function el(id){return document.getElementById(id)}

async function init() {
  const cfg = await fetchLanguages();
  const countrySelect = el('countrySelect');
  const langSelect = el('langSelect');
  const alarmToggle = el('alarmToggle');

  // populate countries (derive from languages list)
  const countries = [...new Set(cfg.languages.map(l => l.country).filter(Boolean))];
  countries.unshift('IN');
  countries.forEach(c => {
    const o = document.createElement('option'); o.value = c; o.textContent = c; countrySelect.appendChild(o);
  });

  // populate languages
  cfg.languages.forEach(l => {
    const o = document.createElement('option'); o.value = l.code; o.textContent = l.name; langSelect.appendChild(o);
  });

  langSelect.addEventListener('change', async () => {
    const code = langSelect.value;
    localStorage.setItem('preferred_lang', code);
    await loadLocale(code);
    applyTranslations();
    renderLastSnapshot();
  });

  // alarm toggle persistence
  if (alarmToggle){
    const savedAlarm = localStorage.getItem('alarmEnabled') === '1';
    alarmToggle.checked = savedAlarm;
    alarmToggle.addEventListener('change', () => localStorage.setItem('alarmEnabled', alarmToggle.checked ? '1' : '0'));
  }

  // restore saved language
  const saved = localStorage.getItem('preferred_lang');
  if (saved) {
    langSelect.value = saved;
    await loadLocale(saved);
  } else {
    // default to English
    langSelect.value = langSelect.options[0].value;
    await loadLocale(langSelect.value);
  }
  applyTranslations();

  // sidebar nav behavior
  document.querySelectorAll('aside.sidebar nav a').forEach(a=> a.addEventListener('click', e=>{
    e.preventDefault();
    const section = a.dataset.section;
    document.querySelectorAll('main section').forEach(s=> s.style.display = 'none');
    const sel = document.getElementById('section-'+section) || document.getElementById('section-'+section) ;
    if (sel) sel.style.display = '';
  }));

  el('authBtn').addEventListener('click', async () => {
    const country = countrySelect.value; const id = el('idInput').value.trim();
    const res = await fetch('/api/auth', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ country, id }) });
    const j = await res.json();
    alert(i18next.t('authenticated') + ': ' + JSON.stringify(j.profile));
  });

  // voice input
  el('voiceBtn').addEventListener('click', () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) return alert('Voice not supported');
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recog = new SpeechRecognition();
    recog.lang = 'en-US';
    recog.onresult = async e => {
      const transcript = e.results[0][0].transcript;
      // try to get geolocation, then call symptom-search
      let lat=null,lng=null;
      if (navigator.geolocation){
        try{
          const pos = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject));
          lat = pos.coords.latitude; lng = pos.coords.longitude;
        }catch(e){}
      }
      const res = await fetch('/api/symptom-search', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ symptoms: transcript, lat, lng }) });
      if (res.ok){
        const j = await res.json();
        renderSearchResults(j.results || []);
      } else {
        alert('Failed to search symptoms');
      }
    };
    recog.start();
  });

  // Record audio and send to server for transcription
  el('recordServerBtn').addEventListener('click', async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return alert('Audio capture not supported');
    try{
      const st = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(st);
      const chunks = [];
      mr.ondataavailable = e => chunks.push(e.data);
      mr.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const array = await blob.arrayBuffer();
        const b64 = btoa(String.fromCharCode(...new Uint8Array(array)));
        const token = localStorage.getItem('token');
        const headers = { 'content-type':'application/json' };
        if (token) headers['authorization'] = 'Bearer ' + token;
        const name = 'recording-' + Date.now() + '.webm';
        const statusEl = document.createElement('div'); statusEl.textContent = 'Transcribing...'; document.body.appendChild(statusEl);
        const res = await fetch('/api/transcribe', { method: 'POST', headers, body: JSON.stringify({ filename: name, dataBase64: b64, format: 'webm' }) });
        const j = await res.json();
        if (!res.ok) { statusEl.textContent = 'Transcription enqueue failed'; return; }
        const jobId = j.jobId;
        statusEl.textContent = 'Queued (job: '+jobId+')';

        // poll status
        const poll = setInterval(async ()=>{
          const sj = await fetch('/api/transcribe/'+encodeURIComponent(jobId), { headers: { 'authorization': 'Bearer '+(localStorage.getItem('token')||'') } });
          if (!sj.ok) { statusEl.textContent = 'Status check failed'; clearInterval(poll); return; }
          const sjj = await sj.json();
          const job = sjj.job;
          statusEl.textContent = 'Status: '+job.status;
          if (job.status === 'done'){
            clearInterval(poll);
            statusEl.textContent = 'Transcript: '+(job.transcript||'');
            // auto symptom search
            const latlng = await new Promise(resolve => {
              if (!navigator.geolocation) return resolve({});
              navigator.geolocation.getCurrentPosition(p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), ()=>resolve({}));
            });
            const searchRes = await fetch('/api/symptom-search', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ symptoms: job.transcript, lat: latlng.lat, lng: latlng.lng }) });
            if (searchRes.ok){ const sr = await searchRes.json(); renderSearchResults(sr.results || []); }
          } else if (job.status === 'failed'){
            clearInterval(poll);
            statusEl.textContent = 'Transcription failed: '+(job.error||'');
          }
        }, 2000);
        
        // also listen for socket updates
        socket.on('transcribe_update', data => {
          if (data && data.id === jobId){
            statusEl.textContent = 'Status (evt): '+(data.status||JSON.stringify(data.progress||{}));
          }
        });
        
      };
      mr.start();
      alert('Recording... click OK to stop');
      setTimeout(()=>mr.stop(), 30_000); // safety stop in 30s
    }catch(e){ console.warn('record error', e); alert('Failed to record'); }
  });

  el('fileUpload').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result; // data:...;base64,AAAA
      const base64 = dataUrl.split(',')[1];
      const token = localStorage.getItem('token');
      const headers = { 'content-type':'application/json' };
      if (token) headers['authorization'] = 'Bearer ' + token;
      const res = await fetch('/api/upload-report', { method: 'POST', headers, body: JSON.stringify({ filename: f.name, dataBase64: base64 }) });
      const j = await res.json();
      if (j.ok) alert('Uploaded report: ' + f.name);
      else if (j.error) alert('Upload failed: ' + j.error);
      else alert('Upload failed');
    };
    reader.readAsDataURL(f);
  });

function renderSearchResults(results){
  const container = el('searchResults');
  container.innerHTML = '';
  if (!results || !results.length) return container.textContent = 'No recommendations found.';
  results.forEach(r => {
    const c = r.center;
    const div = document.createElement('div'); div.className = 'center';
    const dist = r.distanceSq ? Math.sqrt(r.distanceSq).toFixed(3) : 'n/a';
    div.innerHTML = `<strong>${c.name}</strong><div>Doctors: ${c.doctors} • Beds: ${c.beds} • Score: ${r.score.toFixed(1)}</div><div>Distance est: ${dist}</div>`;
    container.appendChild(div);
  });
}

  el('ambBtn').addEventListener('click', async () => {
    if (!navigator.geolocation) return alert('Geolocation not supported');
    navigator.geolocation.getCurrentPosition(async pos => {
      const lat = pos.coords.latitude, lng = pos.coords.longitude;
      const res = await fetch('/api/request-ambulance', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ lat, lng, symptoms: 'accident' }) });
      const j = await res.json();
      if (j.assigned) alert(i18next.t('ambulanceAssigned') + ': ' + j.assigned);
      else alert(j.error || i18next.t('ambulanceError'));
    }, err => alert('Location denied'))
  });

  // socket handlers
  socket.on('snapshot', data => {
    window._lastSnapshot = data;
    renderLastSnapshot();
  });

  socket.on('ambulance_request', data => {
    console.log('ambulance request for facility', data);
  });

  // join as facility if id supplied via prompt (demo)
}

async function loadLocale(code){
  try{
    // fetch requested locale
    const res = await fetch('/locales/' + code + '.json');
    if (!res.ok) return;
    const data = await res.json();
    // ensure English is available as a fallback so missing keys don't fall back to other loaded languages
    let enData = {};
    if (code !== 'en'){
      try{
        const er = await fetch('/locales/en.json');
        if (er.ok) enData = await er.json();
      }catch(e){}
    } else { enData = data }
    const resources = { [code]: { translation: data } };
    if (Object.keys(enData).length) resources['en'] = { translation: enData };
    i18next.init({ lng: code, resources, fallbackLng: 'en' }, () => {});
  }catch(e){console.warn('no locale', code)}
}

function renderLastSnapshot(){
  const container = el('centers'); container.innerHTML = '';
  const snap = window._lastSnapshot;
  if (!snap) return container.textContent = 'No data yet';
  const lang = (i18next && i18next.language) || 'en';
  snap.centers.forEach(c => {
    const d = document.createElement('div'); d.className = 'center';
    const displayName = (c.name_translations && (c.name_translations[lang] || c.name_translations[lang.split('-')[0]])) || c.name;
    const short = `<strong>${displayName}</strong><div>${i18next.t('medicine')}: ${c.medicine}</div><div>${i18next.t('beds')}: ${c.beds}</div><div>${i18next.t('doctors')}: ${c.doctors}</div><div>${i18next.t('patientsPerDay')}: ${c.patientsPerDay}</div>`;
    d.innerHTML = short;
    // shortage warning
    const daysLeft = c.doctors>0 ? Math.round(c.medicine / Math.max(1, Math.round(c.patientsPerDay*0.6))) : Infinity;
    if (daysLeft < 7) {
      const a = document.createElement('div');
      if (daysLeft < 3) {
        a.className = 'alert urgent';
        a.textContent = i18next.t('urgent') || 'URGENT';
        // play alarm if enabled
        try{ if (document.getElementById('alarmToggle') && document.getElementById('alarmToggle').checked) playBeep(); }catch(e){}
      } else {
        a.className = 'alert';
        a.textContent = `${i18next.t('shortage')} ~${daysLeft} ${i18next.t('days')}`;
      }
      d.appendChild(a);
    }
    container.appendChild(d);
  });
}

function applyTranslations(){
  try{
    el('title').textContent = i18next.t('title');
    el('nearbyTitle').textContent = i18next.t('nearby');
    el('authBtn').textContent = i18next.t('authButton') || 'Authenticate';
    el('voiceBtn').textContent = i18next.t('voiceButton') || 'Voice Report';
    el('fileUpload').setAttribute('aria-label', i18next.t('uploadPlaceholder') || 'Upload report');
    el('ambBtn').textContent = i18next.t('requestAmbulance') || 'Request Ambulance';
    // sidebar labels
    if (el('navOverview')) el('navOverview').textContent = i18next.t('menuOverview') || 'Overview';
    if (el('navClinical')) el('navClinical').textContent = i18next.t('menuClinical') || 'Clinical';
    if (el('navReports')) el('navReports').textContent = i18next.t('menuReports') || 'Reports';
    if (el('navLogs')) el('navLogs').textContent = i18next.t('menuLogs') || 'Logs';
    if (el('navTranscripts')) el('navTranscripts').textContent = i18next.t('menuTranscripts') || 'Transcripts';
    if (el('enableAlarmLabel')) el('enableAlarmLabel').textContent = i18next.t('enableAlarm') || 'Enable alarm';
  }catch(e){console.warn('applyTranslations', e)}
}

init();
