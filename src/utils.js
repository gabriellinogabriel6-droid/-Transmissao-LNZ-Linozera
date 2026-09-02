function brl(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

function formatDate(date) {
  if (!date) return '—';
  const d = new Date(date.length === 10 ? `${date}T12:00:00` : date);
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(d);
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const due = new Date(`${dateStr}T12:00:00`);
  return Math.ceil((due - start) / 86400000);
}

function safeName(value) {
  return String(value || 'cliente')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-').slice(0, 70);
}

function monthBounds(year, month) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  return { start, end };
}

module.exports = { brl, formatDate, daysUntil, safeName, monthBounds };
