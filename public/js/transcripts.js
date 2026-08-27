async function api(path, opts={}){
  const token = localStorage.getItem('token');
  const headers = opts.headers || {};
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function fmtDate(ts){ try{ return new Date(ts).toLocaleString(); }catch(e){ return ts; } }

async function loadJobs(){
  try{
    const data = await api('/api/transcribe/jobs');
    const tbody = document.querySelector('#jobsTable tbody');
    tbody.innerHTML = '';
    (data.jobs || []).forEach(j => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="mono">${j.id}</td><td>${j.filename || ''}</td><td>${j.status || ''}</td><td>${j.uploader||''}</td><td>${fmtDate(j.createdAt||j.queuedAt||j.ts||'')}</td><td></td>`;
      const actions = tr.querySelector('td:last-child');
      const viewBtn = document.createElement('button');
      viewBtn.textContent = 'View';
      viewBtn.onclick = ()=>{
        const w = window.open();
        w.document.body.innerHTML = '<pre class="mono">'+(j.transcript||JSON.stringify(j, null, 2))+'</pre>';
      };
      actions.appendChild(viewBtn);

      const rerun = document.createElement('button');
      rerun.textContent = 'Re-run';
      rerun.style.marginLeft = '8px';
      rerun.onclick = async ()=>{
        if (!confirm('Re-run job '+j.id+'?')) return;
        try{
          await api('/api/transcribe/'+encodeURIComponent(j.id)+'/rerun', { method: 'POST' });
          alert('Queued');
          loadJobs();
        }catch(err){ alert('Error: '+err.message); }
      };
      actions.appendChild(rerun);

      const delBtn = document.createElement('button');
      delBtn.textContent = 'Delete';
      delBtn.style.marginLeft = '8px';
      delBtn.onclick = async ()=>{
        if (!confirm('Delete job '+j.id+' and associated files?')) return;
        try{
          const token = localStorage.getItem('token');
          const res = await fetch('/api/transcribe/'+encodeURIComponent(j.id), { method: 'DELETE', headers: token ? { 'Authorization': 'Bearer '+token } : {} });
          if (!res.ok) throw new Error(await res.text());
          alert('Deleted');
          loadJobs();
        }catch(err){ alert('Error: '+err.message); }
      };
      actions.appendChild(delBtn);

      tbody.appendChild(tr);
    });
  }catch(e){
    console.error(e);
    alert('Failed to load jobs: '+e.message);
  }
}

document.getElementById('refreshBtn').addEventListener('click', loadJobs);
loadJobs();

// optional: listen to socket updates if socket.io client present
if (window.io){
  try{
    const socket = io();
    socket.on('transcribe_update', d=>{ loadJobs(); });
  }catch(e){}
}
