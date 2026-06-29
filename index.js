const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys')
const express = require('express')
const QRCode = require('qrcode')
const axios = require('axios')
const pino = require('pino')
const path = require('path')

const app = express()
app.use(express.json())

// ── Config ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000
const BACKEND_URL = process.env.BACKEND_URL || 'https://viadirectave.com'
const AUTH_FOLDER = path.join(__dirname, 'auth_info')

// Estado global
let currentQR = null
let isConnected = false
let sock = null

// ── Página QR ─────────────────────────────────────────────────────────────────
app.get('/', async (req, res) => {
  if (isConnected) {
    return res.send(`
      <!DOCTYPE html><html><head><meta charset="utf-8">
      <title>VíaDirecta WhatsApp</title>
      <style>body{font-family:sans-serif;text-align:center;padding:60px;background:#f0fdf4}
      h1{color:#16a34a}p{color:#166534;font-size:18px}</style></head>
      <body><h1>✅ WhatsApp Conectado</h1><p>El bot está funcionando correctamente.</p></body></html>
    `)
  }

  if (!currentQR) {
    return res.send(`
      <!DOCTYPE html><html><head><meta charset="utf-8">
      <meta http-equiv="refresh" content="3">
      <title>VíaDirecta WhatsApp</title>
      <style>body{font-family:sans-serif;text-align:center;padding:60px}</style></head>
      <body><h2>⏳ Iniciando bot...</h2><p>Esta página se actualizará sola.</p></body></html>
    `)
  }

  const qrImage = await QRCode.toDataURL(currentQR)
  res.send(`
    <!DOCTYPE html><html><head><meta charset="utf-8">
    <meta http-equiv="refresh" content="30">
    <title>VíaDirecta - Conectar WhatsApp</title>
    <style>
      body{font-family:sans-serif;text-align:center;padding:40px;background:#fff7ed}
      h1{color:#ea580c}img{border:4px solid #ea580c;border-radius:16px;padding:10px}
      p{color:#9a3412;font-size:16px}
    </style></head>
    <body>
      <h1>📱 Conectar WhatsApp Business</h1>
      <p>Abre WhatsApp → Dispositivos vinculados → Vincular dispositivo → Escanea este QR</p>
      <img src="${qrImage}" width="300" height="300" />
      <p><small>El QR se actualiza automáticamente cada 30 segundos</small></p>
    </body></html>
  `)
})

// ── Endpoint para enviar mensajes (llamado desde el backend de VíaDirecta) ────
app.post('/send', async (req, res) => {
  const { to, message } = req.body
  if (!sock || !isConnected) {
    return res.status(503).json({ error: 'WhatsApp no conectado' })
  }
  try {
    const jid = to.replace('+', '') + '@s.whatsapp.net'
    await sock.sendMessage(jid, { text: message })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Estado ────────────────────────────────────────────────────────────────────
app.get('/status', (req, res) => {
  res.json({ connected: isConnected })
})

// ── Iniciar Baileys ───────────────────────────────────────────────────────────
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER)
  const { version } = await fetchLatestBaileysVersion()

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true,
    browser: ['VíaDirecta Bot', 'Chrome', '1.0.0'],
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      currentQR = qr
      isConnected = false
      console.log('📱 QR listo — abre la URL del servicio en Railway para escanearlo')
    }

    if (connection === 'open') {
      currentQR = null
      isConnected = true
      console.log('✅ WhatsApp conectado exitosamente')
    }

    if (connection === 'close') {
      isConnected = false
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
      console.log('❌ Desconectado. Reconectando:', shouldReconnect)
      if (shouldReconnect) {
        setTimeout(startBot, 5000)
      }
    }
  })

  // ── Recibir mensajes y reenviar al backend de VíaDirecta ───────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    for (const msg of messages) {
      if (msg.key.fromMe) continue

      // Limpiar JID — WhatsApp usa @s.whatsapp.net o @lid según el contacto
      const rawJid = msg.key.remoteJid || ''
      const from = rawJid
        .replace('@s.whatsapp.net', '')
        .replace('@lid', '')
        .replace('@g.us', '')  // ignorar grupos
        .trim()

      // Ignorar mensajes de grupos
      if (rawJid.includes('@g.us')) continue

      const body = msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || msg.message?.imageMessage?.caption
        || ''

      if (!from || !body) continue

      console.log(`📨 Mensaje de ${from}: ${body.substring(0, 50)}`)

      try {
        // Reenviar al backend de VíaDirecta para que lo procese el bot con IA
        await axios.post(`${BACKEND_URL}/api/webhooks/baileys`, {
          from,
          body,
          type: 'chat',
          timestamp: Date.now(),
        }, { timeout: 30000 })
      } catch (e) {
        console.error('Error enviando al backend:', e.message)
      }
    }
  })
}

// ── Arrancar ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`)
  startBot()
})
