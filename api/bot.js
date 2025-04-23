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

// Urutan middleware yang kritis
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
      
      // Validasi URL
      if (!validateGoogleSheetUrl(spreadsheetUrl)) {
        return ctx.reply('❌ Format URL tidak valid. Pastikan link berupa Google Sheet!');
      }

      // Simpan data
      const userData = {
        userId: ctx.from.id,
        username: ctx.from.username || `${ctx.from.first_name}${ctx.from.last_name ? ' ' + ctx.from.last_name : ''}`,
        spreadsheetUrl,
        registeredAt: new Date().toISOString()
      };

      await saveUserData(userData);
      
      // Response dengan inline keyboard
      await ctx.reply('✅ Data tersimpan! Sekarang verifikasi akses:', 
        Markup.inlineKeyboard([
          Markup.button.callback('Verifikasi Akses', 'verify_access')
        ])
      );
      
      ctx.scene.leave();
    } catch (error) {
      console.error('Error in scene:', error);
      ctx.reply('❌ Gagal menyimpan. Coba lagi atau hubungi admin.');
      ctx.scene.leave();
    }
  });

  return scene;
}

// Handler /start yang diperbaiki
bot.command('start', async (ctx) => {
  try {
    // Reset session
    ctx.session = {};
    
    // Hentikan scene aktif
    if (ctx.scene.current) await ctx.scene.leave();
    
    // Mulai alur
    await ctx.replyWithMarkdown(`👋 Halo *${ctx.from.first_name}*!`);
    await ctx.scene.enter('setup-spreadsheet');
  } catch (error) {
    console.error('Start command error:', error);
  }
});

// Di bagian action verify_access (perbaikan no 1)
bot.action('verify_access', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const userSheetUrl = await getUsersSheetUrl(userId);
    
    if (!userSheetUrl) {
      return ctx.editMessageText('❌ Data tidak ditemukan. Gunakan /start untuk memulai ulang');
    }

    const doc = new GoogleSpreadsheet(extractSheetIdFromUrl(userSheetUrl));
    await doc.useServiceAccountAuth(SERVICE_ACCOUNT_CREDENTIALS);
    await doc.loadInfo();

    // Cek akses dengan mencoba membaca judul sheet
    await ctx.editMessageText(
      `✅ Verifikasi Berhasil!\n` + 
      `Judul: ${doc.title}\n` +
      `Jumlah Sheet: ${doc.sheetCount}`
    );
    
  } catch (error) {
    console.error('Verification error:', error);
    await ctx.editMessageText(
      '❌ Gagal mengakses spreadsheet. Pastikan:\n' +
      '1. Sudah dibagikan ke: ' + SERVICE_ACCOUNT_CREDENTIALS.client_email + '\n' +
      '2. Permission set ke "Editor"\n' +
      '3. Link valid',
      Markup.inlineKeyboard([ // Tambahkan tombol verifikasi ulang
        Markup.button.callback('🔁 Coba Verifikasi Lagi', 'verify_access')
      ])
    );
  }
});

// Fungsi helper
function validateGoogleSheetUrl(url) {
  return /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+(\/edit)?(\?.*)?$/.test(url);
}

function extractSheetIdFromUrl(url) {
  const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

// Di fungsi saveUserData (perbaikan no 3)
async function saveUserData(userData) {
  const doc = new GoogleSpreadsheet(MASTER_SHEET_ID);
  await doc.useServiceAccountAuth(SERVICE_ACCOUNT_CREDENTIALS);
  await doc.loadInfo();

  let sheet;
  try {
    sheet = doc.sheetsByIndex[0];
  } catch (e) {
    sheet = await doc.addSheet({ 
      title: 'Users',
      headerValues: ['User ID', 'Username', 'Spreadsheet URL', 'Registered At']
    });
  }

  // Pastikan header ada
  if (!sheet.headerValues || sheet.headerValues.length === 0) {
    await sheet.setHeaderRow(['User ID', 'Username', 'Spreadsheet URL', 'Registered At']);
  }

  // Tambahkan row baru
  await sheet.addRow({
    'User ID': userData.userId.toString(),
    'Username': userData.username,
    'Spreadsheet URL': userData.spreadsheetUrl,
    'Registered At': userData.registeredAt
  });

  // Force update
  await sheet.saveUpdatedCells();
}

// Di fungsi getUsersSheetUrl (perbaikan no 2)
async function getUsersSheetUrl(userId) {
  const doc = new GoogleSpreadsheet(MASTER_SHEET_ID);
  await doc.useServiceAccountAuth(SERVICE_ACCOUNT_CREDENTIALS);
  await doc.loadInfo();
  
  const sheet = doc.sheetsByIndex[0];
  const rows = await sheet.getRows();
  
  // Perbaikan handling row
  const userRow = rows.find(row => {
    try {
      return row.get('User ID') === userId.toString();
    } catch (e) {
      console.warn('Error reading row:', e);
      return false;
    }
  });
  
  return userRow?.get('Spreadsheet URL');
}


// Error handling global
bot.catch((err, ctx) => {
  console.error('Global Bot Error:', err);
  ctx.reply('⚠️ Terjadi kesalahan sistem. Silakan coba lagi.');
});

// Vercel handler
export default async (req, res) => {
  if (req.method === 'POST') {
    try {
      await bot.handleUpdate(req.body);
      res.status(200).send('OK');
    } catch (err) {
      console.error('Bot endpoint error:', err);
      res.status(500).json({ error: err.message });
    }
  } else {
    res.status(200).json({ 
      status: 'Bot Aktif',
      environment: process.env.NODE_ENV || 'development'
    });
  }
};
