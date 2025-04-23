const { Telegraf } = require('telegraf');

// Validasi BOT_TOKEN
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN environment variable tidak ditemukan!');
}

const bot = new Telegraf(BOT_TOKEN);

// Handler command /start
bot.command('start', (ctx) => {
  ctx.reply('Halo! Selamat datang di bot Telegram yang berjalan di Vercel 🚀');
});

// Handler untuk error
bot.catch((err, ctx) => {
  console.error(`Terjadi error untuk update ${ctx.update.update_id}:`, err);
});

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    try {
      let update = req.body;
      
      // Logging untuk debugging
      console.log('Received update:', JSON.stringify(update, null, 2));
      
      // Handle update
      await bot.handleUpdate(update);
      return res.status(200).send('OK');
    } catch (err) {
      console.error('Error handling update:', err);
      return res.status(500).json({
        error: 'Internal Server Error',
        message: err.message
      });
    }
  } else {
    // Informasi status untuk GET request
    return res.status(200).json({
      status: 'Bot aktif',
      platform: 'Vercel Serverless Function',
      info: 'Gunakan POST method untuk mengirim update Telegram'
    });
  }
};
