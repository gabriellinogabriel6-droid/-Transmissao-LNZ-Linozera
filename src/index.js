require('dotenv').config();
const { startBot } = require('./bot');
const { startWeb } = require('./web');
const { startScheduler } = require('./scheduler');

const required = ['DISCORD_TOKEN', 'CLIENT_ID', 'CLIENT_SECRET', 'OWNER_ID'];
const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`❌ Variáveis faltando: ${missing.join(', ')}`);
  console.error('Copie .env.example para .env e preencha os dados.');
  process.exit(1);
}

(async () => {
  try {
    const botApi = await startBot();
    await startWeb(botApi);
    startScheduler(botApi);
  } catch (e) {
    console.error('❌ Falha ao iniciar:', e);
    process.exit(1);
  }
})();
