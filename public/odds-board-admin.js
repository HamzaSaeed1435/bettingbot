"use strict";

function decimalFromAmerican(price) {
  const n = Number(price);
  if (n > 0) return (n / 100 + 1).toFixed(2);
  return (100 / -n + 1).toFixed(2);
}

function toLocalDatetimeValue(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function dayLabel(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const startOfDay = (dt) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const diffDays = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays > 1 && diffDays < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return null;
}

function useOddsEventForNewBet(ev) {
  document.getElementById("fMatch").value = ev.home + " vs " + ev.away;
  if (ev.outcomes[0]) document.getElementById("fOddsA").value = ev.outcomes[0].book + " @ " + decimalFromAmerican(ev.outcomes[0].price);
  if (ev.outcomes[1]) document.getElementById("fOddsB").value = ev.outcomes[1].book + " @ " + decimalFromAmerican(ev.outcomes[1].price);
  const oddsCEl = document.getElementById("fOddsC");
  oddsCEl.value = ev.outcomes[2] ? ev.outcomes[2].book + " @ " + decimalFromAmerican(ev.outcomes[2].price) : "";
  document.getElementById("fMatchTime").value = toLocalDatetimeValue(ev.commenceTime);
  document.getElementById("fStake").scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
  document.getElementById("fStake").focus();
  showToast(
    ev.outcomes[2]
      ? "3-way match, odds & time filled in — add stake & profit to finish"
      : "Match, odds & time filled in — add stake & profit to finish"
  );
}

function renderAdminOddsBoard(data) {
  const list = document.getElementById("oddsList");
  const empty = document.getElementById("oddsEmpty");
  const asOf = document.getElementById("oddsAsOf");
  const creditsEl = document.getElementById("oddsCredits");
  if (!list) return;

  if (asOf) asOf.textContent = data.fetchedAt ? "as of " + fmtMatchTime(new Date(data.fetchedAt).toISOString()) : "";
  if (creditsEl) {
    creditsEl.textContent =
      data.creditsRemaining !== null && data.creditsRemaining !== undefined
        ? "Odds data credits remaining: " + data.creditsRemaining
        : "";
  }

  const events = data.events || [];
  if (!events.length) {
    empty.style.display = "block";
    empty.textContent = data.error ? "Odds data unavailable right now." : "No upcoming events right now.";
    list.innerHTML = "";
    return;
  }
  empty.style.display = "none";
  list.innerHTML = "";

  events.slice(0, 30).forEach((ev, idx) => {
    const el = document.createElement("div");
    el.className = "odds-event";
    el.style.animationDelay = Math.min(idx * 40, 320) + "ms";

    const priceRows = ev.outcomes
      .map(
        (o) =>
          '<div class="odds-price-row">' +
          '<span class="side">' + escapeHtml(o.name) + "</span>" +
          '<span class="price">' + (Number(o.price) > 0 ? "+" : "") + o.price + "</span>" +
          '<span class="book">' + escapeHtml(o.book) + "</span>" +
          "</div>"
      )
      .join("");

    const isArb = typeof ev.marginPct === "number" && ev.marginPct < 0;
    const marginHtml =
      typeof ev.marginPct === "number"
        ? '<span class="odds-margin' + (isArb ? " arb" : "") + '">' +
          (isArb ? "Possible arb" : "Market margin") + " " + Math.abs(ev.marginPct) + "%</span>"
        : "";

    const label = dayLabel(ev.commenceTime);

    el.innerHTML =
      '<div class="odds-event-sport">' + escapeHtml(ev.sport) +
      (label ? '<span class="day-badge">' + escapeHtml(label) + "</span>" : "") + "</div>" +
      '<div class="odds-event-match">' + escapeHtml(ev.home) + " vs " + escapeHtml(ev.away) + "</div>" +
      '<div class="odds-event-time">' + fmtMatchTime(ev.commenceTime) + "</div>" +
      priceRows +
      marginHtml +
      '<div style="margin-top:12px;"><button type="button" class="btn small primary use-odds-btn">Use for new bet</button></div>';

    el.querySelector(".use-odds-btn").addEventListener("click", () => useOddsEventForNewBet(ev));

    list.appendChild(el);
  });
}

async function refreshAdminOddsBoard() {
  try {
    const res = await fetch("/api/odds");
    if (!res.ok) return;
    renderAdminOddsBoard(await res.json());
  } catch (e) {
    /* silent - non-critical panel */
  }
}

refreshAdminOddsBoard();
setInterval(refreshAdminOddsBoard, 5 * 60 * 1000);
