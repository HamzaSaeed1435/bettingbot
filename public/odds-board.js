"use strict";

function fmtAmerican(price) {
  const n = Number(price);
  return (n > 0 ? "+" : "") + n;
}

function fmtOddsTime(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
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

function renderOddsBoard(data) {
  const list = document.getElementById("oddsList");
  const empty = document.getElementById("oddsEmpty");
  const asOf = document.getElementById("oddsAsOf");
  const creditsEl = document.getElementById("oddsCredits");
  if (!list) return;

  if (asOf) {
    asOf.textContent = data.fetchedAt ? "as of " + fmtOddsTime(new Date(data.fetchedAt).toISOString()) : "";
  }
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
    el.className = "swiper-slide odds-event";
    el.style.animationDelay = Math.min(idx * 40, 320) + "ms";

    const priceRows = ev.outcomes
      .map(
        (o) =>
          '<div class="odds-price-row">' +
          '<span class="side">' + escapeHtml(o.name) + "</span>" +
          '<span class="price">' + fmtAmerican(o.price) + "</span>" +
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
      '<div class="odds-event-time">' + fmtOddsTime(ev.commenceTime) + "</div>" +
      priceRows +
      marginHtml;

    list.appendChild(el);
  });

  initOrUpdateOddsSwiper();
}

let oddsSwiperInstance = null;

function initOrUpdateOddsSwiper() {
  if (!window.Swiper || !document.getElementById("oddsSwiper")) return;
  if (oddsSwiperInstance) {
    oddsSwiperInstance.update();
    return;
  }
  oddsSwiperInstance = new Swiper("#oddsSwiper", {
    slidesPerView: 1.15,
    spaceBetween: 16,
    grabCursor: true,
    breakpoints: {
      640: { slidesPerView: 2.2 },
      1000: { slidesPerView: 3.2 },
      1300: { slidesPerView: 4 },
    },
    pagination: { el: ".swiper-pagination", clickable: true },
    navigation: { nextEl: ".swiper-button-next", prevEl: ".swiper-button-prev" },
    autoplay: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? false
      : { delay: 4500, disableOnInteraction: true },
  });
}

async function refreshOddsBoard() {
  try {
    const res = await fetch("/api/odds");
    if (!res.ok) return;
    renderOddsBoard(await res.json());
  } catch (e) {
    /* silent - odds board is a nice-to-have, not core ledger function */
  }
}

refreshOddsBoard();
setInterval(refreshOddsBoard, 5 * 60 * 1000);
