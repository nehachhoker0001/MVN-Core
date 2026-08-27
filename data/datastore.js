const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'db.json');

function loadDb() {
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  return JSON.parse(raw);
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

function getCenters() {
  const db = loadDb();
  return db.centers || [];
}

function getCenter(id) {
  const centers = getCenters();
  return centers.find(c => c.id === id);
}

function updateCenter(id, patch) {
  const db = loadDb();
  const idx = db.centers.findIndex(c => c.id === id);
  if (idx === -1) return null;
  db.centers[idx] = { ...db.centers[idx], ...patch };
  saveDb(db);
  return db.centers[idx];
}

function addOrder(order) {
  const db = loadDb();
  order.id = `ord-${Date.now()}`;
  order.ts = Date.now();
  order.status = 'pending';
  order.supplierResults = [];
  db.orders.push(order);
  saveDb(db);
  return order;
}

function updateOrder(id, patch) {
  const db = loadDb();
  const idx = db.orders.findIndex(o => o.id === id);
  if (idx === -1) return null;
  db.orders[idx] = { ...db.orders[idx], ...patch };
  saveDb(db);
  return db.orders[idx];
}

module.exports = { getCenters, getCenter, updateCenter, addOrder, updateOrder };
