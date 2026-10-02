"use strict";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Sends a plain-text message to the admin chat. Never throws — callers fire this
// in the background and a Telegram outage must not affect the request itself.
async function notify(text) {
  if (!TOKEN || !CHAT_ID) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) console.error("Telegram notification failed:", res.status, await res.text());
  } catch (err) {
    console.error("Telegram notification failed:", err.message);
  }
}

module.exports = { notify };
