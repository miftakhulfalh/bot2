import { Telegraf, Scenes, session, Markup } from 'telegraf';
import { GoogleSpreadsheet } from 'google-spreadsheet';

// Konfigurasi Google Sheets
const SERVICE_ACCOUNT_CREDENTIALS = JSON.parse(
  process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS
);
const MASTER_SHEET_ID = process.env.MASTER_SHEET_ID;

// Inisialisasi Bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// Fungsi untuk membuat setup scene
function createSetupSpreadsheetScene() {
  const scene = new Scenes.BaseScene('setup-spreadsheet');
  
  // Definisikan tindakan saat scene dimulai
  scene.enter(async (ctx) => {
    try {
      const userId = ctx.from.id;
      // Cek apakah user sudah memiliki spreadsheet
      const userSheetData = await getUserSheetData(userId);
      
      if (userSheetData && userSheetData.spreadsheetUrl) {
        // User sudah memiliki spreadsheet
        const sheetId = extractSheetIdFromUrl(userSheetData.spreadsheetUrl);
        
        try {
          // Coba load spreadsheet untuk mendapatkan judul
          const doc = new GoogleSpreadsheet(sheetId);
          await doc.useServiceAccountAuth(SERVICE_ACCOUNT_CREDENTIALS);
          await doc.loadInfo();
          
          await ctx.replyWithMarkdown(`👋 Halo *${ctx.from.first_name}*!`);
          await ctx.reply(`Anda sudah memiliki spreadsheet untuk pencatatan keuangan:\n*${doc.title}*`, {
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
          console.error('Error loading existing spreadsheet:', error);
          await ctx.replyWithMarkdown(`👋 Halo *${ctx.from.first_name}*!`);
          await ctx.reply(`Anda sudah memiliki spreadsheet terdaftar, tetapi terjadi masalah saat mengaksesnya. Apakah ingin memperbarui?`, {
            reply_markup: {
              inline_keyboard: [
                [Markup.button.callback('Verifikasi Ulang', 'verify_access')],
                [Markup.button.callback('Ganti Spreadsheet', 'change_spreadsheet')]
              ]
            }
          });
        }
        
        return;
      }
      
      // User belum memiliki spreadsheet
      await ctx.replyWithMarkdown(`👋 Halo *${ctx.from.first_name}*!`);
      await ctx.reply('📊 Silakan bagikan link Google Spreadsheet Anda:');
      await ctx.reply('Contoh format:\nhttps://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit');
    } catch (error) {
      console.error('Error in scene enter:', error);
      await ctx.replyWithMarkdown(`👋 Halo *${ctx.from.first_name}*!`);
      await ctx.reply('📊 Silakan bagikan link Google Spreadsheet Anda:');
      await ctx.reply('Contoh format:\nhttps://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit');
    }
  });

  // Handler untuk input teks
  scene.on('text', async (ctx) => {
    const spreadsheetUrl = ctx.message.text.trim();
    
    if (!validateGoogleSheetUrl(spreadsheetUrl)) {
      return ctx.reply('❌ Format URL tidak valid. Pastikan link berupa Google Sheet!');
    }

    try {
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

// Setup scene dan session
const stage = new Scenes.Stage([createSetupSpreadsheetScene()]);
bot.use(session());
bot.use(stage.middleware());

// Command handlers
bot.command('start', async (ctx) => {
  try {
    // Keluar dari scene aktif apapun
    if (ctx.scene) {
      try {
        await ctx.scene.leave();
      } catch (e) {
        console.log('No active scene to leave');
      }
    }
    
    // Masuk ke scene setup
    return ctx.scene.enter('setup-spreadsheet');
  } catch (error) {
    console.error('Start command error:', error);
    return ctx.reply('❌ Gagal memulai. Silakan coba lagi dengan /start');
  }
});

// Handler untuk ganti spreadsheet
bot.action('change_spreadsheet', async (ctx) => {
  try {
    await ctx.answerCbQuery('Mengubah spreadsheet...');
    await ctx.editMessageText('📊 Silakan bagikan link Google Spreadsheet baru Anda:');
    
    // Masuk ke scene setup
    return ctx.scene.enter('setup-spreadsheet');
  } catch (error) {
    console.error('Change spreadsheet error:', error);
    return ctx.reply('❌ Gagal mengubah spreadsheet. Silakan coba lagi dengan /start');
  }
});

// Handler untuk verifikasi akses
bot.action('verify_access', async (ctx) => {
  try {
    await ctx.answerCbQuery('Memverifikasi...');
    
    const userId = ctx.from.id;
    const userSheetData = await getUserSheetData(userId);
    
    if (!userSheetData || !userSheetData.spreadsheetUrl) {
      return ctx.editMessageText('❌ Data tidak ditemukan. Gunakan /start untuk memulai ulang');
    }

    const sheetId = extractSheetIdFromUrl(userSheetData.spreadsheetUrl);
    if (!sheetId) {
      return ctx.editMessageText('❌ Format URL tidak valid. Gunakan /start untuk memulai ulang');
    }

    const doc = new GoogleSpreadsheet(sheetId);
    await doc.useServiceAccountAuth({
      client_email: SERVICE_ACCOUNT_CREDENTIALS.client_email,
      private_key: SERVICE_ACCOUNT_CREDENTIALS.private_key
    });
    
    await Promise.race([
      doc.loadInfo(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
    ]);

    // Format tanggal dengan benar
    let updateDate = "Tidak tersedia";
    try {
      if (doc.updateTime) {
        const date = new Date(doc.updateTime);
        if (!isNaN(date.getTime())) {
          updateDate = date.toLocaleString('id-ID', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });
        }
      }
    } catch (dateError) {
      console.error('Date formatting error:', dateError);
    }

    // Tambahkan timestamp untuk menghindari error "message is not modified"
    const timestamp = Date.now();
    
    try {
      return await ctx.editMessageText(
        `✅ Verifikasi berhasil!\nJudul: *${doc.title}*\n` +
        `Update terakhir: ${updateDate}`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [Markup.button.url('Buka Spreadsheet', userSheetData.spreadsheetUrl)],
              [Markup.button.callback('Ganti Spreadsheet', 'change_spreadsheet')]
            ]
          }
        }
      );
    } catch (editError) {
      if (editError.description?.includes('message is not modified')) {
        return await ctx.reply(
          `✅ Verifikasi berhasil!\nJudul: *${doc.title}*\n` +
          `Update terakhir: ${updateDate}`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [Markup.button.url('Buka Spreadsheet', userSheetData.spreadsheetUrl)],
                [Markup.button.callback('Ganti Spreadsheet', 'change_spreadsheet')]
              ]
            }
          }
        );
      }
      throw editError;
    }
    
  } catch (error) {
    console.error('Verification error:', error);
    const serviceAccountEmail = SERVICE_ACCOUNT_CREDENTIALS.client_email;
    const userSheetData = await getUserSheetData(ctx.from.id);
    const sheetId = userSheetData ? extractSheetIdFromUrl(userSheetData.spreadsheetUrl) : '';
    
    try {
      return await ctx.editMessageText(
        `❌ Gagal verifikasi. Pastikan:\n` +
        `1. Dibagikan ke: ${serviceAccountEmail}\n` +
        `2. Permission "Editor"\n` +
        `3. Link valid\n` +
        `4. Tunggu 1 menit setelah share`,
        {
          reply_markup: {
            inline_keyboard: [
              [Markup.button.callback('🔄 Coba Lagi', `verify_access`)],
              [Markup.button.url('Buka Spreadsheet', `https://docs.google.com/spreadsheets/d/${sheetId}/edit`)],
              [Markup.button.url('Bagikan Ulang', `https://docs.google.com/spreadsheets/d/${sheetId}/share`)]
            ]
          }
        }
      );
    } catch (editError) {
      if (editError.description?.includes('message is not modified')) {
        return await ctx.reply(
          `❌ Gagal verifikasi. Pastikan:\n` +
          `1. Dibagikan ke: ${serviceAccountEmail}\n` +
          `2. Permission "Editor"\n` +
          `3. Link valid\n` +
          `4. Tunggu 1 menit setelah share`,
          {
            reply_markup: {
              inline_keyboard: [
                [Markup.button.callback('🔄 Coba Lagi', `verify_access`)],
                [Markup.button.url('Buka Spreadsheet', `https://docs.google.com/spreadsheets/d/${sheetId}/edit`)],
                [Markup.button.url('Bagikan Ulang', `https://docs.google.com/spreadsheets/d/${sheetId}/share`)]
              ]
            }
          }
        );
      }
      throw editError;
    }
  }
});

