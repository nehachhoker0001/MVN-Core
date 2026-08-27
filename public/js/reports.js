function el(id){return document.getElementById(id)}

async function fetchReports(){
  const token = localStorage.getItem('token');
  if (!token) return alert('Please login as admin');
  const res = await fetch('/api/reports', { headers: { 'authorization': 'Bearer '+token } });
  if (res.status === 403) return alert('Forbidden: admin role required');
  if (!res.ok) return alert('Failed to load reports');
  const j = await res.json();
  return j.reports || [];
}

function render(reports){
  const tbody = el('list'); tbody.innerHTML = '';
  reports.slice().reverse().forEach(r => {
    const tr = document.createElement('tr');
    const time = new Date(r.ts).toLocaleString();
    const link = r.path ? `<a href="/download?path=${encodeURIComponent(r.path)}" target="_blank">Download</a>` : '';
    const size = r.size ? (Math.round(r.size/1024) + ' KB') : '';
    const ftype = r.ftype || '';
    const scan = r.scan ? (r.scan.safe ? 'OK' : ('FAIL: '+(r.scan.reason||'unknown'))) : '';
    tr.innerHTML = `<td>${time}</td><td>${r.originalName||r.filename}</td><td>${r.uploader||''}</td><td>${r.centerId||''}</td><td>${size}</td><td>${ftype}</td><td>${scan}</td><td>${link}</td>`;
    tbody.appendChild(tr);
  });
}

el('refresh').addEventListener('click', async ()=>{
  el('status').textContent = 'Loading...';
  try{
    const reports = await fetchReports();
    render(reports);
    el('status').textContent = `Loaded ${reports.length} entries`;
  }catch(e){ el('status').textContent = 'Error'; alert(e); }
});

document.addEventListener('DOMContentLoaded', ()=> el('refresh').click());
