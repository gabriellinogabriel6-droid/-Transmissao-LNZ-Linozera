const cron = require('node-cron');
const db = require('./db');
const { daysUntil, brl, formatDate } = require('./utils');
const { monthlyReport } = require('./report');
const { EmbedBuilder } = require('discord.js');

function startScheduler(botApi) {
  cron.schedule('0 9 * * *', async () => {
    for (const guild of botApi.client.guilds.cache.values()) {
      const cfg = db.getGuildConfig(guild.id);
      const clients = db.listClients(guild.id);
      for (const c of clients) {
        const days = daysUntil(c.dueDate);
        if (![7, 3, 1, 0].includes(days)) continue;
        const text = days === 0 ? 'vence hoje' : `vence em ${days} dia${days === 1 ? '' : 's'}`;
        try {
          const user = await botApi.client.users.fetch(c.userId);
          await user.send(`⏰ **LNZ — Renovação**\nSeu serviço **${c.plan}** ${text}.\nVencimento: **${formatDate(c.dueDate)}**\nValor atual: **${brl(c.monthlyValue)}**\nAcesse ${process.env.BASE_URL || 'o painel'} para solicitar a renovação.`);
        } catch {}
        if (cfg.noticeChannelId) {
          try {
            const ch = await botApi.client.channels.fetch(cfg.noticeChannelId);
            if (ch?.isTextBased()) await ch.send(`⏰ <@${c.userId}> — **${c.plan}** ${text} (${formatDate(c.dueDate)}).`);
          } catch {}
        }
      }
    }
  }, { timezone: 'America/Sao_Paulo' });

  cron.schedule('0 9 1 * *', async () => {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    for (const guild of botApi.client.guilds.cache.values()) {
      const cfg = db.getGuildConfig(guild.id);
      const r = monthlyReport(guild.id, prev.getFullYear(), prev.getMonth() + 1);
      if (!cfg.logChannelId) continue;
      try {
        const ch = await botApi.client.channels.fetch(cfg.logChannelId);
        if (!ch?.isTextBased()) continue;
        await ch.send({ embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle(`📊 Relatório mensal ${String(r.month).padStart(2,'0')}/${r.year}`).addFields(
          { name: 'Faturamento', value: brl(r.total), inline: true },
          { name: 'Vendas', value: String(r.sales.length), inline: true },
          { name: 'Tickets', value: String(r.tickets.length), inline: true },
          { name: 'Ativas', value: String(r.active), inline: true },
          { name: 'Vencidas', value: String(r.expired), inline: true },
          { name: 'Mais vendido', value: r.topProduct ? `${r.topProduct[0]} (${r.topProduct[1]})` : 'Sem vendas', inline: true }
        ).setFooter({ text: 'Gerado automaticamente pela LNZ Gestão' })] });
      } catch (e) { console.error('Erro relatório mensal:', e.message); }
    }
  }, { timezone: 'America/Sao_Paulo' });
}

module.exports = { startScheduler };
