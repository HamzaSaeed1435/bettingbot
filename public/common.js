"use strict";

const CURRENCY = "$";

const SPORT_ICON_SVG =
  '<svg class="sport-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="9"/>' +
  '<polygon points="12,7 15,9.5 14,13 10,13 9,9.5" fill="currentColor" stroke="none"/>' +
  '<line x1="12" y1="7" x2="12" y2="3.3"/><line x1="15" y1="9.5" x2="18.5" y2="8"/>' +
  '<line x1="14" y1="13" x2="16" y2="16.5"/><line x1="10" y1="13" x2="8" y2="16.5"/>' +
  '<line x1="9" y1="9.5" x2="5.5" y2="8"/></svg>';

function fmtMoney(n) {
  n = Number(n) || 0;
  const neg = n < 0;
  const abs = Math.abs(n).toFixed(2);
  const parts = abs.split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + CURRENCY + parts.join(".");
}

function fmtMatchTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function dateKey(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "unknown";
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function friendlyDate(key) {
  if (key === "unknown") return "Unknown date";
  const d = new Date(key + "T00:00:00");
  if (isNaN(d.getTime())) return key;
  return d.toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function formatDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0) return d + "d " + h + "h";
  if (h > 0) return h + "h " + m + "m";
  if (m > 0) return m + "m " + s + "s";
  return s + "s";
}

function startCountdownTicker() {
  function tick() {
    document.querySelectorAll(".time-left[data-match-time]").forEach((el) => {
      const t = new Date(el.dataset.matchTime).getTime();
      if (isNaN(t)) { el.textContent = ""; return; }
      const diff = t - Date.now();
      if (diff <= 0) {
        el.textContent = "Awaiting settlement";
        el.classList.add("soon");
        return;
      }
      el.classList.toggle("soon", diff < 60 * 60 * 1000);
      el.textContent = "in " + formatDuration(diff);
    });
  }
  tick();
  setInterval(tick, 1000);
}

function animateNumber(el, from, to, duration) {
  if (!el) return;
  if (prefersReducedMotion() || from === to || from === null) {
    el.textContent = fmtMoney(to);
    return;
  }
  const start = performance.now();
  function frame(now) {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = fmtMoney(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(frame);
    else el.textContent = fmtMoney(to);
  }
  requestAnimationFrame(frame);
}

const THEME_KEY = "arb_ledger_theme";
function resolvedTheme() {
  const override = document.documentElement.getAttribute("data-theme");
  if (override) return override;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function applyThemeIcon() {
  const t = resolvedTheme();
  document.querySelectorAll(".icon-sun").forEach((el) => (el.style.display = t === "dark" ? "none" : "block"));
  document.querySelectorAll(".icon-moon").forEach((el) => (el.style.display = t === "dark" ? "block" : "none"));
}
function initThemeToggle() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) document.documentElement.setAttribute("data-theme", saved);
  applyThemeIcon();
  document.querySelectorAll(".theme-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = resolvedTheme() === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem(THEME_KEY, next);
      applyThemeIcon();
    });
  });
}

function startUtcClock() {
  const el = document.getElementById("utcClock");
  if (!el) return;
  function tick() {
    const now = new Date();
    el.textContent =
      String(now.getUTCHours()).padStart(2, "0") + ":" +
      String(now.getUTCMinutes()).padStart(2, "0") + ":" +
      String(now.getUTCSeconds()).padStart(2, "0");
  }
  tick();
  setInterval(tick, 1000);
}

let _lastSyncAt = null;
function markSynced() {
  _lastSyncAt = Date.now();
  updateSyncText();
}
function updateSyncText() {
  const el = document.getElementById("syncText");
  if (!el || !_lastSyncAt) return;
  const secs = Math.round((Date.now() - _lastSyncAt) / 1000);
  el.textContent = secs < 3 ? "Synced just now" : "Synced " + secs + "s ago";
}
setInterval(updateSyncText, 1000);

let _lastBalance = null;
function flashBalanceIfChanged(balance) {
  const card = document.querySelector(".balance-card");
  if (!card) return;
  if (_lastBalance !== null && balance !== _lastBalance) {
    card.classList.remove("flash");
    void card.offsetWidth; // restart animation
    card.classList.add("flash");
  }
  _lastBalance = balance;
}

