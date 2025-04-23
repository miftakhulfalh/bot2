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

bot.use(session());
bot.use(stage.middleware());

// Scene untuk setup spreadsheet
function setupSpreadsheetScene() {
  const scene = new Scenes.BaseScene('setup-spreadsheet');
  
  scene.enter((ctx) => {
    ctx.reply('📊 Selamat datang di Finance Bot!\n\nSilakan bagikan link Google Spreadsheet Anda:');
  });

  scene.on('text', async (ctx) => {
    const spreadsheetUrl = ctx.message.text;
    const isValidUrl = validateGoogleSheetUrl(spreadsheetUrl);

    if (!isValidUrl) {
      return ctx.reply('❌ Format URL tidak valid. Pastikan link berupa Google Sheet yang bisa diakses!');
    }

    try {
      const userData = {
        userId: ctx.from.id,
        username: ctx.from.username || ctx.from.first_name,
        spreadsheetUrl,
        registeredAt: new Date().toISOString()
      };

      await saveUserData(userData);
      
      ctx.reply('✅ Data berhasil disimpan!', Markup.inlineKeyboard([
        Markup.button.callback('Cek Akses Spreadsheet', 'verify_access')
      ]));
      
      return ctx.scene.leave();
    } catch (error) {
      console.error('Error saving user data:', error);
      return ctx.reply('❌ Gagal menyimpan data. Silakan coba lagi.');
    }
  });

  return scene;
}

// Command handlers
bot.command('start', async (ctx) => {
  await ctx.reply(`👋 Halo ${ctx.from.first_name}! Saya akan membantu mencatat keuangan Anda.`);
  await ctx.scene.enter('setup-spreadsheet');
});

// Action untuk verifikasi akses
bot.action('verify_access', async (ctx) => {
  try {
    const userSheetUrl = await getUsersSheetUrl(ctx.from.id);
    const doc = new GoogleSpreadsheet(extractSheetIdFromUrl(userSheetUrl));
    
    await doc.useServiceAccountAuth(SERVICE_ACCOUNT_CREDENTIALS);
    await doc.loadInfo();
    
    await ctx.editMessageText(
      `✅ Akses berhasil!\nJudul Spreadsheet: ${doc.title}\n` +
      `Terakhir diupdate: ${doc.updateTime}`
    );
  } catch (error) {
    console.error('Verification error:', error);
    await ctx.editMessageText(
      '❌ Belum bisa mengakses spreadsheet Anda. Pastikan:\n' +
      '1. Spreadsheet sudah dibagikan ke email service account\n' +
      '2. Link spreadsheet valid\n' +
      '3. Permission diatur ke "Editor"'
    );
  }
});

// Fungsi helper
function validateGoogleSheetUrl(url) {
  return url.startsWith('https://docs.google.com/spreadsheets/d/');
}

function extractSheetIdFromUrl(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

async function saveUserData(userData) {
  const doc = new GoogleSpreadsheet(MASTER_SHEET_ID);
  await doc.useServiceAccountAuth(SERVICE_ACCOUNT_CREDENTIALS);
  await doc.loadInfo();
  
  const sheet = doc.sheetsByIndex[0];
  await sheet.addRow({
    'User ID': userData.userId,
    'Username': userData.username,
    'Spreadsheet URL': userData.spreadsheetUrl,
    'Registered At': userData.registeredAt
  });
}

async function getUsersSheetUrl(userId) {
  const doc = new GoogleSpreadsheet(MASTER_SHEET_ID);
  await doc.useServiceAccountAuth(SERVICE_ACCOUNT_CREDENTIALS);
  await doc.loadInfo();
  
  const sheet = doc.sheetsByIndex[0];
  const rows = await sheet.getRows();
  
  const userRow = rows.find(row => row.get('User ID') === userId.toString());
  return userRow?.get('Spreadsheet URL');
}

// Vercel handler
export default async (req, res) => {
  if (req.method === 'POST') {
    try {
      await bot.handleUpdate(req.body);
      res.status(200).send('OK');
    } catch (err) {
      console.error('Bot error:', err);
      res.status(500).send('Error');
    }
  } else {
    res.status(200).json({ status: 'Bot Finance Active' });
  }
};
