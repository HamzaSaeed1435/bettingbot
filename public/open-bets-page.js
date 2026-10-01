"use strict";

async function refreshOpenBets() {
  try {
    const res = await fetch("/api/state");
    if (!res.ok) throw new Error("bad response");
    const state = await res.json();
    renderOpenBets(state, {});
  } catch (e) {
    showToast("Could not reach the ledger");
  }
}

initThemeToggle();
startCountdownTicker();
refreshOpenBets();
setInterval(refreshOpenBets, 30000);
