# 🤖 Blueprint: Bot de WhatsApp con IA para Negocios
### Construido por VíaDirecta — Arquitectura lista para replicar

---

## ¿Qué es esto?

Un bot de WhatsApp completamente autónomo que usa Inteligencia Artificial (Claude de Anthropic) para atender clientes 24/7, sin pagar la API oficial de Meta ni intermediarios como UltraMsg o Twilio.

**Costo mensual: ~$5 USD** (Railway) vs $50-500 USD/mes de alternativas.

---

## Arquitectura (3 piezas)

```
[Cliente WhatsApp]
       ↓ mensaje
[Baileys en Railway]  ←→  [Backend con IA (FastAPI + Claude)]
       ↑ respuesta                    ↓
    [Cliente]              [Base de datos MongoDB]
```

### Pieza 1: Conector WhatsApp (Baileys)
- **Tecnología:** Node.js + librería `@whiskeysockets/baileys`
- **Dónde vive:** Railway (con volumen persistente para la sesión)
- **Repositorio:** GitHub (auto-deploy en cada push)
- **Función:** Recibe mensajes de WhatsApp y los reenvía al backend. Recibe respuestas del backend y las envía al cliente.
- **Costo:** ~$5/mes en Railway

### Pieza 2: Backend con IA
- **Tecnología:** FastAPI (Python) + Claude Haiku/Sonnet
- **Función:** Recibe el mensaje, lo procesa con IA, usa herramientas (buscar productos, hacer reservas, generar pagos) y devuelve la respuesta
- **Herramientas (MCP):** Funciones que la IA puede llamar para tomar acciones reales

### Pieza 3: Base de datos
- **Tecnología:** MongoDB
- **Función:** Guarda historial de conversaciones (memoria del bot) y datos del negocio

---

## Endpoints del conector Baileys

| Método | Ruta | Función |
|--------|------|---------|
| GET | `/` | Página QR o estado de conexión |
| GET | `/version` | Versión desplegada y estado |
| GET | `/messages` | Últimos 20 mensajes recibidos |
| GET | `/debug` | Estado interno completo |
| GET | `/force-reconnect` | Reiniciar conexión WhatsApp |
| POST | `/send` | Enviar mensaje `{ to, message }` |
| POST | `/test-webhook` | Probar conexión con el backend |

---

## Variables de entorno necesarias

```env
PORT=3000                              # Railway lo pone automático
BACKEND_URL=https://tu-backend.com     # URL de tu backend con IA
```

---

## Flujo de un mensaje (paso a paso)

```
1. Cliente escribe "Hola" en WhatsApp
2. Baileys recibe el mensaje (evento messages.upsert)
3. Baileys extrae: número del cliente + texto del mensaje
4. Baileys hace POST a /api/webhooks/baileys con { from, body }
5. Backend recibe el webhook
6. Backend pasa el mensaje a Claude (con historial de la conversación)
7. Claude decide si responder directo o usar una herramienta
8. Si usa herramienta → busca en BD, genera link de pago, reserva, etc.
9. Claude genera la respuesta final
10. Backend hace POST a Baileys /send con { to: from, message: respuesta }
11. Baileys envía la respuesta al cliente en WhatsApp
```

---

## Webhook del Backend (lo que debe implementar el backend)

### Recibir mensaje de Baileys
```
POST /api/webhooks/baileys
Body: {
  "from": "584125551234",     // número sin + ni @
  "body": "Hola, necesito ayuda",
  "type": "chat",
  "timestamp": 1234567890
}
```

### Enviar respuesta a Baileys
```
POST https://[railway-url]/send
Body: {
  "to": "584125551234",       // mismo número del from
  "message": "¡Hola! ¿En qué te puedo ayudar?"
}
```

---

## Herramientas de IA (MCP Tools) - Lo que hace al bot inteligente

Estas son funciones Python que Claude puede llamar para tomar acciones reales:

```python
# Ejemplo de herramienta
async def mcp_buscar_disponibilidad(origen: str, destino: str, fecha: str):
    """Busca disponibilidad de servicios"""
    # Consulta la base de datos
    return resultados

async def mcp_crear_reserva(cliente_id: str, servicio_id: str):
    """Crea una reserva para el cliente"""
    # Inserta en la base de datos
    return confirmacion

async def mcp_generar_link_pago(monto: float, descripcion: str):
    """Genera un link de Stripe para cobrar"""
    # Llama a Stripe API
    return { "url": "https://checkout.stripe.com/..." }
```

