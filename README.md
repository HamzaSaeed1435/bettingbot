# 🤖 Sports Arbitrage Bot

Scans odds from 30+ bookmakers across 9 sport categories, finds arbitrage opportunities, and **sends instant Telegram alerts** with exact stake amounts.

Works from Turkey or anywhere — uses The Odds API (no exchange access needed).

---

## ⚡ Quick Start (3 steps)

### Step 1 — Get your API keys

**The Odds API (free):**
1. Go to https://the-odds-api.com
2. Sign up → copy your API key
3. Free tier: 500 requests/month (enough for ~16 scans/day)

**Telegram Bot:**
1. Open Telegram → search `@BotFather` → send `/newbot`
2. Choose a name → copy the token it gives you
3. Search `@userinfobot` → it replies with your Chat ID

---

### Step 2 — Configure

```bash
cp .env.example .env
```

Open `.env` and fill in:
```
ODDS_API_KEY=your_key_here
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
BANKROLL=1000
BET_PERCENT=30
MIN_PROFIT=1
```

---

### Step 3 — Run

```bash
node index.js
```

That's it. No `npm install` needed — uses only Node.js built-ins.

---

## 📱 What you get on Telegram

```
🏏 ARBITRAGE FOUND!

Sport: Cricket T20
Match: India vs Australia
Start: 20.05.2026 14:30:00 (Istanbul)

💰 Profit: +2.4%
Total Stake: $300 (30% of bankroll)
Guaranteed Profit: $7.20

📋 Bets to Place:
  • India @ 2.10 on Bet365 → Stake: $154.50
  • Australia @ 2.20 on Pinnacle → Stake: $145.50

Implied Sum: 0.9765 (edge: 2.35%)
⏰ 2026-05-20T11:30:00.000Z
```

---

## 🌐 Status Dashboard

Visit `http://localhost:3000` in your browser to see:
- Live scan stats
- Last scan time
- Arbs found / alerts sent
- Full log at `/log`

---

## 🚀 Deploy (optional)

**Railway / Render / Fly.io (free hosting):**

1. Push code to GitHub
2. Connect repo on Railway.app or Render.com
3. Set environment variables in their dashboard
4. Deploy — it runs 24/7

**VPS / Server:**
```bash
# Install PM2 to keep it running forever
npm install -g pm2
pm2 start index.js --name arb-bot
pm2 save
pm2 startup
```

---

## ⚙️ Configuration

| Variable | Default | Description |
|---|---|---|
| `ODDS_API_KEY` | required | Your Odds API key |
| `TELEGRAM_BOT_TOKEN` | required | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | required | Your chat/user ID |
| `BANKROLL` | 1000 | Total money you have |
| `BET_PERCENT` | 30 | % to use per arb (e.g. 30 = $300 of $1000) |
| `MIN_PROFIT` | 1 | Min % profit to alert (raise to 2 to reduce noise) |
| `POLL_INTERVAL` | 30000 | Scan every N milliseconds |
| `PORT` | 3000 | Status server port |

---

## 🏟️ Sports Monitored

| Sport | Draw? |
|---|---|
| Cricket Test Match | ✅ Yes (draw possible) |
| Cricket ODI | ❌ No |
| Cricket T20 | ❌ No |
| EPL Football | ✅ Yes |
| UEFA Champions League | ✅ Yes |
| Süper Lig (Turkey) | ✅ Yes |
| NBA Basketball | ❌ No |
| Tennis ATP | ❌ No |
| Tennis WTA | ❌ No |

Add more sports by editing the `SPORTS` array in `index.js`. Find sport keys at:
https://api.the-odds-api.com/v4/sports/?apiKey=YOUR_KEY

---

## 💡 How arbitrage works

If bookmaker A offers Team 1 @ 2.10 and bookmaker B offers Team 2 @ 2.20:
- Implied probabilities: 1/2.10 + 1/2.20 = 0.476 + 0.455 = **0.931**
- Since 0.931 < 1.0, arbitrage exists
- Profit = (1/0.931 - 1) × 100 = **7.4% guaranteed profit**
- Bet proportionally on each side so you win regardless of outcome

---

## ⚠️ Notes

- Odds change fast — act quickly when you get an alert
- Some bookmakers limit or ban arb bettors; use multiple accounts
- Minimum profit of 1–2% is realistic; be skeptical of anything above 5%
- Always verify odds on the bookmaker site before placing
