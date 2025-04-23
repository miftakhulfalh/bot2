// api/bot.js
import { Telegraf } from 'telegraf';

// Validasi BOT_TOKEN
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN environment variable tidak ditemukan!');
}

const bot = new Telegraf(BOT_TOKEN);

// Handler command /start
bot.command('start', (ctx) => {
  ctx.reply('Halo! Bot sekarang menggunakan ES Modules 🚀');
});

// Error handling
bot.catch((err, ctx) => {
  console.error(`Error pada update ${ctx.update.update_id}:`, err);
});

// Handler untuk Vercel
export default async (req, res) => {
  if (req.method === 'POST') {
    try {
      let update = req.body;
      
      // Handle parsing untuk raw JSON
      if (typeof update === 'string') {
        update = JSON.parse(update);
      }
      
      await bot.handleUpdate(update);
      return res.status(200).send('OK');
    } catch (err) {
      console.error('Error handling update:', err);
      return res.status(500).json({
        error: err.message
      });
    }
  }
  
  // Response untuk GET request
  return res.status(200).json({
    status: 'Bot aktif',
    module_type: 'ES Modules',
    environment: process.env.NODE_ENV || 'development'
  });
};
