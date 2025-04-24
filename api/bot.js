import { Telegraf, Scenes, session, Markup } from 'telegraf';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { createClient } from 'redis';

// ========================
// KONFIGURASI REDIS
// ========================
const redisClient = createClient({
  url: process.env.REDIS_URL,
  password: process.env.REDIS_PASSWORD
});

redisClient.on('error', (err) => console.error('Redis Error:', err));
await redisClient.connect();

// ========================
// CUSTOM REDIS SESSION STORAGE
// ========================
const redisStore = {
  async get(key) {
    const data = await redisClient.get(key);
    if (data) {
      return JSON.parse(data);
    }
    return {};
  },
  async set(key, value) {
    await redisClient.set(key, JSON.stringify(value));
  },
  async delete(key) {
    await redisClient.del(key);
  }
};

// ========================
// INISIALISASI BOT & SESSION
// ========================
const bot = new Telegraf(process.env.BOT_TOKEN);

// Custom session middleware
bot.use(session({
  store: redisStore,
  getSessionKey: (ctx) => ctx.from?.id.toString(),
  defaultSession: {
    isChangingSpreadsheet: false
  }
}));

// ========================
// SCENE DEFINITIONS
// ========================

function createSetupSpreadsheetScene() {
  const scene = new Scenes.BaseScene('setup-spreadsheet');
  
  scene.enter(async (ctx) => {
    try {
      // Cek session dari Redis
      if (ctx.session?.isChangingSpreadsheet) {
        await ctx.reply('📊 Silakan bagikan link Google Spreadsheet BARU Anda:');
        await ctx.reply('Contoh format:\nhttps://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit');
        return;
      }

      const userSheetData = await getUserSheetData(ctx.from.id);
      
      if (userSheetData?.spreadsheetUrl) {
        const sheetId = extractSheetIdFromUrl(userSheetData.spreadsheetUrl);
        
        try {
          const doc = new GoogleSpreadsheet(sheetId);
          await doc.useServiceAccountAuth(JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS));
          await doc.loadInfo();
          
          await ctx.replyWithMarkdown(`👋 Halo *${ctx.from.first_name}*!`);
          await ctx.reply(`Anda sudah memiliki spreadsheet:\n*${doc.title}*`, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [Markup.button.url('Buka Spreadsheet', userSheetData.spreadsheetUrl)],
                [Markup.button.callback('Verifikasi Ulang', 'verify_access')],
                [Markup.button.callback('Ganti Spreadsheet', 'change_spreadsheet')]
              ]
            }
          });
        } catch (error) {
          await ctx.reply('⚠️ Terjadi masalah dengan spreadsheet terdaftar. Silakan perbarui:');
        }
        return;
      }
      
      await ctx.replyWithMarkdown(`👋 Halo *${ctx.from.first_name}*!`);
      await ctx.reply('📊 Silakan bagikan link Google Spreadsheet Anda:');
      await ctx.reply('Contoh format:\nhttps://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit');
    } catch (error) {
      console.error('Scene enter error:', error);
      ctx.reply('❌ Terjadi kesalahan. Silakan coba lagi.');
    }
  });

  scene.on('text', async (ctx) => {
    try {
      const spreadsheetUrl = ctx.message.text.trim();
      
      if (!validateGoogleSheetUrl(spreadsheetUrl)) {
        return ctx.reply('❌ Format URL tidak valid! Contoh format yang benar:\nhttps://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit');
      }

      const userData = {
        userId: ctx.from.id,
        username: ctx.from.username || `${ctx.from.first_name}${ctx.from.last_name ? ' ' + ctx.from.last_name : ''}`,
        spreadsheetUrl,
        registeredAt: new Date().toISOString()
      };

      await saveUserData(userData);
      await ctx.reply('✅ Data tersimpan! Memverifikasi akses...');
      return ctx.scene.enter('auto_verify');
      
    } catch (error) {
      console.error('Scene text error:', error);
      ctx.reply('❌ Gagal menyimpan. Silakan coba lagi.');
      return ctx.scene.leave();
    }
  });

  return scene;
}

