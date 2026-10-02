"use strict";

const https = require("https");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Plain https with family: 4 rather than fetch — on hosts without a working IPv6
// route, fetch's address auto-selection times out before it reaches Telegram.
function post(path, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request(
      {
        host: "api.telegram.org",
        path,
        method: "POST",
        family: 4,
        timeout: 15000,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end(body);
  });
}

// Sends a plain-text message to the admin chat. Never throws — callers fire this
// in the background and a Telegram outage must not affect the request itself.
async function notify(text) {
  if (!TOKEN || !CHAT_ID) return false;
  try {
    const res = await post(`/bot${TOKEN}/sendMessage`, { chat_id: CHAT_ID, text, disable_web_page_preview: true });
    if (res.status !== 200) {
      console.error("Telegram notification failed:", res.status, res.body);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Telegram notification failed:", err.message);
    return false;
  }
}

module.exports = { notify };