function celebrateBalanceIncrease() {
  const el = document.getElementById("balanceFigure");
  if (!el || prefersReducedMotion()) return;
  const colors = ["var(--brass)", "var(--profit)", "#e8c264", "#5fd9a0"];
  for (let i = 0; i < 14; i++) {
    const bit = document.createElement("span");
    bit.className = "confetti-bit";
    const angle = (Math.PI * 2 * i) / 14 + Math.random() * 0.4;
    const dist = 46 + Math.random() * 42;
    bit.style.setProperty("--dx", Math.cos(angle) * dist + "px");
    bit.style.setProperty("--dy", Math.sin(angle) * dist - 20 + "px");
    bit.style.background = colors[i % colors.length];
    el.appendChild(bit);
    setTimeout(() => bit.remove(), 950);
  }
}

function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), 2600);
}

function todaysTotal(state) {
  return state.openBets.reduce((sum, b) => sum + (Number(b.profit) || 0), 0);
}

function lifetimeProfit(state) {
  return state.history.reduce((sum, b) => sum + (Number(b.profit) || 0), 0);
}

let _displayedBalance = null;
function renderBalanceCard(state) {
  animateNumber(document.getElementById("balanceFigure"), _displayedBalance, state.balance, 900);
  _displayedBalance = state.balance;
  document.getElementById("metaOpenCount").textContent = state.openBets.length + (state.openBets.length === 1 ? " bet" : " bets");

  const openP = todaysTotal(state);
  const openEl = document.getElementById("metaTodayProfit");
  openEl.textContent = fmtMoney(openP);
  openEl.className = "meta-value" + (openP > 0 ? " profit" : openP < 0 ? " loss" : "");

  const lifeP = lifetimeProfit(state);
  const lifeEl = document.getElementById("metaLifetime");
  lifeEl.textContent = fmtMoney(lifeP);
  lifeEl.className = "meta-value" + (lifeP > 0 ? " profit" : lifeP < 0 ? " loss" : "");
}

function renderOpenBets(state, opts) {
  opts = opts || {};
  const tbody = document.getElementById("openTbody");
  if (!tbody) return; // this page doesn't render the open-bets table inline
  tbody.innerHTML = "";
  const has = state.openBets.length > 0;
  document.getElementById("openEmpty").style.display = has ? "none" : "block";
  document.getElementById("openTable").style.display = has ? "table" : "none";
  document.getElementById("openCount").textContent = "(" + state.openBets.length + ")";
  document.getElementById("dayTotalRow").style.display = has ? "flex" : "none";

  if (has) {
    const total = todaysTotal(state);
    const tv = document.getElementById("dayTotalValue");
    tv.textContent = fmtMoney(total);
    tv.style.color = total > 0 ? "var(--profit)" : total < 0 ? "var(--loss)" : "var(--ink)";
  }

  const sorted = state.openBets.slice().sort((a, b) => new Date(a.matchTime) - new Date(b.matchTime));

  sorted.forEach((bet, idx) => {
    const tr = document.createElement("tr");
    tr.style.animationDelay = Math.min(idx * 35, 350) + "ms";

    const tdMatch = document.createElement("td");
    tdMatch.innerHTML =
      '<div class="match-name">' + SPORT_ICON_SVG + escapeHtml(bet.match || "Untitled match") + '</div><span class="status-pill">Open</span>';
    tr.appendChild(tdMatch);

    const tdOdds = document.createElement("td");
    let oddsHtml = "";
    if (bet.oddsA) oddsHtml += '<div class="odds-line">' + escapeHtml(bet.oddsA) + "</div>";
    if (bet.oddsB) oddsHtml += '<div class="odds-line">' + escapeHtml(bet.oddsB) + "</div>";
    if (bet.oddsC) oddsHtml += '<div class="odds-line">' + escapeHtml(bet.oddsC) + "</div>";
    tdOdds.innerHTML = oddsHtml || "&mdash;";
    tr.appendChild(tdOdds);

    const tdTime = document.createElement("td");
    tdTime.innerHTML =
      '<div class="odds-line">' + fmtMatchTime(bet.matchTime) + '</div>' +
      '<div class="time-left" data-match-time="' + escapeHtml(bet.matchTime || "") + '"></div>';
    tr.appendChild(tdTime);

    const tdStake = document.createElement("td");
    tdStake.className = "num-cell";
    tdStake.textContent = bet.stake ? fmtMoney(bet.stake) : "—";
    tr.appendChild(tdStake);

    const tdProfit = document.createElement("td");
    const p = Number(bet.profit) || 0;
    tdProfit.className = "num-cell profit-cell " + (p >= 0 ? "pos" : "neg");
    tdProfit.textContent = fmtMoney(p);
    tr.appendChild(tdProfit);

    const tdActions = document.createElement("td");
    tdActions.className = "row-actions";
    if (opts.onSettle) {
      const settleBtn = document.createElement("button");
      settleBtn.className = "btn small";
      settleBtn.textContent = "Settle now";
      settleBtn.title = "Move to history immediately, without waiting for the scheduled match time";
      settleBtn.onclick = () => opts.onSettle(bet.id);
      tdActions.appendChild(settleBtn);
    }
    if (opts.onRemove) {
      const delBtn = document.createElement("button");
      delBtn.className = "btn small danger";
      delBtn.textContent = "Remove";
      delBtn.style.marginLeft = "6px";
      delBtn.onclick = () => opts.onRemove(bet.id);
      tdActions.appendChild(delBtn);
    }
    tr.appendChild(tdActions);

    tbody.appendChild(tr);
  });
}