function createAutoVerifyScene() {
  const scene = new Scenes.BaseScene('auto_verify');
  
  scene.enter(async (ctx) => {
    try {
      const userSheetData = await getUserSheetData(ctx.from.id);
      
      if (!userSheetData?.spreadsheetUrl) {
        await ctx.reply('❌ Data tidak ditemukan!');
        return ctx.scene.leave();
      }

      const doc = new GoogleSpreadsheet(extractSheetIdFromUrl(userSheetData.spreadsheetUrl));
      await doc.useServiceAccountAuth({
        client_email: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS).client_email,
        private_key: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS).private_key
      });
      
      await doc.loadInfo();

      await ctx.replyWithMarkdown(
        `✅ Verifikasi berhasil!\n` + 
        `*Judul:* ${doc.title}\n` +
        `*Update Terakhir:* ${new Date(doc.updateTime).toLocaleString('id-ID')}`,
        Markup.inlineKeyboard([
          [Markup.button.url('Buka Spreadsheet', userSheetData.spreadsheetUrl)],
          [Markup.button.callback('Ganti Spreadsheet', 'change_spreadsheet')]
        ])
      );
      
      return ctx.scene.leave();
      
    } catch (error) {
      console.error('Auto verify error:', error);
      await ctx.reply('❌ Gagal verifikasi otomatis. Silakan verifikasi manual:');
      return ctx.scene.enter('manual_verify');
    }
  });

  return scene;
}

// ========================
// ACTION HANDLERS
// ========================

bot.action('change_spreadsheet', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Update session di Redis
    ctx.session.isChangingSpreadsheet = true;
    
    await ctx.editMessageText('🔄 Silakan kirim link spreadsheet BARU Anda:');
    return ctx.scene.enter('setup-spreadsheet');
  } catch (error) {
    console.error('Change spreadsheet error:', error);
    ctx.reply('❌ Gagal memulai proses perubahan. Silakan coba /start');
  }
});

// ========================
// CORE FUNCTIONS
// ========================

async function getUserSheetData(userId) {
  try {
    const doc = new GoogleSpreadsheet(process.env.MASTER_SHEET_ID);
    await doc.useServiceAccountAuth(JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS));
    await doc.loadInfo();

    const sheet = doc.sheetsByIndex[0];
    if (!sheet) return null;

    const rows = await sheet.getRows();
    const userRow = rows.find(row => row['User ID'] === userId.toString());
    
    if (!userRow) return null;
    
    return {
      userId: userRow['User ID'],
      username: userRow['Username'],
      spreadsheetUrl: userRow['Spreadsheet URL'],
      registeredAt: userRow['Registered At']
    };
  } catch (error) {
    console.error('Error getting user sheet data:', error);
    return null;
  }
}

async function saveUserData(userData) {
  const doc = new GoogleSpreadsheet(process.env.MASTER_SHEET_ID);
  await doc.useServiceAccountAuth(JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS));
  await doc.loadInfo();

  let sheet = doc.sheetsByIndex[0] || await doc.addSheet({
    title: 'Users',
    headerValues: ['User ID', 'Username', 'Spreadsheet URL', 'Registered At']
  });

  if (!sheet.headerValues?.length) {
    await sheet.setHeaderRow(['User ID', 'Username', 'Spreadsheet URL', 'Registered At']);
  }

  const rows = await sheet.getRows();
  const existingRow = rows.find(row => row['User ID'] === userData.userId.toString());

  if (existingRow) {
    existingRow['Username'] = userData.username;
    existingRow['Spreadsheet URL'] = userData.spreadsheetUrl;
    existingRow['Registered At'] = userData.registeredAt;
    await existingRow.save();
  } else {
    await sheet.addRow({
      'User ID': userData.userId.toString(),
      'Username': userData.username,
      'Spreadsheet URL': userData.spreadsheetUrl,
      'Registered At': userData.registeredAt
    });
  }
}

// ========================
// HELPER FUNCTIONS
// ========================

function validateGoogleSheetUrl(url) {
  return /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+/.test(url);
}

function extractSheetIdFromUrl(url) {
  const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return match?.[1] || null;
}

// ========================
// BOT SETUP
// ========================

const stage = new Scenes.Stage([
  createSetupSpreadsheetScene(),
  createAutoVerifyScene()
]);

bot.use(stage.middleware());

bot.command('start', async (ctx) => {
  try {
    if (ctx.scene.current) await ctx.scene.leave();
    ctx.session = {};
    return ctx.scene.enter('setup-spreadsheet');
  } catch (error) {
    console.error('Start command error:', error);
    ctx.reply('❌ Gagal memulai. Silakan coba lagi.');
  }
});

// ========================
// VERCEL HANDLER
// ========================

export default async (req, res) => {
  if (req.method === 'POST') {
    try {
      const update = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      await bot.handleUpdate(update);
      res.status(200).send('OK');
    } catch (error) {
      console.error('Webhook error:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  } else {
    res.status(200).json({ 
      status: 'Bot Aktif',
      redisStatus: await redisClient.ping()
    });
  }
};
