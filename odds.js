"use strict";

const fs = require("fs");
const path = require("path");

const CACHE_FILE = path.join(__dirname, "odds-cache.json");
const REFRESH_MS = 24 * 60 * 60 * 1000; // fetch fresh data at most once every 24h
const REGIONS = "us,uk,eu,au"; // 4 regions x 1 market (h2h) = 4 credits per sport queried
const MARKETS = "h2h";
const LOOKAHEAD_MS = 48 * 60 * 60 * 1000; // cover today + tomorrow
const MAX_SPORTS = 8; // caps credit cost at MAX_SPORTS x 4 regions x 1 market per fetch (<=32 credits/day)
const SPORT_PREFIXES = ["soccer_", "tennis_", "basketball_", "baseball_", "cricket_", "americanfootball_", "icehockey_"];

function americanToProb(price) {
  price = Number(price);
  if (price > 0) return 100 / (price + 100);
  return -price / (-price + 100);
}

function simplifyEvent(ev) {
  const bestByOutcome = {}; // name -> { price, book }
  (ev.bookmakers || []).forEach((bm) => {
    const market = (bm.markets || []).find((m) => m.key === "h2h");
    if (!market) return;
    market.outcomes.forEach((o) => {
      const prev = bestByOutcome[o.name];
      // "best" for a bettor is the highest American price (favors the underdog side more, or the least-negative favorite price)
      if (!prev || Number(o.price) > Number(prev.price)) {
        bestByOutcome[o.name] = { price: o.price, book: bm.title };
      }
    });
  });

  const outcomes = Object.keys(bestByOutcome).map((name) => ({
    name,
    price: bestByOutcome[name].price,
    book: bestByOutcome[name].book,
  }));

  let marginPct = null;
  if (outcomes.length >= 2) {
    const sumProb = outcomes.reduce((sum, o) => sum + americanToProb(o.price), 0);
    marginPct = Math.round((sumProb - 1) * 10000) / 100; // negative = arbitrage opportunity
  }

  return {
    id: ev.id,
    sport: ev.sport_title,
    home: ev.home_team,
    away: ev.away_team,
    commenceTime: ev.commence_time,
    outcomes,
    marginPct,
    bookmakerCount: (ev.bookmakers || []).length,
  };
}

async function fetchActiveSports(key) {
  const url = `https://api.the-odds-api.com/v4/sports?apiKey=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`the-odds-api sports list failed: ${res.status}`);
  const list = await res.json();
  return list
    .filter(
      (s) =>
        s.active &&
        SPORT_PREFIXES.some((p) => s.key.startsWith(p)) &&
        !s.key.endsWith("_winner") // outright/futures markets don't support the h2h market
    )
    .map((s) => s.key)
    .slice(0, MAX_SPORTS);
}

async function fetchSportOdds(key, sportKey, fromISO, toISO) {
  const url =
    `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sportKey)}/odds/` +
    `?apiKey=${encodeURIComponent(key)}&regions=${REGIONS}&markets=${MARKETS}&oddsFormat=american` +
    `&commenceTimeFrom=${fromISO}&commenceTimeTo=${toISO}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`the-odds-api odds request failed for ${sportKey}: ${res.status} ${body.slice(0, 150)}`);
  }
  return {
    remaining: res.headers.get("x-requests-remaining"),
    used: res.headers.get("x-requests-used"),
    raw: await res.json(),
  };
}

function isoNoMillis(d) {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function fetchFresh() {
  const key = process.env.ODDS_API_KEY;
  if (!key) throw new Error("ODDS_API_KEY not set");

  const now = new Date();
  const fromISO = isoNoMillis(now);
  const toISO = isoNoMillis(new Date(now.getTime() + LOOKAHEAD_MS));

  const sportKeys = await fetchActiveSports(key);
  if (!sportKeys.length) throw new Error("No active sports returned by the-odds-api");

  const results = await Promise.allSettled(sportKeys.map((sk) => fetchSportOdds(key, sk, fromISO, toISO)));

  let creditsRemaining = null;
  let creditsUsed = null;
  const allRaw = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      allRaw.push(...r.value.raw);
      if (r.value.remaining !== null) creditsRemaining = Number(r.value.remaining);
      if (r.value.used !== null) creditsUsed = Number(r.value.used);
    } else {
      console.error(`Odds fetch failed for sport ${sportKeys[i]}:`, r.reason && r.reason.message);
    }
  });

  const events = allRaw
    .map(simplifyEvent)
    .filter((e) => e.outcomes.length >= 2)
    .sort((a, b) => new Date(a.commenceTime) - new Date(b.commenceTime));

  const payload = {
    fetchedAt: Date.now(),
    creditsRemaining,
    creditsUsed,
    sportsQueried: sportKeys,
    events,
  };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(payload, null, 2));
  return payload;
}

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch (e) {
    return null;
  }
}

async function getOdds() {
  const cached = readCache();
  if (cached && Date.now() - cached.fetchedAt < REFRESH_MS) {
    return cached;
  }
  try {
    return await fetchFresh();
  } catch (err) {
    console.error("Odds fetch failed:", err.message);
    // Serve stale cache rather than nothing if the API call fails
    if (cached) return cached;
    return { fetchedAt: null, creditsRemaining: null, creditsUsed: null, events: [], error: err.message };
  }
}

module.exports = { getOdds };
