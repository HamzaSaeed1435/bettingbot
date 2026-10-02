"use strict";

require("dotenv").config();
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const sheets = require("./sheets");
const odds = require("./odds");
const telegram = require("./telegram");

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

const WITHDRAWAL_STATUSES = ["processing", "processed", "cancelled"];
const MAX_PENDING_WITHDRAWALS = 20;

function maskTail(value) {
  const s = String(value || "");
  return s.length <= 4 ? s : "•••• " + s.slice(-4);
}

// Partner page is public, so it only ever gets the amount, status and the last
// digits of the account — full bank details stay behind the admin login.
function publicWithdrawal(w) {
  return {
    id: w.id,
    amount: w.amount,
    bankName: w.bankName,
    accountTail: maskTail(w.accountNumber),
    status: w.status,
    requestedAt: w.requestedAt,
    updatedAt: w.updatedAt,
  };
}

function clean(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

// What can be withdrawn right now: the balance minus stakes tied up in open bets
// and minus requests that are already waiting to be paid out.
async function withdrawalSnapshot() {
  const [config, openBets, all] = await Promise.all([sheets.getConfig(), sheets.getOpenBets(), sheets.getWithdrawals()]);
  const inOpenBets = openBets.reduce((sum, b) => sum + (Number(b.stake) || 0), 0);
  const pending = all.filter((w) => w.status === "processing");
  const pendingTotal = pending.reduce((sum, w) => sum + w.amount, 0);
  const available = Math.max(0, Math.round((config.balance - inOpenBets - pendingTotal) * 100) / 100);
  return { all, pending, available };
}

app.get("/api/withdrawals", async (req, res) => {
  try {
    const { all, available } = await withdrawalSnapshot();
    res.json({ withdrawals: all.map(publicWithdrawal), available });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load withdrawals" });
  }
});

app.post("/api/withdrawals", async (req, res) => {
  try {
    const body = req.body || {};
    const amount = Math.round(Number(body.amount) * 100) / 100;
    const accountName = clean(body.accountName, 100);
    const bankName = clean(body.bankName, 100);
    const bsb = clean(body.bsb, 10).replace(/[\s-]/g, "");
    const accountNumber = clean(body.accountNumber, 20).replace(/[\s-]/g, "");
    const swift = clean(body.swift, 11).toUpperCase();
    const iban = clean(body.iban, 40).replace(/\s/g, "").toUpperCase();
    const note = clean(body.note, 200);

    if (!(amount > 0)) return res.status(400).json({ error: "Enter a withdrawal amount" });
    if (!accountName) return res.status(400).json({ error: "Account holder name required" });
    if (!bankName) return res.status(400).json({ error: "Bank name required" });
    if (!/^\d{6}$/.test(bsb)) return res.status(400).json({ error: "BSB must be 6 digits" });
    if (!/^\d{5,10}$/.test(accountNumber)) return res.status(400).json({ error: "Account number must be 5 to 10 digits" });
    if (!/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(swift)) {
      return res.status(400).json({ error: "SWIFT/BIC must be 8 or 11 characters" });
    }
    if (iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) {
      return res.status(400).json({ error: "IBAN doesn't look valid" });
    }

    const { pending, available } = await withdrawalSnapshot();
    if (pending.length >= MAX_PENDING_WITHDRAWALS) {
      return res.status(429).json({ error: "Too many requests are already waiting — try again later" });
    }
    if (amount > available) {
      return res.status(400).json({ error: "Amount is more than the available balance" });
    }

    const now = Date.now();
    await sheets.addWithdrawal({
      id: uid(),
      amount,
      accountName,
      bankName,
      bsb,
      accountNumber,
      swift,
      iban,
      note,
      status: "processing",
      requestedAt: now,
      updatedAt: now,
    });
    // not awaited — the notification goes out in the background
    telegram.notify(
      "New withdrawal request\n" +
        `Amount: $${amount.toFixed(2)}\n` +
        `Name: ${accountName}\n` +
        `Bank: ${bankName}\n` +
        `Account: ${maskTail(accountNumber)}\n` +
        (note ? `Note: ${note}\n` : "") +
        "Status: Processing"
    );

    const next = await withdrawalSnapshot();
    res.json({ withdrawals: next.all.map(publicWithdrawal), available: next.available });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not submit withdrawal request" });
  }
});

app.get("/api/admin/withdrawals", requireAuth, async (req, res) => {
  try {
    res.json({ withdrawals: await sheets.getWithdrawals() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load withdrawals" });
  }
});

app.post("/api/admin/withdrawals/:id/status", requireAuth, async (req, res) => {
  try {
    const status = (req.body && req.body.status) || "";
    if (!WITHDRAWAL_STATUSES.includes(status)) {
      return res.status(400).json({ error: "Unknown status" });
    }
    const w = await sheets.setWithdrawalStatus(req.params.id, status);
    if (!w) return res.status(404).json({ error: "Withdrawal not found" });
    const [withdrawals, state] = await Promise.all([sheets.getWithdrawals(), buildState()]);
    res.json({ withdrawals, state });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not update withdrawal" });
  }
});

app.delete("/api/admin/withdrawals/:id", requireAuth, async (req, res) => {
  try {
    const removed = await sheets.removeWithdrawal(req.params.id);
    if (!removed) return res.status(404).json({ error: "Withdrawal not found" });
    res.json({ withdrawals: await sheets.getWithdrawals() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not delete withdrawal" });
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