// Helper functions
function validateGoogleSheetUrl(url) {
  return /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+/.test(url);
}

function extractSheetIdFromUrl(url) {
  if (!url) return null;
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

  // Cek apakah user sudah ada
  const existingRows = await sheet.getRows();
  const existingUser = existingRows.find(row => {
    try {
      return (row.get('User ID') === userData.userId.toString() || 
              row._rawData?.[0] === userData.userId.toString());
    } catch (e) {
      return false;
    }
  });

  if (existingUser) {
    // Update data yang sudah ada
    try {
      if (typeof existingUser.set === 'function') {
        existingUser.set('Spreadsheet URL', userData.spreadsheetUrl);
        existingUser.set('Username', userData.username);
        await existingUser.save();
      } else {
        // Fallback jika method set tidak tersedia
        const rowIndex = existingRows.indexOf(existingUser);
        await sheet.loadCells();
        sheet.getCell(rowIndex + 1, 2).value = userData.username;
        sheet.getCell(rowIndex + 1, 3).value = userData.spreadsheetUrl;
        await sheet.saveUpdatedCells();
      }
    } catch (e) {
      console.error('Error updating existing user:', e);
      // Jika gagal update, tambahkan baris baru
      await sheet.addRow({
        'User ID': userData.userId.toString(),
        'Username': userData.username,
        'Spreadsheet URL': userData.spreadsheetUrl,
        'Registered At': userData.registeredAt
      });
    }
  } else {
    // Tambah user baru
    await sheet.addRow({
      'User ID': userData.userId.toString(),
      'Username': userData.username,
      'Spreadsheet URL': userData.spreadsheetUrl,
      'Registered At': userData.registeredAt
    });
  }
}

