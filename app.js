const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxwKctuxJb1AjwlMB6EifOKV1hvoJbdgjdfK9xVvQdRaBRUCLMBnv_nAK75GLhWzcbE/exec";
let trackerData = { podFlat: [], podBob: [], displayFlat: [], displayBob: [] };
const state = { team: "", rep: "", accounts: ["", "", "", "", "", ""] };

document.addEventListener("DOMContentLoaded", () => {
  buildAccountSelectors();
  bindEvents();
  loadTrackerData().catch(err => setStatus("Error loading data: " + err.message, true));
});
function bindEvents() {
  document.getElementById("refreshBtn").addEventListener("click", () => loadTrackerData().catch(err => setStatus("Error refreshing data: " + err.message, true)));
  document.getElementById("refreshTopBtn").addEventListener("click", () => loadTrackerData().catch(err => setStatus("Error refreshing data: " + err.message, true)));
  document.getElementById("printBtn").addEventListener("click", () => window.print());
  document.getElementById("teamSelect").addEventListener("change", event => { state.team = event.target.value; state.rep = ""; state.accounts = ["", "", "", "", "", ""]; populateRepDropdown(); populateAccountDropdowns(); renderReport(); });
  document.getElementById("repSelect").addEventListener("change", event => { state.rep = event.target.value; state.accounts = ["", "", "", "", "", ""]; populateAccountDropdowns(); renderReport(); });
}
function buildAccountSelectors() {
  const container = document.getElementById("accountSelectors"); container.innerHTML = "";
  for (let i = 0; i < 6; i++) {
    const label = document.createElement("label");
    label.innerHTML = `Account ${i + 1}<select id="accountSelect${i}"><option value="">Select Account</option></select>`;
    container.appendChild(label);
    label.querySelector("select").addEventListener("change", event => { state.accounts[i] = event.target.value; renderReport(); });
  }
}
async function loadTrackerData() {
  setStatus("Loading tracker data...");
  const result = await postToAppsScript({ action: "getTrackerData" });
  if (!result.success) throw new Error(result.message || "Could not load tracker data.");
  trackerData = { podFlat: result.data.POD_Flat || [], podBob: result.data.POD_BOB_MNY || [], displayFlat: result.data.Display_Flat || [], displayBob: result.data.Display_BOB || [] };
  document.getElementById("podRowCount").textContent = trackerData.podFlat.length.toLocaleString();
  document.getElementById("podBobRowCount").textContent = trackerData.podBob.length.toLocaleString();
  document.getElementById("displayRowCount").textContent = trackerData.displayFlat.length.toLocaleString();
  populateTeamDropdown(); populateRepDropdown(); populateAccountDropdowns(); renderReport(); setStatus("Tracker data loaded.");
}
async function postToAppsScript(payload) {
  const response = await fetch(APPS_SCRIPT_URL, { method: "POST", body: JSON.stringify(payload) });
  const text = await response.text();
  try { return JSON.parse(text); } catch { throw new Error("Apps Script did not return valid JSON. Check the deployment URL and access permissions."); }
}
function populateTeamDropdown() {
  const teams = uniqueSorted(trackerData.podFlat.filter(row => same(getField(row, ["Premise"]), "OFF")).map(row => getField(row, ["Team"])).filter(Boolean));
  fillSelect("teamSelect", teams, "Select Team", state.team);
}
function populateRepDropdown() {
  const reps = uniqueSorted(trackerData.podFlat.filter(row => same(getField(row, ["Premise"]), "OFF") && same(getField(row, ["Team"]), state.team)).map(row => getField(row, ["Sales Person"])).filter(Boolean));
  fillSelect("repSelect", reps, "Select Sales Rep", state.rep);
}
function populateAccountDropdowns() {
  const accounts = getAccountsByRep(state.rep);
  for (let i = 0; i < 6; i++) fillSelect(`accountSelect${i}`, accounts, "Select Account", state.accounts[i]);
}
function getAccountsByRep(rep) {
  if (!rep) return [];

  let accountRows = trackerData.podBob.filter(row => {
    const rowRep = getField(row, ["Sales Person", "SalesPerson", "Sales Rep"]);
    const rowPremise = getField(row, ["PREMISE", "Premise"]);
    const rowTeam = getField(row, ["Team"]);

    return (
      same(rowRep, rep) &&
      isOffPremise(rowPremise)
    );
  });

  // Fallback 1: if rep match fails, try Team + OFF.
  if (!accountRows.length && state.team) {
    accountRows = trackerData.podBob.filter(row => {
      const rowTeam = getField(row, ["Team"]);
      const rowPremise = getField(row, ["PREMISE", "Premise"]);

      return (
        same(rowTeam, state.team) &&
        isOffPremise(rowPremise)
      );
    });
  }

  // Fallback 2: if premise values are blank or inconsistent, use rep only.
  if (!accountRows.length) {
    accountRows = trackerData.podBob.filter(row => {
      const rowRep = getField(row, ["Sales Person", "SalesPerson", "Sales Rep"]);
      return same(rowRep, rep);
    });
  }

  const accounts = accountRows
    .map(row => getField(row, ["Customer", "Account", "Customer Name"]))
    .filter(Boolean);

  return uniqueSorted(accounts);
}
function renderReport() {
  document.getElementById("reportSubTitle").textContent = [state.team || "No team selected", state.rep || "No rep selected"].join(" • ");
  renderPodBtg(); renderDisplayBtg(); renderAccountBreakdowns(); renderDisplayAccountDetails();
}
function renderPodBtg() {
  const section = document.getElementById("podBtgSection");
  const brandGroups = uniqueSorted(trackerData.podFlat.filter(row => same(getField(row, ["Premise"]), "OFF")).map(row => getField(row, ["Brand"])).filter(Boolean));
  if (!brandGroups.length) { section.innerHTML = emptySection("POD BTG", "No POD data loaded."); return; }
  const rows = brandGroups.map(brand => {
    const repRows = trackerData.podFlat.filter(row => same(getField(row, ["Premise"]), "OFF") && same(getField(row, ["Sales Person"]), state.rep) && same(getField(row, ["Brand"]), brand));
    const teamRows = trackerData.podFlat.filter(row => same(getField(row, ["Premise"]), "OFF") && same(getField(row, ["Team"]), state.team) && same(getField(row, ["Brand"]), brand));
    const repActual = sum(repRows, ["POD Act"]), repGoal = sum(repRows, ["POD Goal"]), teamActual = sum(teamRows, ["POD Act"]), teamGoal = sum(teamRows, ["POD Goal"]);
    return { brand, repBtg: repActual - repGoal, repAch: percent(repActual, repGoal), teamBtg: teamActual - teamGoal, teamAch: percent(teamActual, teamGoal) };
  });
  section.innerHTML = `<div class="report-section"><div class="section-title">POD BTG</div><div class="table-wrap"><table><thead><tr><th>Brand</th><th class="numeric">Rep BTG</th><th class="numeric">Rep % Ach</th><th class="numeric">Team BTG</th><th class="numeric">Team % Ach</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.brand)}</td><td class="numeric ${row.repBtg < 0 ? "bad" : "good"}">${formatNumber(row.repBtg)}</td><td class="numeric">${formatPercent(row.repAch)}</td><td class="numeric ${row.teamBtg < 0 ? "bad" : "good"}">${formatNumber(row.teamBtg)}</td><td class="numeric">${formatPercent(row.teamAch)}</td></tr>`).join("")}</tbody></table></div></div>`;
}
function renderDisplayBtg() {
  const section = document.getElementById("displayBtgSection");
  const brandGroups = uniqueSorted(trackerData.displayFlat.filter(row => same(getField(row, ["Premise"]), "OFF")).map(row => getField(row, ["Brand"])).filter(Boolean));
  if (!brandGroups.length) { section.innerHTML = emptySection("Display BTG", "No Display data loaded."); return; }
  const rows = brandGroups.map(brand => {
    const repRows = trackerData.displayFlat.filter(row => same(getField(row, ["Premise"]), "OFF") && same(getField(row, ["Sales Person"]), state.rep) && same(getField(row, ["Brand"]), brand));
    const teamRows = trackerData.displayFlat.filter(row => same(getField(row, ["Premise"]), "OFF") && same(getField(row, ["Team"]), state.team) && same(getField(row, ["Brand"]), brand));
    const repActual = sum(repRows, ["Display Act"]), repGoal = sum(repRows, ["Display Goal"]), teamActual = sum(teamRows, ["Display Act"]), teamGoal = sum(teamRows, ["Display Goal"]);
    return { brand, repBtg: repActual - repGoal, repAch: percent(repActual, repGoal), teamBtg: teamActual - teamGoal, teamAch: percent(teamActual, teamGoal) };
  });
  section.innerHTML = `<div class="report-section"><div class="section-title">Display BTG</div><div class="table-wrap"><table><thead><tr><th>Brand</th><th class="numeric">Rep BTG</th><th class="numeric">Rep % Ach</th><th class="numeric">Team BTG</th><th class="numeric">Team % Ach</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.brand)}</td><td class="numeric ${row.repBtg < 0 ? "bad" : "good"}">${formatNumber(row.repBtg)}</td><td class="numeric">${formatPercent(row.repAch)}</td><td class="numeric ${row.teamBtg < 0 ? "bad" : "good"}">${formatNumber(row.teamBtg)}</td><td class="numeric">${formatPercent(row.teamAch)}</td></tr>`).join("")}</tbody></table></div></div>`;
}
function renderAccountBreakdowns() {
  const section = document.getElementById("accountBreakdownSection"); const accounts = state.accounts.filter(Boolean);
  if (!accounts.length) { section.innerHTML = emptySection("Account POD Details", "Select at least one account to see account-level POD details."); return; }
  section.innerHTML = `<div class="report-section"><div class="section-title">Account POD Details</div>${accounts.map(account => renderAccountCard(account)).join("")}</div>`;
}
function renderAccountCard(account) {
  const rows = trackerData.podBob.filter(row =>
    same(getField(row, ["Customer", "Account", "Customer Name"]), account) &&
    isOffPremise(getField(row, ["PREMISE", "Premise"]))
  );
  const detailRows = rows.map(row => ({ brandGroup: getField(row, ["Brand Group"]), brand: getField(row, ["Brand"]), pods: getField(row, ["PODs"]) })).filter(row => row.brandGroup || row.brand || row.pods);
  if (!detailRows.length) return `<div class="account-card"><h3>${escapeHtml(account)}</h3><p class="empty">No account-level POD detail found for this account.</p></div>`;
  return `<div class="account-card"><h3>${escapeHtml(account)}</h3><div class="table-wrap"><table><thead><tr><th>Brand Group</th><th>Brand</th><th class="numeric">PODs</th></tr></thead><tbody>${detailRows.map(row => `<tr><td>${escapeHtml(row.brandGroup)}</td><td>${escapeHtml(row.brand)}</td><td class="numeric">${formatNumber(row.pods)}</td></tr>`).join("")}</tbody></table></div></div>`;
}
function renderDisplayAccountDetails() {
  const section = document.getElementById("displayAccountSection"); const accounts = state.accounts.filter(Boolean); if (!accounts.length) { section.innerHTML = ""; return; }
  const rows = trackerData.displayBob.filter(row => accounts.some(account => same(getField(row, ["Customer"]), account)) && same(getField(row, ["PREMISE", "Premise"]), "OFF")).map(row => ({ customer: getField(row, ["Customer"]), month: getField(row, ["Month"]), brandGoalGroup: getField(row, ["Brand Goal Group"]), setGoalType: getField(row, ["SET Goal Type"]), qualifierMet: getField(row, ["Qualifier Met"]), poes: getField(row, ["# POEs"]), posInd: getField(row, ["POS Ind"]), imageUrl: getField(row, ["Image URL"]) })).filter(row => row.customer || row.month || row.brandGoalGroup);
  if (!rows.length) { section.innerHTML = emptySection("Account Display Details", "No account-level display details found for the selected accounts."); return; }
  section.innerHTML = `<div class="report-section"><div class="section-title">Account Display Details</div><div class="table-wrap"><table><thead><tr><th>Customer</th><th>Month</th><th>Brand Goal Group</th><th>SET Goal Type</th><th>Qualifier Met</th><th class="numeric"># POEs</th><th>POS Ind</th><th>Image</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.customer)}</td><td>${escapeHtml(row.month)}</td><td>${escapeHtml(row.brandGoalGroup)}</td><td>${escapeHtml(row.setGoalType)}</td><td>${Number(row.qualifierMet || 0) ? '<span class="yes-pill">Yes</span>' : '<span class="no-pill">No</span>'}</td><td class="numeric">${formatNumber(row.poes)}</td><td>${escapeHtml(row.posInd)}</td><td>${row.imageUrl ? `<a href="${escapeAttr(row.imageUrl)}" target="_blank" rel="noopener">Open</a>` : ""}</td></tr>`).join("")}</tbody></table></div></div>`;
}
function fillSelect(id, values, placeholder, selectedValue) { const select = document.getElementById(id); select.innerHTML = `<option value="">${placeholder}</option>` + values.map(value => `<option value="${escapeAttr(value)}">${escapeHtml(value)}</option>`).join(""); if (selectedValue && values.includes(selectedValue)) select.value = selectedValue; }
function getField(row, candidates) { const keys = Object.keys(row || {}); const normalizedMap = new Map(keys.map(key => [normalizeKey(key), key])); for (const candidate of candidates) { const exactKey = normalizedMap.get(normalizeKey(candidate)); if (exactKey !== undefined) { const value = row[exactKey]; return typeof value === "string" ? value.trim() : value; } } return ""; }
function sum(rows, candidates) { return rows.reduce((total, row) => { const value = Number(getField(row, candidates) || 0); return total + (Number.isFinite(value) ? value : 0); }, 0); }
function percent(actual, goal) { const a = Number(actual || 0), g = Number(goal || 0); if (!g) return null; return a / g; }
function uniqueSorted(values) { return [...new Set(values.map(v => String(v || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)); }
function normalizeKey(value) { return String(value || "").toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9]/g, ""); }
function same(a, b) { return String(a || "").trim().toUpperCase() === String(b || "").trim().toUpperCase(); }
function isOffPremise(value) {
  const normalized = String(value || "").trim().toUpperCase();

  return (
    normalized === "OFF" ||
    normalized === "OFF PREMISE" ||
    normalized.includes("OFF")
  );
}
function formatNumber(value) { const number = Number(value || 0); if (!Number.isFinite(number)) return ""; return number.toLocaleString(undefined, { maximumFractionDigits: 0 }); }
function formatPercent(value) { if (value === null || value === undefined || value === "") return ""; return Number(value).toLocaleString(undefined, { style: "percent", maximumFractionDigits: 1 }); }
function setStatus(message, isError = false) { const el = document.getElementById("uploadStatus"); el.textContent = message; el.style.color = isError ? "var(--danger)" : "var(--muted)"; }
function emptySection(title, message) { return `<div class="report-section"><div class="section-title">${escapeHtml(title)}</div><p class="empty">${escapeHtml(message)}</p></div>`; }
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function escapeAttr(value) { return escapeHtml(value); }
