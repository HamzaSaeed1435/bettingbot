"use strict";

const PAGE_SIZE = 8;
let allDays = [];
let currentPage = 1;

function renderPage() {
  const totalPages = Math.max(1, Math.ceil(allDays.length / PAGE_SIZE));
  currentPage = Math.min(Math.max(1, currentPage), totalPages);

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageDays = allDays.slice(start, start + PAGE_SIZE);

  const list = document.getElementById("historyList");
  list.innerHTML = "";
  document.getElementById("historyEmpty").style.display = allDays.length ? "none" : "block";
  document.getElementById("historyCount").textContent = "(" + allDays.length + (allDays.length === 1 ? " day)" : " days)");

  pageDays.forEach((day, idx) => {
    const el = buildHistoryDayElement(day);
    el.style.animationDelay = Math.min(idx * 45, 320) + "ms";
    list.appendChild(el);
  });

  document.getElementById("pagination").style.display = allDays.length > PAGE_SIZE ? "flex" : "none";
  document.getElementById("historyPageInfo").textContent = "Page " + currentPage + " of " + totalPages;
  document.getElementById("prevPageBtn").disabled = currentPage <= 1;
  document.getElementById("nextPageBtn").disabled = currentPage >= totalPages;
}

document.getElementById("prevPageBtn").onclick = () => {
  currentPage--;
  renderPage();
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
};
document.getElementById("nextPageBtn").onclick = () => {
  currentPage++;
  renderPage();
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
};

async function loadHistory() {
  try {
    const res = await fetch("/api/state");
    if (!res.ok) throw new Error("bad response");
    const state = await res.json();
    allDays = groupHistoryByDate(state.history);
    renderPage();
  } catch (e) {
    showToast("Could not load history");
  }
}

initThemeToggle();
loadHistory();
