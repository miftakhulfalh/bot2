import { Telegraf, Scenes, session, Markup } from 'telegraf';
import { GoogleSpreadsheet } from 'google-spreadsheet';

// Konfigurasi Google Sheets
const SERVICE_ACCOUNT_CREDENTIALS = JSON.parse(
  process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS
);
const MASTER_SHEET_ID = process.env.MASTER_SHEET_ID;

// Inisialisasi Bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// ========================
// SCENE DEFINITIONS
// ========================

function createSetupSpreadsheetScene() {
  const scene = new Scenes.BaseScene('setup-spreadsheet');
  
  scene.enter(async (ctx) => {
    try {
      // Cek jika sedang dalam proses ganti spreadsheet
      if (ctx.session?.isChangingSpreadsheet) {
        await ctx.reply('📊 Silakan bagikan link Google Spreadsheet BARU Anda:');
        await ctx.reply('Contoh format:\nhttps://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit');
        return;
      }

      // Cek spreadsheet existing
      const userSheetData = await getUserSheetData(ctx.from.id);
      
      if (userSheetData?.spreadsheetUrl) {
        const sheetId = extractSheetIdFromUrl(userSheetData.spreadsheetUrl);
        
        try {
          const doc = new GoogleSpreadsheet(sheetId);
          await doc.useServiceAccountAuth(SERVICE_ACCOUNT_CREDENTIALS);
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
          await ctx.replyWithMarkdown(`👋 Halo *${ctx.from.first_name}*!`);
          await ctx.reply('Terjadi masalah dengan spreadsheet terdaftar. Silakan perbarui:');
        }
        return;
      }
      
      // Jika belum punya spreadsheet
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

      // Simpan/update data
      const userData = {
        userId: ctx.from.id,
        username: ctx.from.username || `${ctx.from.first_name}${ctx.from.last_name ? ' ' + ctx.from.last_name : ''}`,
        spreadsheetUrl,
        registeredAt: new Date().toISOString()
      };

      await saveUserData(userData, ctx);
      
      // Verifikasi otomatis setelah update
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

      const sheetId = extractSheetIdFromUrl(userSheetData.spreadsheetUrl);
      const doc = new GoogleSpreadsheet(sheetId);
      
      await doc.useServiceAccountAuth({
        client_email: SERVICE_ACCOUNT_CREDENTIALS.client_email,
        private_key: SERVICE_ACCOUNT_CREDENTIALS.private_key
      });
      
      await doc.loadInfo();

      await ctx.replyWithMarkdown(
        `✅ Verifikasi berhasil!\n` + 
        `*Judul:* ${doc.title}\n` +
        `*Jumlah Sheet:* ${doc.sheetCount}\n` +
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

function createManualVerifyScene() {
  const scene = new Scenes.BaseScene('manual_verify');
  
  scene.enter(async (ctx) => {
    try {
      const userSheetData = await getUserSheetData(ctx.from.id);
      const serviceEmail = SERVICE_ACCOUNT_CREDENTIALS.client_email;
      
      await ctx.replyWithMarkdown(
        `⚠️ Verifikasi Gagal! Pastikan:\n` +
        `1. Spreadsheet dibagikan ke *${serviceEmail}*\n` +
        `2. Permission set ke *Editor*\n` +
        `3. Link valid`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Coba Verifikasi Kembali', 'verify_access')],
          [Markup.button.callback('✏️ Ganti Spreadsheet', 'change_spreadsheet')]
        ])
      );
      
    } catch (error) {
      console.error('Manual verify error:', error);
      ctx.reply('❌ Terjadi kesalahan. Silakan coba /start');
    }
    return ctx.scene.leave();
  });

  return scene;
}

// ========================
// ACTION HANDLERS
// ========================

bot.action('change_spreadsheet', async (ctx) => {
  try {
    // Ensure session is initialized
    if (!ctx.session) {
      ctx.session = {}; // Initialize session if it doesn't exist
    }
    
    await ctx.answerCbQuery();
    ctx.session.isChangingSpreadsheet = true;
    
    // Check if the scene is defined before entering
    if (ctx.scene) {
      await ctx.editMessageText('🔄 Silakan kirim link spreadsheet BARU Anda:');
      return ctx.scene.enter('setup-spreadsheet');
    } else {
      console.error('Scene not defined');
      ctx.reply('❌ Gagal memulai proses perubahan. Silakan coba /start');
    }
  } catch (error) {
    console.error('Change spreadsheet error:', error);
    ctx.reply('❌ Gagal memulai proses perubahan. Silakan coba /start');
  }
});

bot.action('verify_access', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    return ctx.scene.enter('auto_verify');
  } catch (error) {
    console.error('Verify access error:', error);
    ctx.reply('❌ Gagal memulai verifikasi. Silakan coba /start');
  }
});

// ========================
// CORE FUNCTIONS
// ========================

async function saveUserData(userData, ctx) {
  const doc = new GoogleSpreadsheet(MASTER_SHEET_ID);
  await doc.useServiceAccountAuth(SERVICE_ACCOUNT_CREDENTIALS);
  await doc.loadInfo();

  let sheet = doc.sheetsByIndex[0];
  if (!sheet) {
    sheet = await doc.addSheet({
      title: 'Users',
      headerValues: ['User ID', 'Username', 'Spreadsheet URL', 'Registered At']
    });
  }

  if (!sheet.headerValues?.length) {
    await sheet.setHeaderRow(['User ID', 'Username', 'Spreadsheet URL', 'Registered At']);
  }

  const rows = await sheet.getRows();
  const existingRowIndex = rows.findIndex(row => 
    row['User ID'] === userData.userId.toString()
  );

  if (existingRowIndex > -1) {
    const row = rows[existingRowIndex];
    row['Username'] = userData.username;
    row['Spreadsheet URL'] = userData.spreadsheetUrl;
    row['Registered At'] = userData.registeredAt;
    await row.save();
  } else {
    await sheet.addRow({
      'User ID': userData.userId.toString(),
      'Username': userData.username,
      'Spreadsheet URL': userData.spreadsheetUrl,
      'Registered At': userData.registeredAt
    });
  }

  if (ctx?.session) {
    ctx.session.isChangingSpreadsheet = false;
  }
}

async function getUserSheetData(userId) {
  try {
    const doc = new GoogleSpreadsheet(MASTER_SHEET_ID);
    await doc.useServiceAccountAuth(SERVICE_ACCOUNT_CREDENTIALS);
    await doc.loadInfo();

    const sheet = doc.sheetsByIndex[0];
    if (!sheet) return null;

    const rows = await sheet.getRows();
    const userRow = rows.find(row => 
      row['User ID'] === userId.toString()
    );

    if (!userRow) return null;

    return {
      userId: userRow['User ID'],
      username: userRow['Username'],
      spreadsheetUrl: userRow['Spreadsheet URL'],
      registeredAt: userRow['Registered At']
    };
  } catch (error) {
    console.error('Get user data error:', error);
    return null;
  }
}

// ========================
// HELPER FUNCTIONS
// ========================

function validateGoogleSheetUrl(url) {
  return /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+(\/edit|.*)?$/.test(url);
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
  createAutoVerifyScene(),
  createManualVerifyScene()
]);

bot.use(session());
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

bot.catch((err, ctx) => {
  console.error('Global Bot Error:', err);
  ctx?.reply('⚠️ Terjadi kesalahan sistem. Silakan coba lagi.');
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
      timestamp: new Date().toISOString()
    });
  }
};
