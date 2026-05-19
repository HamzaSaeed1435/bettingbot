'use strict';

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ─────────────────────────────────────────────────────────────
// TURKEY SSL FIX
// ─────────────────────────────────────────────────────────────
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const AGENT = new https.Agent({
  rejectUnauthorized: false,
  minVersion: 'TLSv1',
  maxVersion: 'TLSv1.3',
});

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────
const CONFIG = {
  ODDS_API_KEY: process.env.ODDS_API_KEY || '',
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',

  TOTAL_BANKROLL: parseFloat(process.env.BANKROLL || '1000'),
  BET_PERCENT: parseFloat(process.env.BET_PERCENT || '30'),
  MIN_PROFIT_PERCENT: parseFloat(process.env.MIN_PROFIT || '1'),

  POLL_INTERVAL_MS: parseInt(
    process.env.POLL_INTERVAL || '30000'
  ),

  PORT: parseInt(process.env.PORT || '3000'),

  LOG_FILE: path.join(__dirname, 'arb_log.json'),

  SPORTS: [
    {
      key: 'soccer_epl',
      name: 'EPL Football',
      hasDraw: true,
    },
    {
      key: 'soccer_uefa_champs_league',
      name: 'UEFA Champions League',
      hasDraw: true,
    },
    {
      key: 'soccer_turkey_super_lig',
      name: 'Turkey Super Lig',
      hasDraw: true,
    },
    {
      key: 'basketball_nba',
      name: 'NBA Basketball',
      hasDraw: false,
    },
    {
      key: 'tennis_atp_french_open',
      name: 'Tennis ATP',
      hasDraw: false,
    },
    {
      key: 'tennis_wta_french_open',
      name: 'Tennis WTA',
      hasDraw: false,
    },
  ],
};

// ─────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────
let sentAlerts = new Set();

let stats = {
  scanned: 0,
  arbsFound: 0,
  alertsSent: 0,
  errors: 0,
  lastRun: null,
};

// ─────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────
function log(level, msg, data) {
  const ts = new Date().toISOString();

  console.log(
    `[${ts}] [${level}] ${msg}`,
    data ? JSON.stringify(data) : ''
  );
}

// ─────────────────────────────────────────────────────────────
// HTTPS GET
// ─────────────────────────────────────────────────────────────
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);

    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      agent: AGENT,
      headers: {
        'User-Agent': 'ArbitrageBot/3.0',
      },
    };

    const req = https.request(options, (res) => {
      let body = '';

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 401) {
          return reject(
            new Error('Invalid API key')
          );
        }

        if (res.statusCode !== 200) {
          return reject(
            new Error(
              `HTTP ${res.statusCode}: ${body.slice(0, 200)}`
            )
          );
        }

        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(
            new Error('JSON Parse Error')
          );
        }
      });
    });

    req.on('error', reject);

    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });

    req.end();
  });
}

// ─────────────────────────────────────────────────────────────
// HTTPS POST
// ─────────────────────────────────────────────────────────────
function httpsPost(hostname, pathUrl, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);

    const req = https.request(
      {
        hostname,
        path: pathUrl,
        method: 'POST',
        agent: AGENT,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let response = '';

        res.on('data', (chunk) => {
          response += chunk;
        });

        res.on('end', () => {
          resolve(response);
        });
      }
    );

    req.on('error', reject);

    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Telegram timeout'));
    });

    req.write(body);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────
// FETCH ODDS
// ─────────────────────────────────────────────────────────────
async function fetchOdds(sportKey) {
  const url =
    `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/` +
    `?apiKey=${CONFIG.ODDS_API_KEY}` +
    `&regions=eu,uk,us` +
    `&markets=h2h` +
    `&oddsFormat=decimal`;

  return await httpsGet(url);
}

// ─────────────────────────────────────────────────────────────
// FIND BEST ODDS
// ─────────────────────────────────────────────────────────────
function findBestOdds(game, hasDraw) {
  const best = {};

  for (const bookmaker of game.bookmakers || []) {
    for (const market of bookmaker.markets || []) {
      if (market.key !== 'h2h') continue;

      for (const outcome of market.outcomes || []) {
        const odds = parseFloat(outcome.price);

        if (
          !best[outcome.name] ||
          odds > best[outcome.name].odds
        ) {
          best[outcome.name] = {
            odds,
            bookmaker: bookmaker.title,
          };
        }
      }
    }
  }

  const outcomes = Object.entries(best).map(
    ([name, data]) => ({
      name,
      odds: data.odds,
      bookmaker: data.bookmaker,
    })
  );

  if (outcomes.length < 2) return null;

  const impliedSum = outcomes.reduce(
    (sum, o) => sum + 1 / o.odds,
    0
  );

  if (impliedSum >= 1) return null;

  const profitPercent =
    ((1 / impliedSum) - 1) * 100;

  if (
    profitPercent <
    CONFIG.MIN_PROFIT_PERCENT
  ) {
    return null;
  }

  const totalBet =
    CONFIG.TOTAL_BANKROLL *
    (CONFIG.BET_PERCENT / 100);

  const stakes = outcomes.map((o) => ({
    ...o,
    stake: parseFloat(
      (
        ((1 / o.odds) / impliedSum) *
        totalBet
      ).toFixed(2)
    ),
  }));

  return {
    outcomes: stakes,
    impliedSum: parseFloat(
      impliedSum.toFixed(4)
    ),
    profitPercent: parseFloat(
      profitPercent.toFixed(2)
    ),
    totalBet: parseFloat(
      totalBet.toFixed(2)
    ),
    guaranteedProfit: parseFloat(
      (
        totalBet *
        ((1 / impliedSum) - 1)
      ).toFixed(2)
    ),
  };
}

