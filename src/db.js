const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.cwd(), 'data.json');

const emptyDb = () => ({
  guilds: {},
  clients: [],
  sales: [],
  tickets: [],
  logs: [],
  counters: { client: 0, sale: 0, ticket: 0, log: 0 }
});

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(emptyDb(), null, 2));
  }
}

function readDb() {
  ensureDb();
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const data = JSON.parse(raw || '{}');
    return { ...emptyDb(), ...data, counters: { ...emptyDb().counters, ...(data.counters || {}) } };
  } catch (err) {
    console.error('Falha ao ler data.json:', err);
    return emptyDb();
  }
}

function writeDb(data) {
  const temp = `${DB_PATH}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, DB_PATH);
}

function mutate(fn) {
  const db = readDb();
  const result = fn(db);
  writeDb(db);
  return result;
}

function getGuildConfig(guildId) {
  const db = readDb();
  return db.guilds[guildId] || {};
}

function setGuildConfig(guildId, patch) {
  return mutate(db => {
    db.guilds[guildId] = { ...(db.guilds[guildId] || {}), ...patch, updatedAt: new Date().toISOString() };
    return db.guilds[guildId];
  });
}

function addLog(guildId, type, actorId, text, meta = {}) {
  return mutate(db => {
    const id = ++db.counters.log;
    const item = { id, guildId, type, actorId, text, meta, createdAt: new Date().toISOString() };
    db.logs.unshift(item);
    db.logs = db.logs.slice(0, 3000);
    return item;
  });
}

function upsertClient({ guildId, userId, plan, monthlyValue, dueDate, createdBy }) {
  return mutate(db => {
    let c = db.clients.find(x => x.guildId === guildId && x.userId === userId);
    if (!c) {
      c = {
        id: ++db.counters.client,
        guildId,
        userId,
        plan,
        monthlyValue: Number(monthlyValue || 0),
        dueDate,
        status: 'active',
        hostingActive: true,
        payments: [],
        createdBy,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      db.clients.push(c);
    } else {
      c.plan = plan || c.plan;
      c.monthlyValue = monthlyValue !== undefined ? Number(monthlyValue) : c.monthlyValue;
      c.dueDate = dueDate || c.dueDate;
      c.status = 'active';
      c.hostingActive = true;
      c.updatedAt = new Date().toISOString();
    }
    return c;
  });
}

function getClient(guildId, userId) {
  return readDb().clients.find(x => x.guildId === guildId && x.userId === userId) || null;
}

function listClients(guildId) {
  return readDb().clients.filter(x => x.guildId === guildId);
}

function renewClient(guildId, userId, days, actorId, amount = null, method = 'manual') {
  return mutate(db => {
    const c = db.clients.find(x => x.guildId === guildId && x.userId === userId);
    if (!c) return null;
    const now = new Date();
    const current = c.dueDate ? new Date(`${c.dueDate}T12:00:00`) : now;
    const base = current > now ? current : now;
    base.setDate(base.getDate() + Number(days));
    c.dueDate = base.toISOString().slice(0, 10);
    c.status = 'active';
    c.hostingActive = true;
    c.updatedAt = new Date().toISOString();
    if (amount !== null) {
      c.payments.unshift({ amount: Number(amount), method, actorId, paidAt: new Date().toISOString() });
    }
    return c;
  });
}

function addSale({ guildId, clientUserId, product, amount, paymentMethod, sellerId, status = 'paid' }) {
  return mutate(db => {
    const sale = {
      id: ++db.counters.sale,
      guildId,
      clientUserId,
      product,
      amount: Number(amount),
      paymentMethod,
      sellerId,
      status,
      createdAt: new Date().toISOString()
    };
    db.sales.unshift(sale);
    return sale;
  });
}

function listSales(guildId) {
  return readDb().sales.filter(x => x.guildId === guildId);
}

function createTicketRecord({ guildId, channelId, userId, reason }) {
  return mutate(db => {
    const t = {
      id: ++db.counters.ticket,
      guildId,
      channelId,
      userId,
      reason,
      status: 'open',
      createdAt: new Date().toISOString(),
      closedAt: null,
      closedBy: null,
      transcript: []
    };
    db.tickets.unshift(t);
    return t;
  });
}

function closeTicketRecord(channelId, closedBy, transcript) {
  return mutate(db => {
    const t = db.tickets.find(x => x.channelId === channelId && x.status === 'open');
    if (!t) return null;
    t.status = 'closed';
    t.closedAt = new Date().toISOString();
    t.closedBy = closedBy;
    t.transcript = transcript;
    return t;
  });
}

function listTickets(guildId) {
  return readDb().tickets.filter(x => x.guildId === guildId);
}

function getTicketById(id) {
  return readDb().tickets.find(x => String(x.id) === String(id)) || null;
}

module.exports = {
  readDb,
  getGuildConfig,
  setGuildConfig,
  addLog,
  upsertClient,
  getClient,
  listClients,
  renewClient,
  addSale,
  listSales,
  createTicketRecord,
  closeTicketRecord,
  listTickets,
  getTicketById
};
