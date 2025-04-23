const { Telegraf } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Handler untuk /start
bot.command('start', (ctx) => {
  ctx.reply('Halo! Selamat datang di bot Telegram yang berjalan di Vercel 🚀');
});

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    try {
      await bot.handleUpdate(req.body);
      return res.status(200).send('OK');
    } catch (err) {
      console.error('Error handling update', err);
      return res.status(500).send('Error');
    }
  } else {
    return res.status(200).send('Bot endpoint aktif ✅');
  }
};
