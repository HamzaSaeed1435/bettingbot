"use strict";

let _prevBalanceForCelebration = null;

async function refresh() {
  try {
    const res = await fetch("/api/state");
    if (!res.ok) throw new Error("bad response");
    const state = await res.json();
    flashBalanceIfChanged(state.balance);
    if (_prevBalanceForCelebration !== null && state.balance > _prevBalanceForCelebration) {
      celebrateBalanceIncrease();
    }
    _prevBalanceForCelebration = state.balance;
    renderAll(state, {});
    markSynced();
  } catch (e) {
    showToast("Could not reach the ledger");
  }
}

initThemeToggle();
startUtcClock();
startCountdownTicker();
refresh();
setInterval(refresh, 30000);
