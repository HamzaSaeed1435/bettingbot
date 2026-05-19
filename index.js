'use strict';

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const tls = require('tls');
require('dotenv').config();

console.log(process.env.ODDS_API_KEY);



// ─── FIX: Turkey SSL interception bypass ─────────────────────────────────────
// EPROTO / "packet length too long" = ISP doing TLS deep packet inspection
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const AGENT = new https.Agent({
  rejectUnauthorized: false,
  minVersion: 'TLSv1',
  maxVersion: 'TLSv1.3',
});

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CONFIG = {
  ODDS_API_KEY:       process.env.ODDS_API_KEY || '',
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID:   process.env.TELEGRAM_CHAT_ID || '',
  TOTAL_BANKROLL:     parseFloat(process.env.BANKROLL      || '1000'),
  BET_PERCENT:        parseFloat(process.env.BET_PERCENT   || '30'),
  MIN_PROFIT_PERCENT: parseFloat(process.env.MIN_PROFIT    || '1'),
  POLL_INTERVAL_MS:   parseInt(process.env.POLL_INTERVAL   || '30000'),
  PORT:               parseInt(process.env.PORT            || '3000'),
  LOG_FILE:           path.join(__dirname, 'arb_log.json'),

  SPORTS: [
    { key: 'cricket_test_match',        name: 'Cricket Test',       hasDraw: true  },
    { key: 'cricket_odi',               name: 'Cricket ODI',        hasDraw: false },
    { key: 'cricket_t20',               name: 'Cricket T20',        hasDraw: false },
    { key: 'soccer_epl',                name: 'EPL Football',       hasDraw: true  },
    { key: 'soccer_uefa_champs_league', name: 'UEFA CL Football',   hasDraw: true  },
    { key: 'soccer_turkey_super_lig',   name: 'Süper Lig Football', hasDraw: true  },
    { key: 'basketball_nba',            name: 'NBA Basketball',     hasDraw: false },
    { key: 'tennis_atp_french_open',    name: 'Tennis ATP',         hasDraw: false },
    { key: 'tennis_wta_french_open',    name: 'Tennis WTA',         hasDraw: false },
  ],
};

// ─── STATE ───────────────────────────────────────────────────────────────────
let sentAlerts = new Set();
let stats = { scanned: 0, arbsFound: 0, alertsSent: 0, errors: 0, lastRun: null };

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function log(level, msg, data) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level}] ${msg}`, data !== undefined ? JSON.stringify(data) : '');
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      agent: AGENT,
      headers: { 'User-Agent': 'ArbitrageBot/2.0' },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 401) return reject(new Error('Invalid API key (401)'));
        if (res.statusCode === 422) return reject(new Error('SPORT_INACTIVE'));
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('JSON parse: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

function httpsPost(hostname, urlPath, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = https.request({
      hostname, path: urlPath, method: 'POST', agent: AGENT,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let resp = '';
      res.on('data', c => resp += c);
      res.on('end', () => resolve(resp));
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('Telegram timeout')); });
    req.write(body);
    req.end();
  });
}

// ─── ODDS API ────────────────────────────────────────────────────────────────

async function fetchOdds(sportKey) {
  const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${CONFIG.ODDS_API_KEY}&regions=eu,uk,us&markets=h2h&oddsFormat=decimal`;
  return await httpsGet(url);
}

// ─── ARBITRAGE CALCULATOR ────────────────────────────────────────────────────

function findBestOdds(game, hasDraw) {
  const best = {};
  for (const bm of (game.bookmakers || [])) {
    for (const market of (bm.markets || [])) {
      if (market.key !== 'h2h') continue;
      for (const outcome of (market.outcomes || [])) {
        const odds = parseFloat(outcome.price);
        if (!best[outcome.name] || odds > best[outcome.name].odds) {
          best[outcome.name] = { odds, bookmaker: bm.title };
        }
      }
    }
  }

  const outcomes = Object.entries(best).map(([name, v]) => ({ name, odds: v.odds, bookmaker: v.bookmaker }));
  const maxOutcomes = hasDraw ? 3 : 2;
  if (outcomes.length < 2 || outcomes.length > maxOutcomes + 1) return null;

  const impliedSum = outcomes.reduce((sum, o) => sum + (1 / o.odds), 0);
  if (impliedSum >= 1) return null;

  const profitPercent = ((1 / impliedSum) - 1) * 100;
  if (profitPercent < CONFIG.MIN_PROFIT_PERCENT) return null;

  const totalBet = CONFIG.TOTAL_BANKROLL * (CONFIG.BET_PERCENT / 100);
  const stakesFinal = outcomes.map(o => ({
    name: o.name, odds: o.odds, bookmaker: o.bookmaker,
    stake: parseFloat(((1 / o.odds / impliedSum) * totalBet).toFixed(2)),
  }));

  return {
    outcomes: stakesFinal,
    impliedSum: parseFloat(impliedSum.toFixed(4)),
    profitPercent: parseFloat(profitPercent.toFixed(2)),
    totalBet: parseFloat(totalBet.toFixed(2)),
    guaranteedProfit: parseFloat((totalBet * (1 / impliedSum - 1)).toFixed(2)),
  };
}

