"use strict";

require("dotenv").config();
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const sheets = require("./sheets");
const odds = require("./odds");

const app = express();
app.set("trust proxy", true);
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const DAY_MS = 24 * 60 * 60 * 1000;
const sessions = new Map(); // token -> expiry

function msUntilNextUtcNoon() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0, 0));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

function scheduleDailySettle() {
  const delay = msUntilNextUtcNoon();
  console.log(`Next automatic settle check at 12:00 UTC (in ${Math.round(delay / 60000)} min)`);
  setTimeout(function runDaily() {
    settleDueBetsSafe();
    setInterval(settleDueBetsSafe, DAY_MS);
  }, delay);
}

function newToken() {
  return crypto.randomBytes(24).toString("hex");
}

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(check, "hex"));
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const expiry = token && sessions.get(token);
  if (!expiry || expiry < Date.now()) {
    return res.status(401).json({ error: "Not authorized" });
  }
  next();
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

let settling = false;
async function settleDueBetsSafe() {
  if (settling) return;
  settling = true;
  try {
    const { settled } = await sheets.settleDueBets();
    if (settled.length) {
      console.log(`Settled ${settled.length} bet(s) whose match time passed:`, settled.map((b) => b.match).join(", "));
    }
  } catch (err) {
    console.error("Auto-settle check failed:", err.message);
  } finally {
    settling = false;
  }
}

async function buildState() {
  const [config, openBets, history] = await Promise.all([
    sheets.getConfig(),
    sheets.getOpenBets(),
    sheets.getHistory(),
  ]);
  return { balance: config.balance, openBets, history };
}

app.get("/api/state", async (req, res) => {
  try {
    res.json(await buildState());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load ledger" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const password = (req.body && req.body.password) || "";
    if (!password) return res.status(400).json({ error: "Password required" });

    const config = await sheets.getConfig();
    let ok;
    if (config.passwordHash) {
      ok = verifyPassword(password, config.passwordHash);
    } else {
      ok = password === (process.env.ADMIN_PASSWORD || "");
    }
    if (!ok) return res.status(401).json({ error: "Wrong password" });

    const token = newToken();
    sessions.set(token, Date.now() + SESSION_TTL_MS);
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

app.post("/api/logout", requireAuth, (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.slice(7);
  sessions.delete(token);
  res.json({ ok: true });
});

app.post("/api/change-password", requireAuth, async (req, res) => {
  try {
    const newPassword = (req.body && req.body.newPassword) || "";
    if (newPassword.length < 4) {
      return res.status(400).json({ error: "Password needs at least 4 characters" });
    }
    await sheets.setConfigValue("PasswordHash", hashPassword(newPassword));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not update password" });
  }
});

app.post("/api/bets", requireAuth, async (req, res) => {
  try {
    const { match, oddsA, oddsB, oddsC, stake, profit, matchTime } = req.body || {};
    if (!match || typeof match !== "string") {
      return res.status(400).json({ error: "Match name required" });
    }
    const profitNum = Number(profit);
    if (Number.isNaN(profitNum)) {
      return res.status(400).json({ error: "Profit must be a number" });
    }
    if (!matchTime || isNaN(new Date(matchTime).getTime())) {
      return res.status(400).json({ error: "Match end date/time required" });
    }
    await sheets.addOpenBet({
      id: uid(),
      match: match.trim(),
      oddsA: (oddsA || "").trim(),
      oddsB: (oddsB || "").trim(),
      oddsC: (oddsC || "").trim(),
      stake: Number(stake) || 0,
      profit: profitNum,
      matchTime: new Date(matchTime).toISOString(),
      addedAt: Date.now(),
    });
    res.json(await buildState());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not add match" });
  }
});

app.delete("/api/bets/:id", requireAuth, async (req, res) => {
  try {
    await sheets.removeOpenBet(req.params.id);
    res.json(await buildState());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not remove match" });
  }
});

app.post("/api/bets/:id/settle", requireAuth, async (req, res) => {
  try {
    const bet = await sheets.settleBetNow(req.params.id);
    if (!bet) return res.status(404).json({ error: "Bet not found" });
    res.json(await buildState());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not settle match" });
  }
});

app.get("/api/odds", async (req, res) => {
  try {
    res.json(await odds.getOdds());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load odds" });
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

sheets
  .ensureSheetsExist()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Arbitrage ledger running on port ${PORT}`);
    });
    settleDueBetsSafe(); // catch up on anything that finished while the server was offline
    scheduleDailySettle();
    odds.getOdds().catch((err) => console.error("Initial odds fetch failed:", err.message));
  })
  .catch((err) => {
    console.error("Failed to initialize Google Sheet:", err.message);
    process.exit(1);
  });
