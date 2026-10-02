"use strict";

const THEME_KEY = "arb_ledger_theme";
const savedTheme = localStorage.getItem(THEME_KEY);
if (savedTheme) document.documentElement.setAttribute("data-theme", savedTheme);

async function siteLogin() {
  const password = document.getElementById("sitePwd").value;
  if (!password) return;
  const btn = document.getElementById("siteLoginBtn");
  const errEl = document.getElementById("loginError");
  btn.disabled = true;
  errEl.textContent = "";
  try {
    const res = await fetch("/api/site-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      errEl.textContent = data.error || "Could not sign in";
      document.getElementById("sitePwd").select();
      return;
    }
    window.location.replace("/");
  } catch (e) {
    errEl.textContent = "Could not reach the server";
  } finally {
    btn.disabled = false;
  }
}

document.getElementById("siteLoginBtn").onclick = siteLogin;
document.getElementById("sitePwd").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); siteLogin(); }
});
