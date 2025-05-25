const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, delay, Browsers } = require('@whiskeysockets/baileys');

const upload = multer({ dest: '/tmp' });
const app = express();

function removeDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

app.post('/generate', upload.single('photo'), async (req, res) => {
  const numberRaw = req.body.number || '';
  const number = numberRaw.replace(/[^0-9]/g, '');
  if (!number) return res.status(400).json({ error: 'Invalid number' });
  if (!req.file) return res.status(400).json({ error: 'Photo is required' });

  const photoPath = req.file.path;
  const id = Math.random().toString(36).slice(2);
  const authPath = `/tmp/${id}`;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    let sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
      },
      browser: Browsers.macOS('Safari'),
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
      if (connection === 'open') {
        try {
          const jid = sock.user.id;
          // Update profile picture from uploaded file
          await sock.updateProfilePicture(jid, {
            url: fs.readFileSync(photoPath)
          });
          console.log(`✅ DP updated for ${jid}`);
        } catch (e) {
          console.log('DP update error:', e.message);
        }

        await delay(3000);
        await sock.ws.close();
        removeDir(authPath);
        fs.unlinkSync(photoPath);
      }
      else if (connection === 'close' && lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode !== 401) {
        // Reconnect logic if needed
      }
    });

    const code = await sock.requestPairingCode(number);
    return res.json({ code });

  } catch (e) {
    console.error(e);
    removeDir(authPath);
    if (fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = app;