---

## Problemas conocidos y soluciones

### ❌ Problema: Bot "sordo" después de un redeploy
**Causa:** WhatsApp envía error 515 (restartRequired) cuando la sesión expira. Si el código no lo maneja, el bot queda en estado "conectado pero sin escuchar".

**Solución aplicada en el código:**
```javascript
if (statusCode === DisconnectReason.restartRequired) {
  sock?.end(undefined)
  setTimeout(startBot, 2000)
  return
}
```

### ❌ Problema: Números desconocidos llegan como @lid
**Causa:** WhatsApp Business recibe mensajes de no-contactos con formato `50564700319946@lid` en vez del número real.

**Solución:** Usar `msg.key.remoteJidAlt` como primera opción. Si está vacío, usar el `@lid` directamente como JID de respuesta (Baileys v6+ lo soporta).

### ❌ Problema: contacts.upsert mapea al número equivocado
**Causa:** El evento `contacts.upsert` se dispara con toda la agenda y puede mapear un @lid al número incorrecto.

**Solución:** Eliminar contacts.upsert. Solo usar `chats.phoneNumberShare` que es preciso.

### ❌ Problema: Railway no despliega el código nuevo
**Causa:** Railway puede perder la conexión con GitHub.

**Solución:** Settings → Source → Connect Repo → seleccionar el repositorio.

---

## Para replicar en otro negocio (checklist)

- [ ] 1. Crear repositorio en GitHub con el código de Baileys
- [ ] 2. Crear proyecto en Railway → "Deploy from GitHub Repo"
- [ ] 3. Añadir volumen persistente en Railway (para mantener sesión QR)
- [ ] 4. Configurar variable `BACKEND_URL` en Railway
- [ ] 5. Abrir URL del servicio y escanear QR con el WhatsApp del negocio
- [ ] 6. En el backend: implementar `POST /api/webhooks/baileys`
- [ ] 7. En el backend: integrar Claude con las herramientas del negocio
- [ ] 8. En el backend: configurar `BAILEYS_URL` para enviar respuestas
- [ ] 9. Probar con un mensaje de WhatsApp
- [ ] 10. Verificar en `/messages` que los mensajes llegan correctamente

---

## Casos de uso por industria

| Negocio | Herramientas IA necesarias |
|---------|---------------------------|
| 🚗 Transporte | Buscar rutas, reservar asiento, cobrar, notificar conductor |
| 🍕 Restaurante | Ver menú, tomar pedido, cobrar, avisar cocina |
| 🏥 Consultorio | Ver disponibilidad, agendar cita, recordatorio, cobrar |
| 🏪 Tienda | Ver catálogo, verificar stock, generar pedido, cobrar |
| 🏨 Hotel | Ver disponibilidad, reservar habitación, cobrar, check-in info |
| 💇 Spa/Belleza | Ver servicios, agendar turno, recordatorio 24h antes |

---

## Tecnologías usadas

- **Baileys** `@whiskeysockets/baileys` — WhatsApp Web Protocol
- **Express.js** — Servidor HTTP para endpoints
- **Axios** — Llamadas HTTP al backend
- **Claude Haiku/Sonnet** — Modelo de IA (Anthropic)
- **FastAPI** — Backend Python
- **MongoDB** — Base de datos + historial conversaciones
- **Railway** — Hosting del conector (con volumen persistente)
- **Stripe** — Pagos (opcional)

---

## Costo estimado por negocio

| Servicio | Costo mensual |
|----------|---------------|
| Railway (Baileys) | ~$5 USD |
| Backend hosting (Railway/Render) | ~$5-10 USD |
| MongoDB Atlas | Gratis hasta 512MB |
| Claude Haiku | ~$0.25 por 1M tokens (~$1-5 según volumen) |
| **Total** | **~$10-20 USD/mes** |

vs. WhatsApp Business API oficial: $50-500 USD/mes

---

*Documentado por VíaDirecta — Junio 2026*
