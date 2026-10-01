"use strict";

const { google } = require("googleapis");

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

const TABS = {
  config: "Config",
  openBets: "OpenBets",
  history: "History",
};

// oddsC is appended at the end of each row (rather than inserted after oddsB) so that
// existing sheet rows never need their columns shifted — old rows just read as "" for it.
const HEADERS = {
  [TABS.openBets]: ["id", "match", "oddsA", "oddsB", "stake", "profit", "matchTime", "addedAt", "oddsC"],
  [TABS.history]: ["id", "match", "oddsA", "oddsB", "stake", "profit", "matchTime", "settledAt", "balanceAfter", "oddsC"],
};

let sheetsClient = null;

function getAuth() {
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function getSheets() {
  if (sheetsClient) return sheetsClient;
  const auth = getAuth();
  await auth.authorize();
  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

async function ensureSheetsExist() {
  const sheets = await getSheets();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const existing = new Set(meta.data.sheets.map((s) => s.properties.title));

  const toCreate = Object.values(TABS).filter((t) => !existing.has(t));
  if (toCreate.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: toCreate.map((title) => ({ addSheet: { properties: { title } } })),
      },
    });
  }

  if (!existing.has(TABS.config)) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${TABS.config}!A1:B2`,
      valueInputOption: "RAW",
      requestBody: {
        values: [
          ["PasswordHash", ""],
          ["Balance", "0"],
        ],
      },
    });
  }

  for (const tab of [TABS.openBets, TABS.history]) {
    if (!existing.has(tab)) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${tab}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [HEADERS[tab]] },
      });
    } else {
      // tab already existed — make sure the header row has the oddsC column too
      const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${tab}!A1:Z1` });
      const currentHeader = (headerRes.data.values && headerRes.data.values[0]) || [];
      if (!currentHeader.includes("oddsC")) {
        const col = String.fromCharCode(65 + currentHeader.length); // next empty column letter
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `${tab}!${col}1`,
          valueInputOption: "RAW",
          requestBody: { values: [["oddsC"]] },
        });
      }
    }
  }
}

async function readRows(tab) {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${tab}!A2:Z10000`,
  });
  return res.data.values || [];
}

async function writeRows(tab, rows) {
  const sheets = await getSheets();
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${tab}!A2:Z10000`,
  });
  if (rows.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${tab}!A2`,
      valueInputOption: "RAW",
      requestBody: { values: rows },
    });
  }
}

async function appendRows(tab, rows) {
  if (!rows.length) return;
  const sheets = await getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${tab}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });
}

async function getConfig() {
  const rows = await readRows(TABS.config);
  const map = {};
  rows.forEach((r) => {
    if (r[0]) map[r[0]] = r[1] || "";
  });
  return {
    passwordHash: map.PasswordHash || "",
    balance: Number(map.Balance || 0),
  };
}

async function setConfigValue(key, value) {
  const sheets = await getSheets();
  const rows = await readRows(TABS.config);
  const idx = rows.findIndex((r) => r[0] === key);
  if (idx >= 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${TABS.config}!B${idx + 2}`,
      valueInputOption: "RAW",
      requestBody: { values: [[String(value)]] },
    });
  } else {
    await appendRows(TABS.config, [[key, String(value)]]);
  }
}

function rowToOpenBet(r) {
  return {
    id: r[0],
    match: r[1] || "",
    oddsA: r[2] || "",
    oddsB: r[3] || "",
    stake: Number(r[4] || 0),
    profit: Number(r[5] || 0),
    matchTime: r[6] || "",
    addedAt: Number(r[7] || 0),
    oddsC: r[8] || "",
  };
}

function openBetToRow(b) {
  return [b.id, b.match, b.oddsA, b.oddsB, b.stake, b.profit, b.matchTime, b.addedAt, b.oddsC || ""];
}

async function getOpenBets() {
  const rows = await readRows(TABS.openBets);
  return rows.filter((r) => r[0]).map(rowToOpenBet);
}

async function addOpenBet(bet) {
  await appendRows(TABS.openBets, [openBetToRow(bet)]);
}

async function removeOpenBet(id) {
  const bets = await getOpenBets();
  const next = bets.filter((b) => b.id !== id);
  await writeRows(TABS.openBets, next.map(openBetToRow));
  return next;
}

async function getHistory() {
  const rows = await readRows(TABS.history);
  return rows
    .filter((r) => r[0])
    .map((r) => ({
      id: r[0],
      match: r[1] || "",
      oddsA: r[2] || "",
      oddsB: r[3] || "",
      stake: Number(r[4] || 0),
      profit: Number(r[5] || 0),
      matchTime: r[6] || "",
      settledAt: Number(r[7] || 0),
      balanceAfter: Number(r[8] || 0),
      oddsC: r[9] || "",
    }));
}

function historyRow({ id, match, oddsA, oddsB, oddsC, stake, profit, matchTime, settledAt, balanceAfter }) {
  return [id, match, oddsA, oddsB, stake, profit, matchTime, settledAt, balanceAfter, oddsC || ""];
}

// Moves any open bet whose matchTime has passed into History, in matchTime
// order, running the balance forward one bet at a time. Safe to call
// repeatedly (a scheduler tick, or opportunistically on a read).
async function settleDueBets(now) {
  now = now || Date.now();
  const openBets = await getOpenBets();
  const due = openBets
    .filter((b) => b.matchTime && new Date(b.matchTime).getTime() <= now)
    .sort((a, b) => new Date(a.matchTime).getTime() - new Date(b.matchTime).getTime());

  if (!due.length) return { settled: [] };

  const config = await getConfig();
  let balance = config.balance;
  const historyRows = [];
  for (const bet of due) {
    balance += Number(bet.profit) || 0;
    historyRows.push(
      historyRow({
        id: bet.id,
        match: bet.match,
        oddsA: bet.oddsA,
        oddsB: bet.oddsB,
        oddsC: bet.oddsC,
        stake: bet.stake,
        profit: bet.profit,
        matchTime: bet.matchTime,
        settledAt: Date.now(),
        balanceAfter: balance,
      })
    );
  }

  const dueIds = new Set(due.map((b) => b.id));
  const stillOpen = openBets.filter((b) => !dueIds.has(b.id));

  await appendRows(TABS.history, historyRows);
  await writeRows(TABS.openBets, stillOpen.map(openBetToRow));
  await setConfigValue("Balance", balance);

  return { settled: due };
}

// Manually settles one open bet right now, regardless of its matchTime.
async function settleBetNow(id) {
  const openBets = await getOpenBets();
  const bet = openBets.find((b) => b.id === id);
  if (!bet) return null;

  const config = await getConfig();
  const balance = config.balance + (Number(bet.profit) || 0);

  await appendRows(TABS.history, [
    historyRow({
      id: bet.id,
      match: bet.match,
      oddsA: bet.oddsA,
      oddsB: bet.oddsB,
      oddsC: bet.oddsC,
      stake: bet.stake,
      profit: bet.profit,
      matchTime: bet.matchTime,
      settledAt: Date.now(),
      balanceAfter: balance,
    }),
  ]);
  const stillOpen = openBets.filter((b) => b.id !== id);
  await writeRows(TABS.openBets, stillOpen.map(openBetToRow));
  await setConfigValue("Balance", balance);
  return bet;
}

module.exports = {
  ensureSheetsExist,
  getConfig,
  setConfigValue,
  getOpenBets,
  addOpenBet,
  removeOpenBet,
  getHistory,
  settleDueBets,
  settleBetNow,
};