// ─── TELEGRAM ────────────────────────────────────────────────────────────────

async function sendTelegram(message, retry = 2) {
  if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) return;

  try {
    const result = await httpsPost(
      'api.telegram.org',
      `/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: CONFIG.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      }
    );

    let parsed;
    try {
      parsed = JSON.parse(result);
    } catch (e) {
      log('ERROR', 'Telegram invalid JSON', result);
      return;
    }

    if (parsed.ok) {
      log('INFO', 'Telegram ✓');
    } else {
      log('WARN', 'Telegram rejected', parsed);

      if (retry > 0) {
        log('INFO', `Retrying Telegram... (${retry})`);
        await new Promise(r => setTimeout(r, 1000));
        return sendTelegram(message, retry - 1);
      }
    }

  } catch (e) {
    log('ERROR', 'Telegram failed', e.message);

    if (retry > 0) {
      await new Promise(r => setTimeout(r, 1000));
      return sendTelegram(message, retry - 1);
    }
  }
}

function formatAlert(sport, game, arb) {
  const emoji =
    sport.key.includes('cricket') ? '🏏' :
    sport.key.includes('soccer') ? '⚽' :
    sport.key.includes('tennis') ? '🎾' : '🏀';

  // Better LIVE detection
  const startTime = new Date(game.commence_time).getTime();
  const now = Date.now();

  // if match started in last 5 hours = probably live
  const isLive =
    game.in_play === true ||
    (now > startTime && now - startTime < 5 * 60 * 60 * 1000);

  const status = isLive ? '🔴 LIVE' : '🟢 PRE-MATCH';

  // Profit styling
  let profitEmoji = '🟢';
  if (arb.profitPercent >= 5) profitEmoji = '🔥';
  else if (arb.profitPercent >= 3) profitEmoji = '🟢';
  else if (arb.profitPercent >= 1.5) profitEmoji = '🟡';

  // Istanbul date
  const istanbulTime = new Date(game.commence_time).toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

  const lines = [];

  // HEADER
  lines.push(
    `${emoji} <b>${status} ARBITRAGE</b> ${profitEmoji}`,
    ``,
    `🔥 <b>${game.home_team}</b> vs <b>${game.away_team}</b>`,
    `🏆 ${sport.name}`,
    `⏰ ${istanbulTime} (Istanbul)`,
    ``
  );

  // PROFIT SECTION
  lines.push(
    `💰 Profit: <b>+${arb.profitPercent}%</b>`,
    `💵 Stake: <b>$${arb.totalBet}</b>`,
    `✅ Guaranteed: <b>$${arb.guaranteedProfit}</b>`,
    ``
  );

  // SORT OUTCOMES BY ODDS DESC
  const sortedOutcomes = [...arb.outcomes].sort((a, b) => b.odds - a.odds);

  lines.push(`📊 <b>BETS</b>`);

  for (const o of sortedOutcomes) {

    let bookEmoji = '⚪';

    if (o.bookmaker.toLowerCase().includes('bet365'))
      bookEmoji = '🟢';

    if (o.bookmaker.toLowerCase().includes('pinnacle'))
      bookEmoji = '🔵';

    if (o.bookmaker.toLowerCase().includes('stake'))
      bookEmoji = '🟣';

    lines.push(
      `${bookEmoji} <b>${o.name}</b> @ <b>${o.odds}</b>`,
      `└ ${o.bookmaker} • Stake $${o.stake}`
    );
  }

  lines.push(
    ``,
    `⚖️ Implied: ${arb.impliedSum}`
  );

  return lines.join('\n');
}

// ─── LOG FILE ─────────────────────────────────────────────────────────────────

function saveToLog(entry) {
  try {
    let existing = [];
    if (fs.existsSync(CONFIG.LOG_FILE)) existing = JSON.parse(fs.readFileSync(CONFIG.LOG_FILE, 'utf8'));
    existing.unshift({ ...entry, ts: new Date().toISOString() });
    if (existing.length > 500) existing = existing.slice(0, 500);
    fs.writeFileSync(CONFIG.LOG_FILE, JSON.stringify(existing, null, 2));
  } catch (e) { log('ERROR', 'Log write failed', e.message); }
}

// ─── SCAN ────────────────────────────────────────────────────────────────────

async function scanSport(sport) {
  let games;
  try {
    games = await fetchOdds(sport.key);
  } catch (e) {
    if (e.message === 'SPORT_INACTIVE') {
      log('INFO', `${sport.name} — off season, skipping`);
    } else {
      log('WARN', `${sport.name} fetch failed`, e.message);
      stats.errors++;
    }
    return;
  }

  if (!Array.isArray(games) || games.length === 0) {
    log('INFO', `${sport.name} — 0 games`);
    return;
  }

  log('INFO', `${sport.name} — ${games.length} games`);

  const sortedGames = games.sort((a, b) => {
  const arbA = findBestOdds(a, sport.hasDraw);
  const arbB = findBestOdds(b, sport.hasDraw);

  const profitA = arbA ? arbA.profitPercent : 0;
  const profitB = arbB ? arbB.profitPercent : 0;

  return profitB - profitA;
});

for (const game of sortedGames) {
    stats.scanned++;
    const arb = findBestOdds(game, sport.hasDraw);
    if (!arb) continue;
    stats.arbsFound++;

    const dedupKey = `${game.id}_${isLive}_${arb.profitPercent.toFixed(1)}`;
    if (sentAlerts.has(dedupKey)) continue;
    sentAlerts.add(dedupKey);

    log('INFO', `🎯 ARB: ${game.home_team} vs ${game.away_team} +${arb.profitPercent}% = $${arb.guaranteedProfit}`);
    await sendTelegram(formatAlert(sport, game, arb));
    stats.alertsSent++;
    saveToLog({ sport: sport.name, game: `${game.home_team} vs ${game.away_team}`, arb });
  }
}

async function runScan() {
  stats.lastRun = new Date().toISOString();
  log('INFO', `── Scan started ──────────────────────────────────────`);
  if (sentAlerts.size > 2000) sentAlerts = new Set();
  for (const sport of CONFIG.SPORTS) {
    await scanSport(sport);
    await new Promise(r => setTimeout(r, 400));
  }
  log('INFO', `── Done | Scanned:${stats.scanned} Arbs:${stats.arbsFound} Alerts:${stats.alertsSent} Errors:${stats.errors}`);
}

// ─── STATUS SERVER ────────────────────────────────────────────────────────────

function startServer() {
  http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', ...stats }));
    }
    if (req.url === '/log') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      try { return res.end(fs.existsSync(CONFIG.LOG_FILE) ? fs.readFileSync(CONFIG.LOG_FILE) : '[]'); }
      catch { return res.end('[]'); }
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Arb Bot</title>
    <meta http-equiv="refresh" content="15">
    <style>*{box-sizing:border-box}body{font-family:monospace;padding:30px;background:#0d0d0d;color:#ccc}
    h2{color:#fff;margin-bottom:20px}.card{background:#1a1a1a;padding:16px;margin:10px 0;border-radius:8px;border:1px solid #333}
    .g{color:#4cff91}.y{color:#ffd700}.r{color:#ff4444}a{color:#4af}</style></head><body>
    <h2>🤖 Arbitrage Bot</h2>
    <div class="card">Status: <span class="g">● Running</span> &nbsp;|&nbsp; Last scan: ${stats.lastRun || '—'}</div>
    <div class="card">
      Games scanned: <b>${stats.scanned}</b><br>
      Arbs found: <b class="${stats.arbsFound > 0 ? 'y' : ''}">${stats.arbsFound}</b><br>
      Alerts sent: <b>${stats.alertsSent}</b><br>
      Errors: <b class="${stats.errors > 0 ? 'r' : ''}">${stats.errors}</b>
    </div>
    <div class="card">Bankroll: $${CONFIG.TOTAL_BANKROLL} &nbsp;|&nbsp; Bet: ${CONFIG.BET_PERCENT}% = $${CONFIG.TOTAL_BANKROLL * CONFIG.BET_PERCENT / 100} &nbsp;|&nbsp; Min profit: ${CONFIG.MIN_PROFIT_PERCENT}%</div>
    <p><a href="/log">📋 Arb Log</a> &nbsp;|&nbsp; <a href="/health">❤️ Health</a></p>
    </body></html>`);
  }).listen(CONFIG.PORT, () => log('INFO', `Dashboard → http://localhost:${CONFIG.PORT}`));
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  log('INFO', '====================================');
  log('INFO', '  ARB BOT v2 — Turkey SSL Fix');
  log('INFO', '====================================');
  log('INFO', 'SSL verification disabled (ISP bypass)');

  if (!CONFIG.ODDS_API_KEY) {
    log('ERROR', 'ODDS_API_KEY missing! → https://the-odds-api.com');
    process.exit(1);
  }

  log('INFO', `Bankroll $${CONFIG.TOTAL_BANKROLL} | Bet ${CONFIG.BET_PERCENT}% | Min profit ${CONFIG.MIN_PROFIT_PERCENT}% | Poll ${CONFIG.POLL_INTERVAL_MS / 1000}s`);

  startServer();

  // Startup Telegram ping
  await sendTelegram(`🤖 <b>Arb Bot v2 Online</b>\n\n✅ SSL bypass active\nBankroll: $${CONFIG.TOTAL_BANKROLL} | Bet: ${CONFIG.BET_PERCENT}%\nMin profit: ${CONFIG.MIN_PROFIT_PERCENT}% | Poll: ${CONFIG.POLL_INTERVAL_MS / 1000}s\nSports: ${CONFIG.SPORTS.length}\n\nScanning now...`);

  await runScan();

  setInterval(async () => {
    try { await runScan(); }
    catch (e) { log('ERROR', 'Scan loop error', e.message); stats.errors++; }
  }, CONFIG.POLL_INTERVAL_MS);
}

main().catch(e => { log('ERROR', 'Fatal', e.message); process.exit(1); });