function groupHistoryByDate(history) {
  const groups = {};
  history.forEach((bet) => {
    const key = dateKey(bet.settledAt);
    if (!groups[key]) groups[key] = { key, bets: [], dayProfit: 0, balanceAfter: 0, latestSettledAt: 0 };
    groups[key].bets.push(bet);
    groups[key].dayProfit += Number(bet.profit) || 0;
    if (bet.settledAt >= groups[key].latestSettledAt) {
      groups[key].latestSettledAt = bet.settledAt;
      groups[key].balanceAfter = bet.balanceAfter;
    }
  });
  return Object.values(groups).sort((a, b) => b.latestSettledAt - a.latestSettledAt);
}

function buildHistoryDayElement(day) {
  const wrap = document.createElement("div");
  wrap.className = "history-day";

  const pos = day.dayProfit >= 0;
  const summary = document.createElement("div");
  summary.className = "history-summary";
  summary.innerHTML =
    '<span class="stripe ' + (pos ? "pos" : "neg") + '"></span>' +
    '<span class="history-date">' + escapeHtml(friendlyDate(day.key)) + "</span>" +
    '<span class="history-count">' + day.bets.length + (day.bets.length === 1 ? " match" : " matches") +
    " &middot; balance after " + fmtMoney(day.balanceAfter) + "</span>" +
    '<span class="history-profit ' + (pos ? "pos" : "neg") + '">' + fmtMoney(day.dayProfit) + "</span>" +
    '<span class="history-caret">&#9656;</span>';
  summary.onclick = () => wrap.classList.toggle("expanded");
  wrap.appendChild(summary);

  const detail = document.createElement("div");
  detail.className = "history-detail";
  const tableWrap = document.createElement("div");
  tableWrap.className = "table-wrap";
  const table = document.createElement("table");
  table.className = "bets";
  table.innerHTML = "<thead><tr><th>Match</th><th>Odds taken</th><th>Match time</th><th>Stake</th><th>Profit</th></tr></thead>";
  const tbody = document.createElement("tbody");
  day.bets
    .slice()
    .sort((a, b) => new Date(a.matchTime) - new Date(b.matchTime))
    .forEach((bet) => {
      const p = Number(bet.profit) || 0;
      const tr = document.createElement("tr");
      tr.innerHTML =
        '<td class="match-name">' + SPORT_ICON_SVG + escapeHtml(bet.match || "Untitled match") + "</td>" +
        "<td>" +
        (bet.oddsA ? '<div class="odds-line">' + escapeHtml(bet.oddsA) + "</div>" : "") +
        (bet.oddsB ? '<div class="odds-line">' + escapeHtml(bet.oddsB) + "</div>" : "") +
        (bet.oddsC ? '<div class="odds-line">' + escapeHtml(bet.oddsC) + "</div>" : "") +
        "</td>" +
        '<td class="odds-line">' + fmtMatchTime(bet.matchTime) + "</td>" +
        '<td class="num-cell">' + (bet.stake ? fmtMoney(bet.stake) : "—") + "</td>" +
        '<td class="num-cell profit-cell ' + (p >= 0 ? "pos" : "neg") + '">' + fmtMoney(p) + "</td>";
      tbody.appendChild(tr);
    });
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  detail.appendChild(tableWrap);
  wrap.appendChild(detail);

  return wrap;
}

function renderHistory(state) {
  const list = document.getElementById("historyList");
  if (!list) return; // this page (e.g. the main partner page) doesn't render history inline

  const days = groupHistoryByDate(state.history);

  document.getElementById("historyCount").textContent = "(" + days.length + (days.length === 1 ? " day)" : " days)");
  document.getElementById("historyEmpty").style.display = days.length ? "none" : "block";
  list.innerHTML = "";

  days.forEach((day, idx) => {
    const el = buildHistoryDayElement(day);
    el.style.animationDelay = Math.min(idx * 45, 350) + "ms";
    list.appendChild(el);
  });
}

function renderAll(state, opts) {
  renderBalanceCard(state);
  renderOpenBets(state, opts);
  renderHistory(state);
}
