import { Telegraf, Scenes, session, Markup } from 'telegraf';
import { GoogleSpreadsheet } from 'google-spreadsheet';

// Konfigurasi Google Sheets
const SERVICE_ACCOUNT_CREDENTIALS = JSON.parse(
  process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS
);
const MASTER_SHEET_ID = process.env.MASTER_SHEET_ID;

// Inisialisasi Bot
const bot = new Telegraf(process.env.BOT_TOKEN);
const stage = new Scenes.Stage([setupSpreadsheetScene()]);

// Middleware
bot.use(session({ 
  defaultSession: () => ({}) 
}));
bot.use(stage.middleware());

// Scene untuk setup spreadsheet
function setupSpreadsheetScene() {
  const scene = new Scenes.BaseScene('setup-spreadsheet');
  
  scene.enter(async (ctx) => {
    await ctx.reply('📊 Silakan bagikan link Google Spreadsheet Anda:');
    await ctx.reply('Contoh format:\nhttps://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit');
  });

  scene.on('text', async (ctx) => {
    try {
      const spreadsheetUrl = ctx.message.text.trim();
      
      if (!validateGoogleSheetUrl(spreadsheetUrl)) {
        return ctx.reply('❌ Format URL tidak valid. Pastikan link berupa Google Sheet!');
      }

      const userData = {
        userId: ctx.from.id,
        username: ctx.from.username || `${ctx.from.first_name}${ctx.from.last_name ? ' ' + ctx.from.last_name : ''}`,
        spreadsheetUrl,
        registeredAt: new Date().toISOString()
      };

      await saveUserData(userData);
      
      await ctx.reply('✅ Data tersimpan! Sekarang verifikasi akses:', 
        Markup.inlineKeyboard([
          Markup.button.callback('Verifikasi Akses', 'verify_access')
        ])
      );
      
      return ctx.scene.leave();
    } catch (error) {
      console.error('Error in scene:', error);
      await ctx.reply('❌ Gagal menyimpan. Coba lagi atau hubungi admin.');
      return ctx.scene.leave();
    }
  });

  return scene;
}

// Command handlers
bot.command('start', async (ctx) => {
  try {
    ctx.session = {};
    if (ctx.scene.current) await ctx.scene.leave();
    
    await ctx.replyWithMarkdown(`👋 Halo *${ctx.from.first_name}*!`);
    return ctx.scene.enter('setup-spreadsheet');
  } catch (error) {
    console.error('Start command error:', error);
    return ctx.reply('❌ Gagal memulai. Silakan coba lagi.');
  }
});

bot.action('verify_access', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const userSheetUrl = await getUsersSheetUrl(userId);
    
    if (!userSheetUrl) {
      return ctx.editMessageText('❌ Data tidak ditemukan. Gunakan /start untuk memulai ulang');
    }

    const doc = new GoogleSpreadsheet(extractSheetIdFromUrl(userSheetUrl));
    await doc.useServiceAccountAuth({
      client_email: SERVICE_ACCOUNT_CREDENTIALS.client_email,
      private_key: SERVICE_ACCOUNT_CREDENTIALS.private_key
    });
    
    await Promise.race([
      doc.loadInfo(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
    ]);

    return ctx.editMessageText(
      `✅ Verifikasi berhasil!\nJudul: ${doc.title}\n` +
      `Update terakhir: ${new Date(doc.updateTime).toLocaleString()}`
    );
    
  } catch (error) {
    console.error('Verification error:', error);
    const serviceAccountEmail = SERVICE_ACCOUNT_CREDENTIALS.client_email;
    const sheetId = ctx.match?.[1] ? ctx.match[1] : extractSheetIdFromUrl(await getUsersSheetUrl(ctx.from.id)) || '';
    
    return ctx.editMessageText(
      `❌ Gagal verifikasi. Pastikan:\n` +
      `1. Dibagikan ke: ${serviceAccountEmail}\n` +
      `2. Permission "Editor"\n` +
      `3. Link valid\n` +
      `4. Tunggu 1 menit setelah share`,
      Markup.inlineKeyboard([
        Markup.button.callback('🔄 Coba Lagi', 'verify_access'),
        Markup.button.url('Buka Spreadsheet', `https://docs.google.com/spreadsheets/d/${sheetId}/edit`),
        Markup.button.url('Bagikan Ulang', `https://docs.google.com/spreadsheets/d/${sheetId}/share`)
      ])
    );
  }
});

// Helper functions
function validateGoogleSheetUrl(url) {
  return /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+/.test(url);
}

function extractSheetIdFromUrl(url) {
  const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return match?.[1] || null;
}

async function saveUserData(userData) {
  const doc = new GoogleSpreadsheet(MASTER_SHEET_ID);
  await doc.useServiceAccountAuth(SERVICE_ACCOUNT_CREDENTIALS);
  await doc.loadInfo();

  let sheet = doc.sheetsByIndex[0] || await doc.addSheet({
    title: 'Users',
    headerValues: ['User ID', 'Username', 'Spreadsheet URL', 'Registered At']
  });

  if (!sheet.headerValues?.length) {
    await sheet.setHeaderRow(['User ID', 'Username', 'Spreadsheet URL', 'Registered At']);
  }

  await sheet.addRow({
    'User ID': userData.userId.toString(),
    'Username': userData.username,
    'Spreadsheet URL': userData.spreadsheetUrl,
    'Registered At': userData.registeredAt
  });

  await sheet.saveUpdatedCells();
}

async function getUsersSheetUrl(userId) {
  const doc = new GoogleSpreadsheet(MASTER_SHEET_ID);
  await doc.useServiceAccountAuth(SERVICE_ACCOUNT_CREDENTIALS);
  await doc.loadInfo();

  const sheet = doc.sheetsByIndex[0];
  
  // Pastikan header terisi
  if (!sheet.headerValues || sheet.headerValues.length === 0) {
    await sheet.setHeaderRow(['User ID', 'Username', 'Spreadsheet URL', 'Registered At']);
  }

  const rows = await sheet.getRows();
  
  // Cari dengan error handling dan fallback
  const userRow = rows.find(row => {
    try {
      // Cara 1: Gunakan get() jika tersedia
      if (typeof row.get === 'function') {
        return row.get('User ID') === userId.toString();
      }
      
      // Cara 2: Akses langsung via _rawData (fallback)
      return row._rawData[0]?.trim() === userId.toString();
    } catch (e) {
      console.error('Error processing row:', e);
      return false;
    }
  });

  // Akses data dengan cara yang sama
  if (userRow) {
    return typeof userRow.get === 'function' 
      ? userRow.get('Spreadsheet URL')
      : userRow._rawData[2]?.trim();
  }
  
  return null;
}

// Error handling
bot.catch((err, ctx) => {
  console.error('Global Bot Error:', err);
  ctx.reply('⚠️ Terjadi kesalahan sistem. Silakan coba lagi.');
});

// Vercel handler
export default async (req, res) => {
  if (req.method === 'POST') {
    try {
      let update = req.body;
      if (typeof update === 'string') update = JSON.parse(update);
      
      await bot.handleUpdate(update);
      return res.status(200).send('OK');
    } catch (err) {
      console.error('Bot endpoint error:', err);
      return res.status(500).json({ 
        error: 'Internal Server Error',
        message: err.message 
      });
    }
  }
  
  return res.status(200).json({ 
    status: 'Bot Finance Active',
    timestamp: new Date().toISOString() 
  });
};
