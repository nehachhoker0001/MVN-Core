function el(id){return document.getElementById(id)}

async function fetchLogs(){
  const token = localStorage.getItem('token');
  if (!token) return alert('Please login as admin');
  const res = await fetch('/api/auth-logs', { headers: { 'authorization': 'Bearer '+token } });
  if (res.status === 403) return alert('Forbidden: admin role required');
  if (!res.ok) return alert('Failed to load logs');
  const j = await res.json();
  return j.logs || [];
}

function renderLogs(logs){
  const tbody = document.querySelector('#logTable tbody');
  tbody.innerHTML = '';
  logs.slice().reverse().forEach(l => {
    const tr = document.createElement('tr');
    const time = new Date(l.ts).toLocaleString();
    tr.innerHTML = `<td>${time}</td><td>${l.country||''}</td><td>${l.id||''}</td><td>${l.method||''}</td><td>${l.success}</td><td><pre style="white-space:pre-wrap">${JSON.stringify(l.profile||{reason:l.reason||l.error}, null, 2)}</pre></td>`;
    tbody.appendChild(tr);
  });
}

el('refresh').addEventListener('click', async ()=>{
  el('status').textContent = 'Loading...';
  try{
    const logs = await fetchLogs();
    renderLogs(logs);
    el('status').textContent = `Loaded ${logs.length} entries`;
  }catch(e){ el('status').textContent = 'Error'; alert(e); }
});

// auto-refresh on load
document.addEventListener('DOMContentLoaded', ()=> el('refresh').click());
