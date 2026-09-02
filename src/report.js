const { listSales, listClients, listTickets } = require('./db');
const { monthBounds } = require('./utils');

function monthlyReport(guildId, year, month) {
  const { start, end } = monthBounds(year, month);
  const sales = listSales(guildId).filter(s => {
    const d = new Date(s.createdAt);
    return d >= start && d < end && s.status === 'paid';
  });
  const clients = listClients(guildId);
  const tickets = listTickets(guildId).filter(t => {
    const d = new Date(t.createdAt);
    return d >= start && d < end;
  });
  const total = sales.reduce((sum, s) => sum + Number(s.amount || 0), 0);
  const byProduct = {};
  const bySeller = {};
  for (const s of sales) {
    byProduct[s.product] = (byProduct[s.product] || 0) + 1;
    bySeller[s.sellerId] = (bySeller[s.sellerId] || 0) + Number(s.amount || 0);
  }
  const topProduct = Object.entries(byProduct).sort((a,b) => b[1]-a[1])[0] || null;
  const topSeller = Object.entries(bySeller).sort((a,b) => b[1]-a[1])[0] || null;
  const now = new Date();
  const active = clients.filter(c => c.dueDate && new Date(`${c.dueDate}T23:59:59`) >= now).length;
  const expired = clients.length - active;
  return { year, month, sales, clients, tickets, total, topProduct, topSeller, active, expired };
}

module.exports = { monthlyReport };