// ─────────────────────────────────────────────────────────────
// TELEGRAM
// ─────────────────────────────────────────────────────────────
async function sendTelegram(message) {
  if (
    !CONFIG.TELEGRAM_BOT_TOKEN ||
    !CONFIG.TELEGRAM_CHAT_ID
  ) {
    return;
  }

  try {
    const response = await httpsPost(
      'api.telegram.org',
      `/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: CONFIG.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }
    );

    const parsed = JSON.parse(response);

    if (!parsed.ok) {
      log(
        'WARN',
        'Telegram rejected',
        parsed
      );
    }
  } catch (e) {
    log(
      'ERROR',
      'Telegram error',
      e.message
    );
  }
}

// ─────────────────────────────────────────────────────────────
// FORMAT ALERT
// ─────────────────────────────────────────────────────────────
function formatAlert(sport, game, arb) {
  const emoji =
    sport.key.includes('soccer')
      ? '⚽'
      : sport.key.includes('tennis')
      ? '🎾'
      : '🏀';

  const lines = [
    `${emoji} <b>LIVE ARBITRAGE ALERT</b>`,
    ``,
    `🏆 <b>Sport:</b> ${sport.name}`,
    `🔥 <b>Match:</b> ${game.home_team} vs ${game.away_team}`,
    ``,
    `💰 <b>Profit:</b> +${arb.profitPercent}%`,
    `💵 <b>Total Stake:</b> $${arb.totalBet}`,
    `📈 <b>Guaranteed Profit:</b> $${arb.guaranteedProfit}`,
    ``,
    `📊 <b>BETS</b>`,
  ];

  for (const o of arb.outcomes) {
    lines.push(
      `• <b>${o.name}</b> @ ${o.odds}`,
      `  └ ${o.bookmaker} → $${o.stake}`
    );
  }

  lines.push('');
  lines.push(
    `🕐 ${new Date().toLocaleString(
      'tr-TR',
      {
        timeZone: 'Europe/Istanbul',
      }
    )}`
  );

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// LOG FILE
// ─────────────────────────────────────────────────────────────
function saveToLog(entry) {
  try {
    let logs = [];

    if (
      fs.existsSync(CONFIG.LOG_FILE)
    ) {
      logs = JSON.parse(
        fs.readFileSync(
          CONFIG.LOG_FILE,
          'utf8'
        )
      );
    }

    logs.unshift({
      ...entry,
      ts: new Date().toISOString(),
    });

    if (logs.length > 500) {
      logs = logs.slice(0, 500);
    }

    fs.writeFileSync(
      CONFIG.LOG_FILE,
      JSON.stringify(logs, null, 2)
    );
  } catch (e) {
    log(
      'ERROR',
      'Log save failed',
      e.message
    );
  }
}

// ─────────────────────────────────────────────────────────────
// SCAN SPORT
// ─────────────────────────────────────────────────────────────
async function scanSport(sport) {
  let games = [];

  try {
    games = await fetchOdds(
      sport.key
    );
  } catch (e) {
    log(
      'WARN',
      `${sport.name} fetch failed`,
      e.message
    );

    stats.errors++;
    return;
  }

  if (!Array.isArray(games)) {
    return;
  }

  // ONLY LIVE MATCHES
  const liveGames = games.filter(
    (g) => {
      return (
        g.completed !== true &&
        (
          g.in_play === true ||
          g.live === true ||
          g.status === 'live'
        )
      );
    }
  );

  if (liveGames.length === 0) {
    log(
      'INFO',
      `${sport.name} no live games`
    );

    return;
  }

  let alerts = [];

  for (const game of liveGames) {
    stats.scanned++;

    const arb = findBestOdds(
      game,
      sport.hasDraw
    );

    if (!arb) continue;

    stats.arbsFound++;

    // STRONG DUPLICATE PROTECTION
    const dedupKey =
      `${game.id}_` +
      arb.outcomes
        .map(
          (o) =>
            `${o.name}_${o.odds}`
        )
        .join('|');

    if (
      sentAlerts.has(dedupKey)
    ) {
      continue;
    }

    sentAlerts.add(dedupKey);

    alerts.push({
      sport,
      game,
      arb,
    });
  }

  // SORT LOW → HIGH
  alerts.sort(
    (a, b) =>
      a.arb.profitPercent -
      b.arb.profitPercent
  );

  // SEND
  for (const item of alerts) {
    const {
      sport,
      game,
      arb,
    } = item;

    log(
      'INFO',
      `LIVE ARB ${game.home_team} vs ${game.away_team} +${arb.profitPercent}%`
    );

    await sendTelegram(
      formatAlert(
        sport,
        game,
        arb
      )
    );

    stats.alertsSent++;

    saveToLog({
      sport: sport.name,
      game: `${game.home_team} vs ${game.away_team}`,
      arb,
    });

    // TELEGRAM ANTI SPAM
    await new Promise((r) =>
      setTimeout(r, 1500)
    );
  }
}

// ─────────────────────────────────────────────────────────────
// RUN SCAN
// ─────────────────────────────────────────────────────────────
async function runScan() {
  stats.lastRun =
    new Date().toISOString();

  log(
    'INFO',
    '──────── SCAN START ────────'
  );

  if (
    sentAlerts.size > 5000
  ) {
    sentAlerts = new Set();
  }

  for (const sport of CONFIG.SPORTS) {
    await scanSport(sport);

    await new Promise((r) =>
      setTimeout(r, 500)
    );
  }

  log(
    'INFO',
    `DONE | Scanned:${stats.scanned} Arbs:${stats.arbsFound} Alerts:${stats.alertsSent}`
  );
}

// ─────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────
function startServer() {
  http
    .createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, {
          'Content-Type':
            'application/json',
        });

        return res.end(
          JSON.stringify({
            status: 'ok',
            ...stats,
          })
        );
      }

      if (req.url === '/log') {
        res.writeHead(200, {
          'Content-Type':
            'application/json',
        });

        try {
          return res.end(
            fs.existsSync(
              CONFIG.LOG_FILE
            )
              ? fs.readFileSync(
                  CONFIG.LOG_FILE
                )
              : '[]'
          );
        } catch {
          return res.end('[]');
        }
      }

      res.writeHead(200, {
        'Content-Type':
          'text/html',
      });

      res.end(`
      <html>
      <head>
      <title>ARB BOT</title>
      <meta http-equiv="refresh" content="15">
      <style>
      body{
        background:#111;
        color:#eee;
        font-family:Arial;
        padding:30px;
      }

      .box{
        background:#1b1b1b;
        padding:20px;
        margin-bottom:15px;
        border-radius:10px;
      }

      h1{
        color:#00ff88;
      }
      </style>
      </head>

      <body>

      <h1>🤖 LIVE ARBITRAGE BOT</h1>

      <div class="box">
      Scanned: ${stats.scanned}<br>
      Arbs: ${stats.arbsFound}<br>
      Alerts: ${stats.alertsSent}<br>
      Errors: ${stats.errors}
      </div>

      <div class="box">
      Bankroll: $${CONFIG.TOTAL_BANKROLL}<br>
      Bet %: ${CONFIG.BET_PERCENT}%<br>
      Min Profit: ${CONFIG.MIN_PROFIT_PERCENT}%
      </div>

      <div class="box">
      Last Scan: ${
        stats.lastRun || '-'
      }
      </div>

      </body>
      </html>
      `);
    })
    .listen(CONFIG.PORT, () => {
      log(
        'INFO',
        `Dashboard running on ${CONFIG.PORT}`
      );
    });
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────
async function main() {
  log(
    'INFO',
    'ARB BOT STARTED'
  );

  if (
    !CONFIG.ODDS_API_KEY
  ) {
    log(
      'ERROR',
      'Missing ODDS_API_KEY'
    );

    process.exit(1);
  }

  startServer();

  await sendTelegram(
    `🤖 <b>LIVE ARB BOT ONLINE</b>\n\n` +
    `Bankroll: $${CONFIG.TOTAL_BANKROLL}\n` +
    `Bet: ${CONFIG.BET_PERCENT}%\n` +
    `Min Profit: ${CONFIG.MIN_PROFIT_PERCENT}%\n\n` +
    `Only LIVE matches enabled`
  );

  await runScan();

  setInterval(async () => {
    try {
      await runScan();
    } catch (e) {
      log(
        'ERROR',
        'Scan failed',
        e.message
      );

      stats.errors++;
    }
  }, CONFIG.POLL_INTERVAL_MS);
}

main().catch((e) => {
  log(
    'ERROR',
    'Fatal',
    e.message
  );

  process.exit(1);
});