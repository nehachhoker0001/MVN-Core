async function loadCenters(){
  const res = await fetch('/api/healthcenters');
  const j = await res.json();
  return j.centers || [];
}

function el(id){return document.getElementById(id)}

async function render(){
  const list = el('list'); list.innerHTML = '';
  const centers = await loadCenters();
  centers.forEach(c => {
    const div = document.createElement('div'); div.className = 'center';
    div.innerHTML = `<strong>${c.id} — ${c.name}</strong>
      <div>Medicine: <input id="med-${c.id}" type="number" value="${c.medicine}" /></div>
      <div>Beds: <input id="beds-${c.id}" type="number" value="${c.beds}" /></div>
      <div>Doctors: <input id="docs-${c.id}" type="number" value="${c.doctors}" /></div>
      <button id="save-${c.id}">Save</button>
      <button id="order-${c.id}">Order Supply</button>
    `;
    list.appendChild(div);
    el(`save-${c.id}`).addEventListener('click', async ()=>{
      const token = localStorage.getItem('token');
      if (!token) return alert('Please login');
      const med = Number(el(`med-${c.id}`).value);
      const beds = Number(el(`beds-${c.id}`).value);
      const docs = Number(el(`docs-${c.id}`).value);
      const res = await fetch(`/api/center/${c.id}/update`, { method:'POST', headers: {'content-type':'application/json', 'authorization': 'Bearer '+token}, body: JSON.stringify({ medicine: med, beds, doctors: docs }) });
      const j = await res.json();
      if (j.ok) alert('Saved'); else alert('Save failed: '+ (j.error || JSON.stringify(j)));
      render();
    });
    el(`order-${c.id}`).addEventListener('click', async ()=>{
      const token = localStorage.getItem('token');
      if (!token) return alert('Please login');
      const qty = Number(prompt('Quantity to order', '1000'));
      if (!qty) return;
      const res = await fetch(`/api/center/${c.id}/order`, { method:'POST', headers: {'content-type':'application/json', 'authorization': 'Bearer '+token}, body: JSON.stringify({ quantity: qty }) });
      const j = await res.json();
      if (j.ok) alert('Order placed: ' + j.order.id);
      else alert('Order failed: '+ (j.error || JSON.stringify(j)));
    });
  });
}

async function doLogin(){
  const country = el('loginCountry').value;
  const id = el('loginId').value.trim();
  if (!id) return alert('enter id');
  const res = await fetch('/api/auth', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ country, id }) });
  const j = await res.json();
  if (j.token){ localStorage.setItem('token', j.token); el('who').textContent = j.profile.name + ' ('+ j.profile.role +')'; render(); }
  else alert('login failed');
}

el('loginBtn').addEventListener('click', doLogin);

render();
