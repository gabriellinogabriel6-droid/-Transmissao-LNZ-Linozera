const {
  Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder,
  PermissionFlagsBits, ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const { joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');
const db = require('./db');
const { brl, formatDate, daysUntil, safeName } = require('./utils');
const { monthlyReport } = require('./report');

function buildCommands() {
  return [
    new SlashCommandBuilder()
      .setName('configurar').setDescription('Configura o sistema LNZ')
      .addSubcommand(s => s.setName('cargos').setDescription('Configura cargos')
        .addRoleOption(o => o.setName('admin').setDescription('Cargo administrador').setRequired(true))
        .addRoleOption(o => o.setName('suporte').setDescription('Cargo do suporte').setRequired(true))
        .addRoleOption(o => o.setName('cliente').setDescription('Cargo dos clientes').setRequired(false)))
      .addSubcommand(s => s.setName('canais').setDescription('Configura canais')
        .addChannelOption(o => o.setName('categoria_tickets').setDescription('Categoria para tickets').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
        .addChannelOption(o => o.setName('logs').setDescription('Canal de logs').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addChannelOption(o => o.setName('voz').setDescription('Call fixa do bot').addChannelTypes(ChannelType.GuildVoice).setRequired(true))
        .addChannelOption(o => o.setName('avisos').setDescription('Canal de avisos de vencimento').addChannelTypes(ChannelType.GuildText).setRequired(false))),
    new SlashCommandBuilder().setName('painel-ticket').setDescription('Envia o painel para abrir tickets')
      .addChannelOption(o => o.setName('canal').setDescription('Canal onde o painel será enviado').addChannelTypes(ChannelType.GuildText).setRequired(true)),
    new SlashCommandBuilder().setName('cliente').setDescription('Gerencia clientes')
      .addSubcommand(s => s.setName('adicionar').setDescription('Cadastra ou atualiza um cliente')
        .addUserOption(o => o.setName('usuario').setDescription('Cliente').setRequired(true))
        .addStringOption(o => o.setName('plano').setDescription('Plano/serviço').setRequired(true))
        .addNumberOption(o => o.setName('valor').setDescription('Valor mensal').setMinValue(0).setRequired(true))
        .addStringOption(o => o.setName('vencimento').setDescription('AAAA-MM-DD').setRequired(true)))
      .addSubcommand(s => s.setName('ver').setDescription('Mostra cadastro do cliente')
        .addUserOption(o => o.setName('usuario').setDescription('Cliente').setRequired(true))),
    new SlashCommandBuilder().setName('venda').setDescription('Registra vendas')
      .addSubcommand(s => s.setName('registrar').setDescription('Registra uma venda')
        .addUserOption(o => o.setName('cliente').setDescription('Cliente').setRequired(true))
        .addStringOption(o => o.setName('produto').setDescription('Produto/serviço').setRequired(true))
        .addNumberOption(o => o.setName('valor').setDescription('Valor da venda').setMinValue(0).setRequired(true))
        .addStringOption(o => o.setName('forma').setDescription('PIX, cartão, etc.').setRequired(true))),
    new SlashCommandBuilder().setName('hospedagem').setDescription('Gerencia hospedagens')
      .addSubcommand(s => s.setName('renovar').setDescription('Renova a hospedagem de um cliente')
        .addUserOption(o => o.setName('cliente').setDescription('Cliente').setRequired(true))
        .addIntegerOption(o => o.setName('dias').setDescription('Dias adicionados').setMinValue(1).setRequired(true))
        .addNumberOption(o => o.setName('valor').setDescription('Valor pago nesta renovação').setMinValue(0).setRequired(false))),
    new SlashCommandBuilder().setName('relatorio').setDescription('Relatório de vendas do mês')
      .addIntegerOption(o => o.setName('mes').setDescription('1 a 12').setMinValue(1).setMaxValue(12).setRequired(false))
      .addIntegerOption(o => o.setName('ano').setDescription('Ano').setMinValue(2024).setMaxValue(2100).setRequired(false)),
    new SlashCommandBuilder().setName('call').setDescription('Controla a conexão do bot na call')
      .addSubcommand(s => s.setName('entrar').setDescription('Entra/reconecta na call configurada')
        .addChannelOption(o => o.setName('canal').setDescription('Opcional: altera a call fixa').addChannelTypes(ChannelType.GuildVoice).setRequired(false)))
      .addSubcommand(s => s.setName('sair').setDescription('Sai da call'))
      .addSubcommand(s => s.setName('status').setDescription('Mostra o status da call')),
    new SlashCommandBuilder().setName('site').setDescription('Mostra o endereço do painel web')
  ].map(c => c.toJSON());
}

function isManager(interaction) {
  if (interaction.user.id === process.env.OWNER_ID) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  const cfg = db.getGuildConfig(interaction.guildId);
  return Boolean(cfg.adminRoleId && interaction.member?.roles?.cache?.has(cfg.adminRoleId));
}

async function sendLog(client, guildId, title, description, actorId = null) {
  db.addLog(guildId, title, actorId, description);
  const cfg = db.getGuildConfig(guildId);
  if (!cfg.logChannelId) return;
  try {
    const channel = await client.channels.fetch(cfg.logChannelId);
    if (!channel?.isTextBased()) return;
    await channel.send({ embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle(title).setDescription(description).setTimestamp()] });
  } catch (e) {
    console.error('Falha ao enviar log:', e.message);
  }
}

function connectVoice(client, guildId, channelId) {
  const guild = client.guilds.cache.get(guildId);
  const channel = guild?.channels.cache.get(channelId);
  if (!guild || !channel || channel.type !== ChannelType.GuildVoice) return false;
  try {
    const old = getVoiceConnection(guildId);
    if (old) old.destroy();
    joinVoiceChannel({
      channelId,
      guildId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: true
    });
    return true;
  } catch (e) {
    console.error('Erro na call:', e);
    return false;
  }
}

async function createTicketForUser(client, guildId, userId, reason = 'Atendimento') {
  const cfg = db.getGuildConfig(guildId);
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new Error('Servidor não encontrado.');
  if (!cfg.ticketCategoryId) throw new Error('Categoria de tickets ainda não configurada.');

  const existing = db.listTickets(guildId).find(t => t.userId === userId && t.status === 'open');
  if (existing) {
    const ch = guild.channels.cache.get(existing.channelId);
    if (ch) return { channel: ch, ticket: existing, existing: true };
  }

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
  ];
  if (cfg.supportRoleId) overwrites.push({ id: cfg.supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  if (cfg.adminRoleId && cfg.adminRoleId !== cfg.supportRoleId) overwrites.push({ id: cfg.adminRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });

  const user = await client.users.fetch(userId);
  const channel = await guild.channels.create({
    name: `ticket-${safeName(user.username)}`,
    type: ChannelType.GuildText,
    parent: cfg.ticketCategoryId,
    permissionOverwrites: overwrites,
    topic: `Cliente ${userId} | ${reason}`
  });
  const ticket = db.createTicketRecord({ guildId, channelId: channel.id, userId, reason });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Fechar ticket').setStyle(ButtonStyle.Danger)
  );
  await channel.send({
    content: `<@${userId}>${cfg.supportRoleId ? ` <@&${cfg.supportRoleId}>` : ''}`,
    embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle(`🎫 Ticket #${ticket.id}`).setDescription(`**Motivo:** ${reason}\n\nExplique o que precisa. Nossa equipe responderá por aqui.`).setFooter({ text: 'LNZ Gestão' })],
    components: [row]
  });
  await sendLog(client, guildId, 'Ticket aberto', `<@${userId}> abriu o ticket <#${channel.id}>.`, userId);
  return { channel, ticket, existing: false };
}

async function collectTranscript(channel) {
  const fetched = await channel.messages.fetch({ limit: 100 });
  return [...fetched.values()].sort((a,b) => a.createdTimestamp - b.createdTimestamp).map(m => ({
    authorId: m.author.id,
    author: m.author.username,
    content: m.content || (m.attachments.size ? '[anexo]' : '[mensagem sem texto]'),
    createdAt: m.createdAt.toISOString(),
    attachments: [...m.attachments.values()].map(a => a.url)
  }));
}

async function startBot() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates],
    partials: [Partials.Channel]
  });

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const commands = buildCommands();
  if (process.env.GUILD_ID) await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
  else await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });

  client.once('ready', async () => {
    console.log(`✅ Bot online como ${client.user.tag}`);
    client.user.setActivity('LNZ • Tickets & Vendas');
    for (const guild of client.guilds.cache.values()) {
      const cfg = db.getGuildConfig(guild.id);
      if (cfg.voiceChannelId) connectVoice(client, guild.id, cfg.voiceChannelId);
    }
  });

  client.on('voiceStateUpdate', (oldState) => {
    if (oldState.id !== client.user.id) return;
    if (oldState.channelId && !oldState.guild.members.me?.voice?.channelId) {
      const cfg = db.getGuildConfig(oldState.guild.id);
      if (cfg.voiceChannelId) setTimeout(() => connectVoice(client, oldState.guild.id, cfg.voiceChannelId), 5000);
    }
  });

  client.on('interactionCreate', async interaction => {
    try {
      if (interaction.isButton()) {
        if (interaction.customId === 'ticket_open') {
          const modal = new ModalBuilder().setCustomId('ticket_reason_modal').setTitle('Abrir atendimento');
          const reason = new TextInputBuilder().setCustomId('reason').setLabel('Como podemos ajudar?').setStyle(TextInputStyle.Paragraph).setMinLength(3).setMaxLength(500).setRequired(true);
          modal.addComponents(new ActionRowBuilder().addComponents(reason));
          return interaction.showModal(modal);
        }
        if (interaction.customId === 'ticket_close') {
          const t = db.listTickets(interaction.guildId).find(x => x.channelId === interaction.channelId && x.status === 'open');
          if (!t) return interaction.reply({ content: 'Esse ticket já está fechado ou não foi encontrado.', ephemeral: true });
          const cfg = db.getGuildConfig(interaction.guildId);
          const canClose = interaction.user.id === t.userId || isManager(interaction) || (cfg.supportRoleId && interaction.member.roles.cache.has(cfg.supportRoleId));
          if (!canClose) return interaction.reply({ content: 'Você não tem permissão para fechar este ticket.', ephemeral: true });
          await interaction.deferReply({ ephemeral: true });
          const transcript = await collectTranscript(interaction.channel);
          const closed = db.closeTicketRecord(interaction.channelId, interaction.user.id, transcript);
          const url = `${process.env.BASE_URL || 'http://localhost:8080'}/transcricao/${closed.id}`;
          try {
            const user = await client.users.fetch(t.userId);
            await user.send(`🎫 Seu ticket #${closed.id} foi fechado. Transcrição: ${url}`);
          } catch {}
          await sendLog(client, interaction.guildId, 'Ticket fechado', `Ticket #${closed.id} fechado por <@${interaction.user.id}>.`, interaction.user.id);
          await interaction.editReply(`Ticket fechado e transcrição salva. ${url}`);
          setTimeout(() => interaction.channel.delete('Ticket fechado').catch(() => {}), 3000);
          return;
        }
      }

      if (interaction.isModalSubmit() && interaction.customId === 'ticket_reason_modal') {
        await interaction.deferReply({ ephemeral: true });
        const result = await createTicketForUser(client, interaction.guildId, interaction.user.id, interaction.fields.getTextInputValue('reason'));
        return interaction.editReply(result.existing ? `Você já possui um ticket aberto: ${result.channel}` : `Seu ticket foi criado: ${result.channel}`);
      }

      if (!interaction.isChatInputCommand()) return;
      if (!interaction.guildId) return interaction.reply({ content: 'Use este comando dentro do servidor.', ephemeral: true });

      const managerCommands = ['configurar','painel-ticket','cliente','venda','hospedagem','relatorio','call'];
      if (managerCommands.includes(interaction.commandName) && !isManager(interaction)) {
        return interaction.reply({ content: 'Você não tem permissão para usar esse comando.', ephemeral: true });
      }

      if (interaction.commandName === 'configurar') {
        const sub = interaction.options.getSubcommand();
        if (sub === 'cargos') {
          const admin = interaction.options.getRole('admin');
          const suporte = interaction.options.getRole('suporte');
          const cliente = interaction.options.getRole('cliente');
          db.setGuildConfig(interaction.guildId, { adminRoleId: admin.id, supportRoleId: suporte.id, clientRoleId: cliente?.id || null });
          await sendLog(client, interaction.guildId, 'Configuração alterada', `Cargos configurados por <@${interaction.user.id}>.`, interaction.user.id);
          return interaction.reply({ content: '✅ Cargos configurados.', ephemeral: true });
        }
        if (sub === 'canais') {
          const category = interaction.options.getChannel('categoria_tickets');
          const logs = interaction.options.getChannel('logs');
          const voice = interaction.options.getChannel('voz');
          const avisos = interaction.options.getChannel('avisos');
          db.setGuildConfig(interaction.guildId, { ticketCategoryId: category.id, logChannelId: logs.id, voiceChannelId: voice.id, noticeChannelId: avisos?.id || logs.id });
          connectVoice(client, interaction.guildId, voice.id);
          await sendLog(client, interaction.guildId, 'Configuração alterada', `Canais configurados por <@${interaction.user.id}>.`, interaction.user.id);
          return interaction.reply({ content: `✅ Canais configurados. Também tentei conectar o bot em ${voice}.`, ephemeral: true });
        }
      }

      if (interaction.commandName === 'painel-ticket') {
        const channel = interaction.options.getChannel('canal');
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_open').setLabel('Abrir ticket').setEmoji('🎫').setStyle(ButtonStyle.Primary));
        await channel.send({ embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle('🎫 Central de Atendimento LNZ').setDescription('Precisa comprar, renovar, pedir suporte ou falar com o financeiro?\n\nClique no botão abaixo para abrir um atendimento privado.').setFooter({ text: 'LNZ Gestão' })], components: [row] });
        return interaction.reply({ content: `✅ Painel enviado em ${channel}.`, ephemeral: true });
      }

      if (interaction.commandName === 'cliente') {
        const sub = interaction.options.getSubcommand();
        const user = interaction.options.getUser('usuario');
        if (sub === 'adicionar') {
          const plan = interaction.options.getString('plano');
          const value = interaction.options.getNumber('valor');
          const due = interaction.options.getString('vencimento');
          if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(new Date(`${due}T12:00:00`).getTime())) return interaction.reply({ content: 'Data inválida. Use AAAA-MM-DD, exemplo: 2026-09-30.', ephemeral: true });
          const c = db.upsertClient({ guildId: interaction.guildId, userId: user.id, plan, monthlyValue: value, dueDate: due, createdBy: interaction.user.id });
          const cfg = db.getGuildConfig(interaction.guildId);
          if (cfg.clientRoleId) {
            const member = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (member) await member.roles.add(cfg.clientRoleId).catch(() => {});
          }
          await sendLog(client, interaction.guildId, 'Cliente cadastrado', `<@${user.id}> • ${plan} • ${brl(value)} • vence ${formatDate(due)}.`, interaction.user.id);
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x22c55e).setTitle('✅ Cliente salvo').setDescription(`<@${c.userId}>\n**Plano:** ${c.plan}\n**Valor:** ${brl(c.monthlyValue)}\n**Vencimento:** ${formatDate(c.dueDate)}`)], ephemeral: true });
        }
        const c = db.getClient(interaction.guildId, user.id);
        if (!c) return interaction.reply({ content: 'Cliente não encontrado.', ephemeral: true });
        const days = daysUntil(c.dueDate);
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(days < 0 ? 0xef4444 : days <= 7 ? 0xf59e0b : 0x22c55e).setTitle(`Cliente #${c.id}`).setDescription(`<@${c.userId}>\n**Plano:** ${c.plan}\n**Valor mensal:** ${brl(c.monthlyValue)}\n**Vencimento:** ${formatDate(c.dueDate)}\n**Dias restantes:** ${days}\n**Hospedagem:** ${days < 0 ? '🔴 Vencida' : '🟢 Ativa'}`)], ephemeral: true });
      }

      if (interaction.commandName === 'venda') {
        const user = interaction.options.getUser('cliente');
        const product = interaction.options.getString('produto');
        const value = interaction.options.getNumber('valor');
        const method = interaction.options.getString('forma');
        const sale = db.addSale({ guildId: interaction.guildId, clientUserId: user.id, product, amount: value, paymentMethod: method, sellerId: interaction.user.id });
        await sendLog(client, interaction.guildId, 'Venda registrada', `Venda #${sale.id}: <@${user.id}> • ${product} • ${brl(value)} • ${method}.`, interaction.user.id);
        return interaction.reply({ content: `✅ Venda #${sale.id} registrada: **${product} — ${brl(value)}**.`, ephemeral: true });
      }

      if (interaction.commandName === 'hospedagem') {
        const user = interaction.options.getUser('cliente');
        const days = interaction.options.getInteger('dias');
        const value = interaction.options.getNumber('valor');
        const c = db.renewClient(interaction.guildId, user.id, days, interaction.user.id, value, 'renovação');
        if (!c) return interaction.reply({ content: 'Cliente não encontrado. Cadastre com `/cliente adicionar` primeiro.', ephemeral: true });
        if (value !== null) db.addSale({ guildId: interaction.guildId, clientUserId: user.id, product: `Renovação ${c.plan}`, amount: value, paymentMethod: 'renovação', sellerId: interaction.user.id });
        await sendLog(client, interaction.guildId, 'Hospedagem renovada', `<@${user.id}> renovado por ${days} dias. Novo vencimento: ${formatDate(c.dueDate)}.`, interaction.user.id);
        return interaction.reply({ content: `✅ Renovação concluída. Novo vencimento de <@${user.id}>: **${formatDate(c.dueDate)}**.`, ephemeral: true });
      }

      if (interaction.commandName === 'relatorio') {
        const now = new Date();
        const month = interaction.options.getInteger('mes') || now.getMonth() + 1;
        const year = interaction.options.getInteger('ano') || now.getFullYear();
        const r = monthlyReport(interaction.guildId, year, month);
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle(`📊 Relatório ${String(month).padStart(2,'0')}/${year}`).addFields(
          { name: '💰 Faturamento', value: brl(r.total), inline: true },
          { name: '🛒 Vendas', value: String(r.sales.length), inline: true },
          { name: '🎫 Tickets', value: String(r.tickets.length), inline: true },
          { name: '🟢 Hospedagens ativas', value: String(r.active), inline: true },
          { name: '🔴 Vencidas', value: String(r.expired), inline: true },
          { name: '🏆 Mais vendido', value: r.topProduct ? `${r.topProduct[0]} (${r.topProduct[1]})` : 'Sem vendas', inline: true },
          { name: '👑 Melhor vendedor', value: r.topSeller ? `<@${r.topSeller[0]}> — ${brl(r.topSeller[1])}` : 'Sem vendas', inline: false }
        )], ephemeral: true });
      }

      if (interaction.commandName === 'call') {
        const sub = interaction.options.getSubcommand();
        if (sub === 'entrar') {
          const channel = interaction.options.getChannel('canal');
          let cfg = db.getGuildConfig(interaction.guildId);
          if (channel) cfg = db.setGuildConfig(interaction.guildId, { voiceChannelId: channel.id });
          if (!cfg.voiceChannelId) return interaction.reply({ content: 'Configure uma call primeiro com `/configurar canais` ou passe `canal` neste comando.', ephemeral: true });
          const ok = connectVoice(client, interaction.guildId, cfg.voiceChannelId);
          return interaction.reply({ content: ok ? '✅ Bot conectado na call e configurado para reconectar automaticamente.' : '❌ Não consegui entrar. Verifique permissões de Conectar/Ver Canal.', ephemeral: true });
        }
        if (sub === 'sair') {
          const conn = getVoiceConnection(interaction.guildId);
          if (conn) conn.destroy();
          return interaction.reply({ content: '✅ Saí da call. A call continua salva; use `/call entrar` para voltar.', ephemeral: true });
        }
        const me = interaction.guild.members.me;
        return interaction.reply({ content: me?.voice?.channel ? `🟢 Conectado em ${me.voice.channel}.` : '🔴 Não estou conectado em nenhuma call.', ephemeral: true });
      }

      if (interaction.commandName === 'site') {
        return interaction.reply({ content: `🌐 Painel LNZ: ${process.env.BASE_URL || 'http://localhost:8080'}`, ephemeral: true });
      }
    } catch (err) {
      console.error(err);
      const message = `❌ Erro: ${err.message || 'falha inesperada'}`;
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content: message }).catch(() => {});
      else await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
  });

  await client.login(process.env.DISCORD_TOKEN);
  return { client, createTicketForUser: (guildId, userId, reason) => createTicketForUser(client, guildId, userId, reason), sendLog: (...args) => sendLog(client, ...args), connectVoice: (...args) => connectVoice(client, ...args) };
}

module.exports = { startBot };
