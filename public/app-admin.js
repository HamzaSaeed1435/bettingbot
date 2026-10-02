"use strict";

const TOKEN_KEY = "arb_ledger_admin_token";
let currentState = { balance: 0, openBets: [], history: [] };
let pollTimer = null;

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}
function setToken(t) {
  sessionStorage.setItem(TOKEN_KEY, t);
}
function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

async function authedFetch(url, options) {
  options = options || {};
  options.headers = Object.assign({}, options.headers, { Authorization: "Bearer " + getToken() });
  const res = await fetch(url, options);
  if (res.status === 401) {
    clearToken();
    showLogin("Session expired — please sign in again.");
    throw new Error("unauthorized");
  }
  return res;
}

function showLogin(err) {
  document.getElementById("loginView").style.display = "block";
  document.getElementById("adminView").style.display = "none";
  document.getElementById("loginError").textContent = err || "";
  if (pollTimer) clearInterval(pollTimer);
  setTimeout(() => document.getElementById("loginPwd").focus(), 30);
}

function showAdmin() {
  document.getElementById("loginView").style.display = "none";
  document.getElementById("adminView").style.display = "block";
  startUtcClock();
  startCountdownTicker();
  refresh();
  refreshWithdrawals();
  pollTimer = setInterval(() => { refresh(); refreshWithdrawals(); }, 30000);
}

async function refresh() {
  try {
    const res = await authedFetch("/api/state");
    if (!res.ok) return;
    currentState = await res.json();
    flashBalanceIfChanged(currentState.balance);
    renderAll(currentState, { onRemove: removeBet, onSettle: settleNow });
    markSynced();
  } catch (e) {
    /* handled in authedFetch */
  }
}

async function login() {
  const password = document.getElementById("loginPwd").value;
  if (!password) return;
  const btn = document.getElementById("loginBtn");
  btn.disabled = true;
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!res.ok) {
      document.getElementById("loginError").textContent = data.error || "Login failed";
      return;
    }
    setToken(data.token);
    document.getElementById("loginPwd").value = "";
    showAdmin();
  } catch (e) {
    document.getElementById("loginError").textContent = "Could not reach the server";
  } finally {
    btn.disabled = false;
  }
}

document.getElementById("loginBtn").onclick = login;
document.getElementById("loginPwd").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); login(); }
});

document.getElementById("logoutBtn").onclick = async () => {
  try { await authedFetch("/api/logout", { method: "POST" }); } catch (e) {}
  clearToken();
  showLogin();
};

function extractDecimalOdds(str) {
  if (!str) return null;
  const atMatch = str.match(/@\s*([\d]+(?:\.[\d]+)?)/);
  if (atMatch) return parseFloat(atMatch[1]);
  const anyMatch = str.match(/([\d]+(?:\.[\d]+)?)/);
  return anyMatch ? parseFloat(anyMatch[1]) : null;
}

function setOddsFieldValue(fieldEl, decimalValue) {
  const current = fieldEl.value || "";
  const atIdx = current.indexOf("@");
  const bookPart = (atIdx >= 0 ? current.slice(0, atIdx) : current).trim();
  const looksLikeBookName = bookPart && !/^[\d.]+$/.test(bookPart);
  fieldEl.value = looksLikeBookName ? bookPart + " @ " + decimalValue.toFixed(2) : decimalValue.toFixed(2);
}

function setHint(id, text, color) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  if (color) el.style.color = color;
}

let profitManuallyEdited = false;

// Bookmaker C is optional — active only once the admin puts something in it.
// Everything below works generically across 2-way or 3-way markets.
function activeOddsFields() {
  const fields = [document.getElementById("fOddsA"), document.getElementById("fOddsB")];
  const c = document.getElementById("fOddsC");
  if (c.value.trim() !== "") fields.push(c);
  return fields;
}

function forwardCalcProfit() {
  const stake = parseFloat(document.getElementById("fStake").value);
  const fields = activeOddsFields();
  const odds = fields.map((el) => extractDecimalOdds(el.value));
  const allKnown = odds.every((o) => o > 1);

  if (!(stake > 0) || !allKnown) {
    setHint("calcHint", "");
    return false;
  }

  const impliedSum = odds.reduce((sum, o) => sum + 1 / o, 0);
  const profit = (stake * (1 - impliedSum)) / impliedSum;

  if (!profitManuallyEdited) {
    document.getElementById("fProfit").value = profit.toFixed(2);
  }
  setHint(
    "calcHint",
    impliedSum < 1
      ? "Profit auto-calculated from stake & odds — a real arbitrage edge"
      : "Profit auto-calculated — these odds don't clear 100% implied probability, so this isn't a guaranteed arb",
    impliedSum < 1 ? "var(--profit)" : "var(--loss)"
  );
  return true;
}

