"use strict";

const WD_STATUS_LABEL = { processing: "Processing", processed: "Processed", cancelled: "Cancelled" };
const WD_FIELDS = ["wAmount", "wAccountName", "wBankName", "wBsb", "wAccountNumber", "wSwift", "wIban", "wNote"];

function renderWithdrawals(list) {
  const tbody = document.getElementById("wdTbody");
  tbody.innerHTML = "";
  document.getElementById("wdCount").textContent = "(" + list.length + ")";
  document.getElementById("wdEmpty").style.display = list.length ? "none" : "block";
  document.getElementById("wdTable").style.display = list.length ? "table" : "none";

  list
    .slice()
    .sort((a, b) => b.requestedAt - a.requestedAt)
    .forEach((w, idx) => {
      const tr = document.createElement("tr");
      tr.style.animationDelay = Math.min(idx * 35, 350) + "ms";
      tr.innerHTML =
        '<td class="odds-line">' + fmtMatchTime(w.requestedAt) + "</td>" +
        "<td>" + escapeHtml(w.bankName) + '<div class="bank-lines"><span class="k">Acct</span> ' + escapeHtml(w.accountTail) + "</div></td>" +
        '<td class="num-cell">' + fmtMoney(w.amount) + "</td>" +
        '<td><span class="status-pill wd-' + escapeHtml(w.status) + '">' + (WD_STATUS_LABEL[w.status] || escapeHtml(w.status)) + "</span></td>" +
        '<td class="odds-line">' + (w.updatedAt && w.updatedAt !== w.requestedAt ? fmtMatchTime(w.updatedAt) : "—") + "</td>";
      tbody.appendChild(tr);
    });
}

async function loadWithdrawals() {
  try {
    const res = await fetch("/api/withdrawals");
    if (!res.ok) throw new Error("bad response");
    const data = await res.json();
    renderWithdrawals(data.withdrawals);
    setAvailable(data.available);
  } catch (e) {
    showToast("Could not load withdrawals");
  }
}

let availableNow = null;
function setAvailable(amount) {
  availableNow = Number(amount) || 0;
  document.getElementById("wdAvailable").textContent = fmtMoney(availableNow);
}

function val(id) {
  return document.getElementById(id).value.trim();
}

function clearFieldError(id) {
  const input = document.getElementById(id);
  input.classList.remove("invalid");
  input.removeAttribute("aria-invalid");
  const msg = input.parentNode.querySelector(".field-error");
  if (msg) msg.remove();
}

function setFieldError(id, text) {
  clearFieldError(id);
  const input = document.getElementById(id);
  input.classList.add("invalid");
  input.setAttribute("aria-invalid", "true");
  const msg = document.createElement("div");
  msg.className = "field-error";
  msg.setAttribute("role", "alert");
  msg.textContent = text;
  input.parentNode.appendChild(msg);
}

// Server-side rejections come back as one message — pin it under the field it's about.
function fieldForServerError(text) {
  if (/amount/i.test(text)) return "wAmount";
  if (/holder/i.test(text)) return "wAccountName";
  if (/bank name/i.test(text)) return "wBankName";
  if (/bsb/i.test(text)) return "wBsb";
  if (/account number/i.test(text)) return "wAccountNumber";
  if (/swift/i.test(text)) return "wSwift";
  if (/iban/i.test(text)) return "wIban";
  return null;
}

WD_FIELDS.forEach((id) => {
  document.getElementById(id).addEventListener("input", () => clearFieldError(id));
});

document.getElementById("wdSubmitBtn").onclick = async () => {
  const amount = parseFloat(val("wAmount"));
  const bsb = val("wBsb").replace(/[\s-]/g, "");
  const accountNumber = val("wAccountNumber").replace(/[\s-]/g, "");
  const swift = val("wSwift").toUpperCase();
  const iban = val("wIban").replace(/\s/g, "").toUpperCase();

  document.getElementById("wdError").textContent = "";
  WD_FIELDS.forEach(clearFieldError);

  const errors = [];
  if (!(amount > 0)) errors.push(["wAmount", "Enter a withdrawal amount greater than 0"]);
  else if (availableNow !== null && amount > availableNow) {
    errors.push(["wAmount", "Amount is more than the available balance (" + fmtMoney(availableNow) + ")"]);
  }
  if (!val("wAccountName")) errors.push(["wAccountName", "Enter the account holder name"]);
  if (!val("wBankName")) errors.push(["wBankName", "Enter the bank name"]);
  if (!/^\d{6}$/.test(bsb)) errors.push(["wBsb", "BSB must be 6 digits"]);
  if (!/^\d{5,10}$/.test(accountNumber)) errors.push(["wAccountNumber", "Account number must be 5 to 10 digits"]);
  if (!/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(swift)) errors.push(["wSwift", "SWIFT/BIC must be 8 or 11 characters"]);
  if (iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) errors.push(["wIban", "IBAN doesn't look valid"]);

  if (errors.length) {
    errors.forEach(([id, text]) => setFieldError(id, text));
    document.getElementById(errors[0][0]).focus();
    return;
  }

  const btn = document.getElementById("wdSubmitBtn");
  btn.disabled = true;
  try {
    const res = await fetch("/api/withdrawals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount,
        accountName: val("wAccountName"),
        bankName: val("wBankName"),
        bsb,
        accountNumber,
        swift,
        iban,
        note: val("wNote"),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      const text = data.error || "Could not submit request";
      const id = fieldForServerError(text);
      if (id) { setFieldError(id, text); document.getElementById(id).focus(); }
      else document.getElementById("wdError").textContent = text;
      return;
    }
    renderWithdrawals(data.withdrawals);
    setAvailable(data.available);
    WD_FIELDS.forEach((id) => (document.getElementById(id).value = ""));
    showToast("Withdrawal request submitted");
  } catch (e) {
    document.getElementById("wdError").textContent = "Could not reach the server";
  } finally {
    btn.disabled = false;
  }
};

initThemeToggle();
loadWithdrawals();
setInterval(loadWithdrawals, 30000);
