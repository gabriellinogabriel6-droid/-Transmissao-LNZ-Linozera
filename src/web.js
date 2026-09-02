const express = require('express');
const session = require('express-session');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const db = require('./db');
const { brl, formatDate, daysUntil } = require('./utils');
const { monthlyReport } = require('./report');

async function startWeb(botApi) {
  const app = express();
  const port = Number(process.env.PORT || 8080);
  const baseUrl = (process.env.BASE_URL || `http://localhost:${port}`).replace(/\/$/, '');
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: false },
    maxHttpBufferSize: 1e6
  });

  app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', path.join(process.cwd(), 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(express.static(path.join(process.cwd(), 'public')));

  const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'troque-esta-chave',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7, httpOnly: true, sameSite: 'lax', secure: baseUrl.startsWith('https://') }
  });
  app.use(sessionMiddleware);
  io.engine.use(sessionMiddleware);

  function currentGuildId() {
    return process.env.GUILD_ID || botApi.client.guilds.cache.first()?.id || null;
  }

  async function getAccess(req) {
    const guildId = currentGuildId();
    if (!req.session.user || !guildId) return { guildId, isAdmin: false, isClient: false, clientRecord: null };
    const userId = req.session.user.id;
    const cfg = db.getGuildConfig(guildId);
    const clientRecord = db.getClient(guildId, userId);
    let isAdmin = userId === process.env.OWNER_ID;
    if (!isAdmin) {
      try {
        const guild = botApi.client.guilds.cache.get(guildId);
        const member = await guild?.members.fetch(userId);
        if (member) isAdmin = member.permissions.has('Administrator') || Boolean(cfg.adminRoleId && member.roles.cache.has(cfg.adminRoleId));
      } catch {}
    }
    return { guildId, isAdmin, isClient: Boolean(clientRecord), clientRecord };
  }

  function requireLogin(req, res, next) {
    if (!req.session.user) return res.redirect('/');
    next();
  }

  async function requireAdmin(req, res, next) {
    const access = await getAccess(req);
    if (!access.isAdmin) return res.status(403).render('error', { message: 'Acesso restrito ao administrador.' });
    req.access = access;
    next();
  }

  app.get('/health', (req, res) => res.json({ ok: true, bot: botApi.client.user?.tag || null }));

  app.get('/', async (req, res) => {
    const access = await getAccess(req);
    res.render('home', { user: req.session.user || null, access });
  });

  app.get('/auth/discord', (req, res) => {
    const params = new URLSearchParams({
      client_id: process.env.CLIENT_ID,
      response_type: 'code',
      redirect_uri: `${baseUrl}/auth/discord/callback`,
      scope: 'identify'
    });
    res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
  });

  app.get('/auth/discord/callback', async (req, res) => {
    try {
      if (!req.query.code) throw new Error('Código de login não recebido.');
      const body = new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: String(req.query.code),
        redirect_uri: `${baseUrl}/auth/discord/callback`
      });
      const tokenResp = await fetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
      });
      if (!tokenResp.ok) throw new Error('Falha ao autenticar no Discord. Confira CLIENT_SECRET e Redirect URL.');
      const token = await tokenResp.json();
      const userResp = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` } });
      if (!userResp.ok) throw new Error('Não foi possível buscar seu usuário Discord.');
      const user = await userResp.json();
      req.session.user = { id: user.id, username: user.username, global_name: user.global_name, avatar: user.avatar };
      const access = await getAccess(req);
      res.redirect(access.isAdmin ? '/dashboard' : '/cliente');
    } catch (e) {
      res.status(400).render('error', { message: e.message });
    }
  });

  app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

  app.get('/dashboard', requireLogin, requireAdmin, async (req, res) => {
    const guildId = req.access.guildId;
    const clients = db.listClients(guildId).sort((a,b) => String(a.dueDate).localeCompare(String(b.dueDate)));
    const sales = db.listSales(guildId).slice(0, 100);
    const tickets = db.listTickets(guildId).slice(0, 100);
    const logs = db.readDb().logs.filter(l => l.guildId === guildId).slice(0, 150);
    const now = new Date();
    const report = monthlyReport(guildId, now.getFullYear(), now.getMonth() + 1);
    const monthly = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const r = monthlyReport(guildId, d.getFullYear(), d.getMonth() + 1);
      monthly.push({ label: `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(-2)}`, total: r.total });
    }
    res.render('admin', { user: req.session.user, clients, sales, tickets, logs, report, monthly, brl, formatDate, daysUntil, baseUrl, message: req.query.msg || '' });
  });

  app.post('/admin/cliente', requireLogin, requireAdmin, async (req, res) => {
    const { userId, plan, value, dueDate } = req.body;
    if (!/^\d{17,20}$/.test(String(userId || ''))) return res.redirect('/dashboard?msg=ID+do+Discord+inválido');
    db.upsertClient({ guildId: req.access.guildId, userId, plan, monthlyValue: Number(value), dueDate, createdBy: req.session.user.id });
    db.addLog(req.access.guildId, 'Cliente via site', req.session.user.id, `Cliente ${userId} cadastrado/atualizado pelo painel web.`);
    res.redirect('/dashboard?msg=Cliente+salvo+com+sucesso');
  });

  app.post('/admin/venda', requireLogin, requireAdmin, async (req, res) => {
    const { userId, product, amount, method } = req.body;
    db.addSale({ guildId: req.access.guildId, clientUserId: userId, product, amount: Number(amount), paymentMethod: method, sellerId: req.session.user.id });
    db.addLog(req.access.guildId, 'Venda via site', req.session.user.id, `Venda de ${product} para ${userId} registrada pelo painel web.`);
    res.redirect('/dashboard?msg=Venda+registrada');
  });

  app.post('/admin/renovar', requireLogin, requireAdmin, async (req, res) => {
    const { userId, days, amount } = req.body;
    const c = db.renewClient(req.access.guildId, userId, Number(days || 30), req.session.user.id, amount ? Number(amount) : null, 'painel web');
    if (c && amount) db.addSale({ guildId: req.access.guildId, clientUserId: userId, product: `Renovação ${c.plan}`, amount: Number(amount), paymentMethod: 'painel web', sellerId: req.session.user.id });
    db.addLog(req.access.guildId, 'Renovação via site', req.session.user.id, `Cliente ${userId} renovado pelo painel web.`);
    res.redirect('/dashboard?msg=Hospedagem+renovada');
  });

  app.get('/cliente', requireLogin, async (req, res) => {
    const access = await getAccess(req);
    if (access.isAdmin && !access.clientRecord) return res.redirect('/dashboard');
    if (!access.clientRecord) return res.status(403).render('error', { message: 'Seu Discord ainda não está cadastrado como cliente.' });
    const c = access.clientRecord;
    const sales = db.listSales(access.guildId).filter(s => s.clientUserId === req.session.user.id).slice(0, 50);
    const tickets = db.listTickets(access.guildId).filter(t => t.userId === req.session.user.id).slice(0, 30);
    res.render('client', { user: req.session.user, client: c, sales, tickets, brl, formatDate, daysUntil, baseUrl, message: req.query.msg || '', isAdmin: access.isAdmin });
  });

  app.get('/sala', requireLogin, async (req, res) => {
    const access = await getAccess(req);
    if (!access.isAdmin && !access.isClient) return res.status(403).render('error', { message: 'Você não tem acesso à sala de transmissão.' });
    res.render('room', {
      user: req.session.user,
      isAdmin: access.isAdmin,
      roomId: access.guildId
    });
  });

  app.post('/cliente/renovar', requireLogin, async (req, res) => {
    const access = await getAccess(req);
    if (!access.clientRecord) return res.status(403).render('error', { message: 'Cliente não encontrado.' });
    try {
      const result = await botApi.createTicketForUser(access.guildId, req.session.user.id, `Renovação do plano ${access.clientRecord.plan}`);
      res.redirect(`/cliente?msg=${encodeURIComponent(result.existing ? 'Seu ticket de atendimento já estava aberto.' : 'Ticket de renovação aberto no Discord.')}`);
    } catch (e) {
      res.redirect(`/cliente?msg=${encodeURIComponent(`Não consegui abrir o ticket: ${e.message}`)}`);
    }
  });

  app.get('/transcricao/:id', requireLogin, async (req, res) => {
    const t = db.getTicketById(req.params.id);
    if (!t) return res.status(404).render('error', { message: 'Transcrição não encontrada.' });
    const access = await getAccess(req);
    if (!access.isAdmin && t.userId !== req.session.user.id) return res.status(403).render('error', { message: 'Você não pode visualizar esta transcrição.' });
    res.render('transcript', { user: req.session.user, ticket: t, formatDate });
  });

  const roomBroadcasters = new Map();

  async function socketAccess(socket) {
    const req = socket.request;
    if (!req.session?.user) return { ok: false };
    const access = await getAccess(req);
    return { ok: access.isAdmin || access.isClient, access, user: req.session.user };
  }

  function emitRoomCount(roomId) {
    const count = io.sockets.adapter.rooms.get(roomId)?.size || 0;
    io.to(roomId).emit('room-count', count);
  }

  io.on('connection', async (socket) => {
    const auth = await socketAccess(socket);
    if (!auth.ok) return socket.disconnect(true);

    const roomId = auth.access.guildId;
    const displayName = auth.user.global_name || auth.user.username || 'Usuário';
    socket.data.roomId = roomId;
    socket.data.userId = auth.user.id;
    socket.data.displayName = displayName;
    socket.data.isAdmin = auth.access.isAdmin;
    socket.join(roomId);

    emitRoomCount(roomId);
    socket.emit('presence', { name: displayName, isAdmin: auth.access.isAdmin });

    const broadcasterId = roomBroadcasters.get(roomId);
    if (broadcasterId && broadcasterId !== socket.id) socket.emit('stream-available', { broadcasterId });

    socket.on('start-stream', () => {
      if (!socket.data.isAdmin) return socket.emit('app-error', 'Somente a administração pode iniciar a transmissão.');
      const active = roomBroadcasters.get(roomId);
      if (active && active !== socket.id) return socket.emit('app-error', 'Já existe uma transmissão ativa nesta sala.');
      roomBroadcasters.set(roomId, socket.id);
      socket.data.isStreaming = true;
      socket.to(roomId).emit('stream-started', { broadcasterId: socket.id, name: displayName });
      io.to(roomId).emit('system-message', { text: `${displayName} iniciou a transmissão.` });
    });

    socket.on('stop-stream', () => {
      if (roomBroadcasters.get(roomId) !== socket.id) return;
      roomBroadcasters.delete(roomId);
      socket.data.isStreaming = false;
      socket.to(roomId).emit('stream-stopped');
      io.to(roomId).emit('system-message', { text: `${displayName} encerrou a transmissão.` });
    });

    socket.on('watch-stream', ({ broadcasterId }) => {
      if (!broadcasterId || roomBroadcasters.get(roomId) !== broadcasterId) return;
      io.to(broadcasterId).emit('viewer-ready', { viewerId: socket.id });
    });

    socket.on('webrtc-offer', ({ target, sdp }) => {
      if (roomBroadcasters.get(roomId) !== socket.id || !target || !sdp) return;
      io.to(target).emit('webrtc-offer', { from: socket.id, sdp });
    });

    socket.on('webrtc-answer', ({ target, sdp }) => {
      if (!target || !sdp) return;
      io.to(target).emit('webrtc-answer', { from: socket.id, sdp });
    });

    socket.on('webrtc-ice', ({ target, candidate }) => {
      if (!target || !candidate) return;
      io.to(target).emit('webrtc-ice', { from: socket.id, candidate });
    });

    socket.on('chat-message', (raw) => {
      const text = String(raw || '').trim().slice(0, 1000);
      if (!text) return;
      io.to(roomId).emit('chat-message', {
        id: `${Date.now()}-${socket.id}`,
        userId: socket.data.userId,
        name: displayName,
        isAdmin: socket.data.isAdmin,
        text,
        time: new Date().toISOString()
      });
    });

    socket.on('disconnect', () => {
      if (roomBroadcasters.get(roomId) === socket.id) {
        roomBroadcasters.delete(roomId);
        socket.to(roomId).emit('stream-stopped');
        socket.to(roomId).emit('system-message', { text: 'A transmissão foi encerrada.' });
      }
      emitRoomCount(roomId);
    });
  });

  app.use((req, res) => res.status(404).render('error', { message: 'Página não encontrada.' }));

  server.listen(port, '0.0.0.0', () => console.log(`🌐 Painel web: ${baseUrl}`));
  return { app, server, io };
}

module.exports = { startWeb };
