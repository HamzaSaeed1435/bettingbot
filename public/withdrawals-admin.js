"use strict";

// Loaded before app-admin.js, which calls refreshWithdrawals() as soon as it starts.
// Uses app-admin.js's authedFetch / currentState / renderAll at call time.

const WD_STATUS_LABEL = { processing: "Processing", processed: "Processed", cancelled: "Cancelled" };

function bankLine(label, value) {
  if (!value) return "";
  return '<div><span class="k">' + label + "</span> " + escapeHtml(value) + "</div>";
}

function renderAdminWithdrawals(list) {
  const tbody = document.getElementById("wdTbody");
  tbody.innerHTML = "";
  document.getElementById("wdCount").textContent = "(" + list.length + ")";
  document.getElementById("wdEmpty").style.display = list.length ? "none" : "block";
  document.getElementById("wdTable").style.display = list.length ? "table" : "none";

  list
    .slice()
    .sort((a, b) => b.requestedAt - a.requestedAt)
    .forEach((w) => {
      const tr = document.createElement("tr");

      const tdDate = document.createElement("td");
      tdDate.className = "odds-line";
      tdDate.textContent = fmtMatchTime(w.requestedAt);
      tr.appendChild(tdDate);

      const tdBank = document.createElement("td");
      tdBank.innerHTML =
        '<div class="match-name">' + escapeHtml(w.accountName) + "</div>" +
        '<div class="bank-lines">' +
        bankLine("Bank", w.bankName) +
        bankLine("BSB", w.bsb) +
        bankLine("Acct", w.accountNumber) +
        bankLine("SWIFT", w.swift) +
        bankLine("IBAN", w.iban) +
        bankLine("Note", w.note) +
        "</div>";
      tr.appendChild(tdBank);

      const tdAmount = document.createElement("td");
      tdAmount.className = "num-cell";
      tdAmount.textContent = fmtMoney(w.amount);
      tr.appendChild(tdAmount);

      const tdStatus = document.createElement("td");
      tdStatus.innerHTML =
        '<span class="status-pill wd-' + escapeHtml(w.status) + '">' + (WD_STATUS_LABEL[w.status] || escapeHtml(w.status)) + "</span>";
      tr.appendChild(tdStatus);

      const tdActions = document.createElement("td");
      tdActions.className = "row-actions";
      [
        ["processed", "Processed"],
        ["cancelled", "Cancel"],
        ["processing", "Processing"],
      ].forEach(([status, label]) => {
        if (w.status === status) return;
        const btn = document.createElement("button");
        btn.className = "btn small";
        btn.textContent = label;
        btn.style.marginLeft = "6px";
        btn.onclick = () => setWithdrawalStatus(w.id, status);
        tdActions.appendChild(btn);
      });
      const delBtn = document.createElement("button");
      delBtn.className = "btn small danger";
      delBtn.textContent = "Delete";
      delBtn.style.marginLeft = "6px";
      delBtn.onclick = () => deleteWithdrawal(w.id);
      tdActions.appendChild(delBtn);
      tr.appendChild(tdActions);

      tbody.appendChild(tr);
    });
}

async function refreshWithdrawals() {
  try {
    const res = await authedFetch("/api/admin/withdrawals");
    if (!res.ok) return;
    renderAdminWithdrawals((await res.json()).withdrawals);
  } catch (e) {
    /* handled in authedFetch */
  }
}

async function setWithdrawalStatus(id, status) {
  try {
    const res = await authedFetch("/api/admin/withdrawals/" + encodeURIComponent(id) + "/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || "Could not update withdrawal"); return; }
    renderAdminWithdrawals(data.withdrawals);
    currentState = data.state;
    flashBalanceIfChanged(currentState.balance);
    renderAll(currentState, { onRemove: removeBet, onSettle: settleNow });
    markSynced();
    showToast("Withdrawal marked " + WD_STATUS_LABEL[status].toLowerCase());
  } catch (e) {}
}

async function deleteWithdrawal(id) {
  if (!confirm("Delete this withdrawal request? This can't be undone.")) return;
  try {
    const res = await authedFetch("/api/admin/withdrawals/" + encodeURIComponent(id), { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || "Could not delete withdrawal"); return; }
    renderAdminWithdrawals(data.withdrawals);
    showToast("Withdrawal deleted");
  } catch (e) {}
}