async function getUserSheetData(userId) {
  try {
    const doc = new GoogleSpreadsheet(MASTER_SHEET_ID);
    await doc.useServiceAccountAuth(SERVICE_ACCOUNT_CREDENTIALS);
    await doc.loadInfo();

    const sheet = doc.sheetsByIndex[0];
    if (!sheet) return null;
    
    // Pastikan header terisi
    if (!sheet.headerValues || sheet.headerValues.length === 0) {
      await sheet.setHeaderRow(['User ID', 'Username', 'Spreadsheet URL', 'Registered At']);
    }

    const rows = await sheet.getRows();
    if (!rows || rows.length === 0) return null;
    
    // Cari dengan error handling dan fallback
    const userRow = rows.find(row => {
      try {
        // Cara 1: Gunakan get() jika tersedia
        if (typeof row.get === 'function') {
          return row.get('User ID') === userId.toString();
        }
        
        // Cara 2: Akses langsung via _rawData (fallback)
        return row._rawData?.[0]?.trim() === userId.toString();
      } catch (e) {
        return false;
      }
    });

    // Akses data dengan cara yang sama dan buat objek lengkap
    if (userRow) {
      try {
        const userData = {
          userId: userId.toString(),
          username: typeof userRow.get === 'function' 
            ? userRow.get('Username') 
            : userRow._rawData?.[1]?.trim(),
          spreadsheetUrl: typeof userRow.get === 'function' 
            ? userRow.get('Spreadsheet URL')
            : userRow._rawData?.[2]?.trim(),
          registeredAt: typeof userRow.get === 'function' 
            ? userRow.get('Registered At')
            : userRow._rawData?.[3]?.trim()
        };
        return userData;
      } catch (e) {
        console.error('Error accessing user data:', e);
        return null;
      }
    }
    
    return null;
  } catch (e) {
    console.error('Error fetching user sheet data:', e);
    return null;
  }
}

// Error handling
bot.catch((err, ctx) => {
  console.error('Global Bot Error:', err);
  if (ctx && ctx.reply) {
    ctx.reply('⚠️ Terjadi kesalahan sistem. Silakan coba lagi.');
  }
});

// Middleware untuk logging setiap request
bot.use((ctx, next) => {
  console.log(`Processing update ${ctx.update.update_id}`);
  return next();
});

// Function untuk memproses webhook updates
async function processBotUpdate(update) {
  try {
    await bot.handleUpdate(update);
    return true;
  } catch (error) {
    console.error('Error processing update:', error);
    return false;
  }
}

// Vercel serverless handler
export default async (req, res) => {
  try {
    console.log(`Received ${req.method} request`);
    
    if (req.method === 'POST') {
      // Handle webhook update
      let update;
      try {
        update = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        console.log('Processing webhook update:', update?.update_id);
      } catch (e) {
        console.error('Error parsing update:', e);
        return res.status(400).json({ error: 'Invalid update format' });
      }
      
      if (!update) {
        return res.status(400).json({ error: 'No update data provided' });
      }
      
      try {
        await processBotUpdate(update);
        return res.status(200).send('OK');
      } catch (e) {
        console.error('Error in bot update:', e);
        return res.status(500).json({ error: 'Bot processing error', details: e.message });
      }
    } else {
      // Handle health check
      return res.status(200).json({ 
        status: 'Bot Finance Active',
        timestamp: new Date().toISOString(),
        version: '1.2.0'
      });
    }
  } catch (err) {
    console.error('Unhandled error in serverless function:', err);
    return res.status(500).json({ 
      error: 'Internal Server Error',
      message: err.message 
    });
  }
};