function reverseCalcOdds() {
  const stake = parseFloat(document.getElementById("fStake").value);
  const profit = parseFloat(document.getElementById("fProfit").value);

  if (!(stake > 0) || isNaN(profit)) { setHint("calcHint", ""); return; }
  if (stake + profit <= 0) {
    setHint("calcHint", "Stake + profit must be positive to suggest odds.", "var(--loss)");
    return;
  }

  const impliedTarget = stake / (stake + profit); // target for sum(1/odds)
  const fields = activeOddsFields();
  const odds = fields.map((el) => extractDecimalOdds(el.value));
  const knownIdx = [], unknownIdx = [];
  odds.forEach((o, i) => (o > 1 ? knownIdx : unknownIdx).push(i));

  if (unknownIdx.length === 0) {
    // every side already has a value — rescale them all proportionally (keeping their
    // relative shape) so the set still lands exactly on the new target, instead of freezing.
    const currentSum = knownIdx.reduce((sum, i) => sum + 1 / odds[i], 0);
    const k = impliedTarget / currentSum;
    if (!(k > 0) || !isFinite(k)) {
      setHint("calcHint", "Can't reach this profit target from the current odds — try a different stake or profit.", "var(--loss)");
      return;
    }
    fields.forEach((el, i) => setOddsFieldValue(el, odds[i] / k));
    setHint("calcHint", "All odds rescaled to hit this stake & profit", "var(--brass)");
    return;
  }

  // one or more sides still blank — split the remaining implied probability equally
  // across just the blank ones, holding whatever's already filled in fixed.
  const knownSum = knownIdx.reduce((sum, i) => sum + 1 / odds[i], 0);
  const remaining = impliedTarget - knownSum;
  if (remaining <= 0) {
    setHint("calcHint", "The odds already entered already miss this profit target — try longer odds there.", "var(--loss)");
    return;
  }
  const perUnknown = remaining / unknownIdx.length;
  const suggested = 1 / perUnknown;
  unknownIdx.forEach((i) => setOddsFieldValue(fields[i], suggested));
  setHint(
    "calcHint",
    knownIdx.length === 0
      ? "Suggested equal odds for every side — swap in your real bookmaker prices"
      : "Suggested odds for the remaining side(s) to hit this stake & profit",
    "var(--brass)"
  );
}

["fOddsA", "fOddsB", "fOddsC"].forEach((id) => {
  document.getElementById(id).addEventListener("input", () => {
    profitManuallyEdited = false;
    forwardCalcProfit();
  });
});
document.getElementById("fStake").addEventListener("input", () => {
  if (profitManuallyEdited) {
    reverseCalcOdds();
  } else {
    forwardCalcProfit();
  }
});
document.getElementById("fProfit").addEventListener("input", () => {
  profitManuallyEdited = true;
  reverseCalcOdds();
});

document.getElementById("addBetBtn").onclick = async () => {
  const match = document.getElementById("fMatch").value.trim();
  const oddsA = document.getElementById("fOddsA").value.trim();
  const oddsB = document.getElementById("fOddsB").value.trim();
  const oddsC = document.getElementById("fOddsC").value.trim();
  const stake = parseFloat(document.getElementById("fStake").value);
  const profit = parseFloat(document.getElementById("fProfit").value);
  const matchTimeLocal = document.getElementById("fMatchTime").value;

  if (!match) { showToast("Enter a match name"); document.getElementById("fMatch").focus(); return; }
  if (isNaN(profit)) { showToast("Enter a profit amount"); document.getElementById("fProfit").focus(); return; }
  if (!matchTimeLocal) { showToast("Set when the match ends"); document.getElementById("fMatchTime").focus(); return; }

  const btn = document.getElementById("addBetBtn");
  btn.disabled = true;
  try {
    const res = await authedFetch("/api/bets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        match, oddsA, oddsB, oddsC,
        stake: isNaN(stake) ? 0 : stake,
        profit,
        matchTime: new Date(matchTimeLocal).toISOString(),
      }),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || "Could not add match"); return; }
    currentState = data;
    renderAll(currentState, { onRemove: removeBet, onSettle: settleNow });
    markSynced();
    ["fMatch", "fOddsA", "fOddsB", "fOddsC", "fStake", "fProfit", "fMatchTime"].forEach((id) => (document.getElementById(id).value = ""));
    profitManuallyEdited = false;
    setHint("calcHint", "");
    document.getElementById("fMatch").focus();
    showToast("Match added");
  } catch (e) {
  } finally {
    btn.disabled = false;
  }
};

async function removeBet(id) {
  try {
    const res = await authedFetch("/api/bets/" + encodeURIComponent(id), { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || "Could not remove match"); return; }
    currentState = data;
    renderAll(currentState, { onRemove: removeBet, onSettle: settleNow });
    markSynced();
  } catch (e) {}
}

async function settleNow(id) {
  try {
    const res = await authedFetch("/api/bets/" + encodeURIComponent(id) + "/settle", { method: "POST" });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || "Could not settle match"); return; }
    currentState = data;
    flashBalanceIfChanged(currentState.balance);
    renderAll(currentState, { onRemove: removeBet, onSettle: settleNow });
    markSynced();
    showToast("Match settled");
  } catch (e) {}
}

document.getElementById("changePwdBtn").onclick = async () => {
  const val = document.getElementById("fNewPwd").value;
  if (!val || val.length < 4) { showToast("Password needs at least 4 characters"); return; }
  try {
    const res = await authedFetch("/api/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword: val }),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || "Could not update password"); return; }
    document.getElementById("fNewPwd").value = "";
    showToast("Password updated");
  } catch (e) {}
};

initThemeToggle();
if (getToken()) {
  showAdmin();
} else {
  showLogin();
}
