const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwvZTzG5xxwFteaho9KUtS7X5yylbtjxBtpSx99IHVYWuZ-12NUQDADdB3jA4CgffIt/exec";

let alignmentData = [];
let trackerData = { podFlat: [], podBob: [], displayFlat: [], displayBob: [] };
const state = { bdm: "", team: "", rep: "", accounts: ["", "", "", "", "", ""], accountBrandGroups: {} };

document.addEventListener("DOMContentLoaded", () => {
  buildAccountSelectors();
  bindEvents();
  resetTrackerViews();
  loadAlignmentData().catch(err => setStatus("Error loading alignment data: " + err.message, true));
});

function bindEvents() {
  const loadTrackerBtn = document.getElementById("loadTrackerBtn");
  const refreshTrackerBtn = document.getElementById("refreshTrackerBtn");
  const printBtn = document.getElementById("printBtn");
  const bdmSelect = document.getElementById("bdmSelect");
  const teamSelect = document.getElementById("teamSelect");
  const repSelect = document.getElementById("repSelect");

  if (loadTrackerBtn) {
    loadTrackerBtn.addEventListener("click", () => {
      loadFilteredTrackerData().catch(err => setStatus("Error loading tracker data: " + err.message, true));
    });
  }

  if (refreshTrackerBtn) {
    refreshTrackerBtn.addEventListener("click", () => {
      loadFilteredTrackerData().catch(err => setStatus("Error refreshing tracker data: " + err.message, true));
    });
  }

  if (printBtn) {
    printBtn.addEventListener("click", () => window.print());
  }

  if (bdmSelect) {
    bdmSelect.addEventListener("change", event => {
      state.bdm = event.target.value;
      state.team = "";
      state.rep = "";
      state.accounts = ["", "", "", "", "", ""];
      state.accountBrandGroups = {};
  
      resetTrackerDataOnly();
      populateAlignmentDropdowns("bdm");
      renderReport();
    });
  }

  if (teamSelect) {
    teamSelect.addEventListener("change", event => {
      state.team = event.target.value;
      state.rep = "";
      state.accounts = ["", "", "", "", "", ""];
      state.accountBrandGroups = {};
  
      // Do not auto-fill BDM from Team alone if multiple BDMs share that Team.
      resolveBdmFromSelection();
  
      resetTrackerDataOnly();
      populateAlignmentDropdowns("team");
      renderReport();
    });
  }

  if (repSelect) {
    repSelect.addEventListener("change", event => {
      state.rep = event.target.value;
      state.accounts = ["", "", "", "", "", ""];
      state.accountBrandGroups = {};
      resetTrackerDataOnly();
      resolveBdmTeamFromRep();
      populateAlignmentDropdowns("rep");
      renderReport();
    });
  }
}

function buildAccountSelectors() {
  const container = document.getElementById("accountSelectors");
  container.innerHTML = "";
  for (let i = 0; i < 6; i++) {
    const label = document.createElement("label");
    label.innerHTML = `Account ${i + 1}<select id="accountSelect${i}"><option value="">Load tracker data first</option></select>`;
    container.appendChild(label);
    label.querySelector("select").addEventListener("change", e => {
      state.accounts[i] = e.target.value;
      renderReport();
    });
  }
}

async function loadAlignmentData() {
  setStatus("Loading BDM alignment data...");
  const result = await postToAppsScript({ action: "getAlignmentData" });
  if (!result.success) throw new Error(result.message || "Could not load alignment data.");
  alignmentData = result.data || [];
  state.bdm = ""; state.team = ""; state.rep = "";
  clearAccountsAndData();
  populateAlignmentDropdowns();
  renderReport();
  setStatus(`Alignment data loaded: ${alignmentData.length.toLocaleString()} rows.`);
}

async function loadFilteredTrackerData() {
  const validation = validateSelectionBeforeLoad();

  if (!validation.ok) {
    setHint(validation.message, true);
    throw new Error(validation.message);
  }

  showLoadingBar("Preparing filters...");
  updateLoadingBar(10, "Preparing filters...");
  setHint("Preparing filtered tracker data...");

  try {
    await wait(250);
    updateLoadingBar(25, "Connecting to Google Sheets...");

    await wait(250);
    updateLoadingBar(40, "Filtering tracker rows...");

    const resultPromise = postToAppsScript({
      action: "getTrackerData",
      filters: {
        bdm: state.bdm,
        team: state.team,
        salesPerson: state.rep
      }
    });

    await wait(350);
    updateLoadingBar(65, "Loading filtered data...");

    const result = await resultPromise;

    if (!result.success) {
      throw new Error(result.message || "Could not load tracker data.");
    }

    updateLoadingBar(80, "Building tracker report...");

    const context = result.context || {};

    if (context.bdm && !state.bdm) state.bdm = context.bdm;
    if (context.team && !state.team) state.team = context.team;
    if (context.salesPerson && !state.rep) state.rep = context.salesPerson;

    trackerData = {
      podFlat: result.data.POD_Flat || [],
      podBob: result.data.POD_BOB_MNY || [],
      displayFlat: result.data.Display_Flat || [],
      displayBob: result.data.Display_BOB || []
    };

    state.accounts = ["", "", "", "", "", ""];
    state.accountBrandGroups = {};

    document.getElementById("podRowCount").textContent =
      trackerData.podFlat.length.toLocaleString();

    document.getElementById("podBobRowCount").textContent =
      trackerData.podBob.length.toLocaleString();

    document.getElementById("displayRowCount").textContent =
      trackerData.displayFlat.length.toLocaleString();

    populateAlignmentDropdowns("loaded");
    populateAccountDropdowns();
    renderReport();

    updateLoadingBar(100, "Tracker data loaded.");
    setHint("Tracker data loaded. Select up to six accounts.");

    hideLoadingBar();

  } catch (error) {
    updateLoadingBar(100, "Something went wrong.");
    setHint(error.message, true);
    hideLoadingBar(1500);
    throw error;
  }
}

async function postToAppsScript(payload) {
  const response = await fetch(APPS_SCRIPT_URL, { method: "POST", body: JSON.stringify(payload) });
  const text = await response.text();
  try { return JSON.parse(text); }
  catch { throw new Error("Apps Script did not return valid JSON. Check the deployment URL and access permissions."); }
}

function populateAlignmentDropdowns(changedField = "") {
  const bdmOptions = getBdmOptions();
  const teamOptions = getTeamOptions();
  const repOptions = getRepOptions();

  fillSelect("bdmSelect", bdmOptions, "Select BDM", state.bdm);
  fillSelect("teamSelect", teamOptions, "Select Team", state.team);
  fillSelect("repSelect", repOptions, "Select Sales Person", state.rep);

  updateSelectionHint();
}

function getBdmOptions() {
  let rows = alignmentData;

  if (state.rep) {
    rows = rows.filter(row =>
      same(getField(row, ["Sales Person"]), state.rep)
    );
  }

  return uniqueSorted(
    rows
      .map(row => getField(row, ["BDM"]))
      .filter(Boolean)
  );
}
function getTeamOptions() {
  let rows = alignmentData;

  if (state.bdm) {
    rows = rows.filter(row =>
      same(getField(row, ["BDM"]), state.bdm)
    );
  }

  if (state.rep) {
    rows = rows.filter(row =>
      same(getField(row, ["Sales Person"]), state.rep)
    );
  }

  return uniqueSorted(
    rows
      .map(row => getField(row, ["Team"]))
      .filter(Boolean)
  );
}
function getRepOptions() {
  let rows = alignmentData;

  if (state.bdm) {
    rows = rows.filter(row =>
      same(getField(row, ["BDM"]), state.bdm)
    );
  }

  if (state.team) {
    rows = rows.filter(row =>
      same(getField(row, ["Team"]), state.team)
    );
  }

  return uniqueSorted(
    rows
      .map(row => getField(row, ["Sales Person"]))
      .filter(Boolean)
  );
}
function resolveBdmFromTeamIfUnique() {
  if (!state.team) return;
  const matches = alignmentData.filter(row => same(getField(row, ["Team"]), state.team));
  const bdms = uniqueSorted(matches.map(row => getField(row, ["BDM"])).filter(Boolean));
  state.bdm = bdms.length === 1 ? bdms[0] : "";
}
function resolveBdmTeamFromRep() {
  if (!state.rep) return;
  let matches = alignmentData.filter(row => same(getField(row, ["Sales Person"]), state.rep));
  if (state.team) matches = matches.filter(row => same(getField(row, ["Team"]), state.team));
  if (state.bdm) matches = matches.filter(row => same(getField(row, ["BDM"]), state.bdm));
  if (!matches.length) return;
  state.bdm = getField(matches[0], ["BDM"]);
  state.team = getField(matches[0], ["Team"]);
}
function validateSelectionBeforeLoad() {
  if (state.rep || state.bdm) return { ok: true, message: "" };
  if (state.team && !state.rep) return { ok: false, message: "Please select a Sales Person for this Team so the correct BDM can be identified." };
  return { ok: false, message: "Please select a BDM or Sales Person before loading tracker data." };
}
function updateSelectionHint() {
  if (!alignmentData.length) return setHint("Load alignment data first.");
  if (state.team && !state.rep && !state.bdm) return setHint("This Team has multiple BDMs. Select a Sales Person so the correct BDM can be identified.", true);
  if (state.rep) return setHint(`Ready to load data for ${state.rep}.`);
  if (state.bdm) return setHint(`Ready to load data for BDM: ${state.bdm}.`);
  if (state.team) return setHint("Select a Sales Person for this Team before loading tracker data.", true);
  setHint("Select a BDM, Team, or Sales Person to begin.");
}

function populateAccountDropdowns() {
  const accounts = getAccountsByLoadedContext();
  for (let i = 0; i < 6; i++) fillSelect(`accountSelect${i}`, accounts, "Select Account", state.accounts[i]);
}
function getAccountsByLoadedContext() {
  let rows = trackerData.podBob || [];
  if (state.rep) rows = rows.filter(row => same(getField(row, ["Sales Person"]), state.rep));
  else if (state.team) rows = rows.filter(row => same(getField(row, ["Team"]), state.team));
  return uniqueSorted(rows.map(row => getField(row, ["Customer"])).filter(Boolean));
}

function renderReport() {
  const parts = [];
  if (state.bdm) parts.push(`BDM: ${state.bdm}`);
  if (state.team) parts.push(`Team: ${state.team}`);
  if (state.rep) parts.push(`Sales Person: ${state.rep}`);
  document.getElementById("reportSubTitle").textContent = parts.length ? parts.join(" • ") : "Select BDM, Team, or Sales Person, then load tracker data.";
  renderPodBtg(); renderDisplayBtg(); renderAccountBreakdowns(); renderDisplayAccountDetails();
}
function renderPodBtg() {
  const section = document.getElementById("podBtgSection");
  if (!trackerData.podFlat.length) return section.innerHTML = emptySection("POD BTG", "Load tracker data to see POD BTG.");
  const brands = uniqueSorted(trackerData.podFlat.filter(row => isOffPremise(getField(row, ["Premise"]))).map(row => getField(row, ["Brand"])).filter(Boolean));
  const rows = brands.map(brand => {
    const selectedRows = trackerData.podFlat.filter(row => isOffPremise(getField(row, ["Premise"])) && (!state.rep || same(getField(row, ["Sales Person"]), state.rep)) && same(getField(row, ["Brand"]), brand));
    const teamRows = trackerData.podFlat.filter(row => isOffPremise(getField(row, ["Premise"])) && (!state.team || same(getField(row, ["Team"]), state.team)) && same(getField(row, ["Brand"]), brand));
    const selectedActual = sum(selectedRows, ["POD Act"]), selectedGoal = sum(selectedRows, ["POD Goal"]), teamActual = sum(teamRows, ["POD Act"]), teamGoal = sum(teamRows, ["POD Goal"]);
    return { brand, selectedBtg: selectedActual - selectedGoal, selectedAch: percent(selectedActual, selectedGoal), teamBtg: teamActual - teamGoal, teamAch: percent(teamActual, teamGoal) };
  });
  section.innerHTML = `<div class="report-section"><div class="section-title">POD BTG</div><div class="table-wrap"><table><thead><tr><th>Brand</th><th class="numeric">Selection BTG</th><th class="numeric">Selection % Ach</th><th class="numeric">Team BTG</th><th class="numeric">Team % Ach</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.brand)}</td><td class="numeric ${row.selectedBtg < 0 ? "bad" : "good"}">${formatNumber(row.selectedBtg)}</td><td class="numeric">${formatPercent(row.selectedAch)}</td><td class="numeric ${row.teamBtg < 0 ? "bad" : "good"}">${formatNumber(row.teamBtg)}</td><td class="numeric">${formatPercent(row.teamAch)}</td></tr>`).join("")}</tbody></table></div></div>`;
}
function renderDisplayBtg() {
  const section = document.getElementById("displayBtgSection");
  if (!trackerData.displayFlat.length) return section.innerHTML = emptySection("Display BTG", "Load tracker data to see Display BTG.");
  const brands = uniqueSorted(trackerData.displayFlat.filter(row => isOffPremise(getField(row, ["Premise"]))).map(row => getField(row, ["Brand"])).filter(Boolean));
  const rows = brands.map(brand => {
    const selectedRows = trackerData.displayFlat.filter(row => isOffPremise(getField(row, ["Premise"])) && (!state.rep || same(getField(row, ["Sales Person"]), state.rep)) && same(getField(row, ["Brand"]), brand));
    const teamRows = trackerData.displayFlat.filter(row => isOffPremise(getField(row, ["Premise"])) && (!state.team || same(getField(row, ["Team"]), state.team)) && same(getField(row, ["Brand"]), brand));
    const selectedActual = sum(selectedRows, ["Display Act"]), selectedGoal = sum(selectedRows, ["Display Goal"]), teamActual = sum(teamRows, ["Display Act"]), teamGoal = sum(teamRows, ["Display Goal"]);
    return { brand, selectedBtg: selectedActual - selectedGoal, selectedAch: percent(selectedActual, selectedGoal), teamBtg: teamActual - teamGoal, teamAch: percent(teamActual, teamGoal) };
  });
  section.innerHTML = `<div class="report-section"><div class="section-title">Display BTG</div><div class="table-wrap"><table><thead><tr><th>Brand</th><th class="numeric">Selection BTG</th><th class="numeric">Selection % Ach</th><th class="numeric">Team BTG</th><th class="numeric">Team % Ach</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.brand)}</td><td class="numeric ${row.selectedBtg < 0 ? "bad" : "good"}">${formatNumber(row.selectedBtg)}</td><td class="numeric">${formatPercent(row.selectedAch)}</td><td class="numeric ${row.teamBtg < 0 ? "bad" : "good"}">${formatNumber(row.teamBtg)}</td><td class="numeric">${formatPercent(row.teamAch)}</td></tr>`).join("")}</tbody></table></div></div>`;
}
function renderAccountBreakdowns() {
  const section = document.getElementById("accountBreakdownSection");
  const accounts = state.accounts.filter(Boolean);
  if (!trackerData.podBob.length) return section.innerHTML = emptySection("Account POD Details", "Load tracker data to see account-level POD details.");
  if (!accounts.length) return section.innerHTML = emptySection("Account POD Details", "Select at least one account to see account-level POD details.");
  section.innerHTML = `<div class="report-section"><div class="section-title">Account POD Details</div>${accounts.map(renderAccountCard).join("")}</div>`;
  bindBrandGroupDropdowns();
}
function renderAccountCard(account) {
  const rows = trackerData.podBob.filter(row => same(getField(row, ["Customer"]), account));
  const brandGroups = uniqueSorted(rows.map(row => getField(row, ["Brand Group"])).filter(Boolean));
  if (!brandGroups.length) return `<div class="account-card"><h3>${escapeHtml(account)}</h3><p class="empty">No account-level POD detail found for this account.</p></div>`;
  const selectedBrandGroup = state.accountBrandGroups[account] || brandGroups[0];
  state.accountBrandGroups[account] = selectedBrandGroup;
  const detailRows = rows.filter(row => same(getField(row, ["Brand Group"]), selectedBrandGroup)).map(row => ({ brand: getField(row, ["Brand"]), pods: Number(getField(row, ["PODs"]) || 0) })).filter(row => row.brand);
  return `<div class="account-card"><div class="account-card-header"><h3>${escapeHtml(account)}</h3><label class="mini-filter">Brand Group<select class="brand-group-select" data-account="${escapeAttr(account)}">${brandGroups.map(group => `<option value="${escapeAttr(group)}" ${same(group, selectedBrandGroup) ? "selected" : ""}>${escapeHtml(group)}</option>`).join("")}</select></label></div><div class="table-wrap"><table><thead><tr><th>Brand</th><th class="numeric">PODs</th></tr></thead><tbody>${detailRows.map(row => `<tr><td>${escapeHtml(row.brand)}</td><td class="numeric">${formatPodIcon(row.pods)}</td></tr>`).join("")}</tbody></table></div></div>`;
}
function bindBrandGroupDropdowns() { document.querySelectorAll(".brand-group-select").forEach(select => select.addEventListener("change", e => { state.accountBrandGroups[e.target.dataset.account] = e.target.value; renderAccountBreakdowns(); })); }
function renderDisplayAccountDetails() {
  const section = document.getElementById("displayAccountSection");
  const accounts = state.accounts.filter(Boolean);
  if (!trackerData.displayBob.length || !accounts.length) return section.innerHTML = "";
  section.innerHTML = `<div class="report-section"><div class="section-title">Account Display Details</div>${accounts.map(renderDisplayAccountTable).join("")}</div>`;
}
function renderDisplayAccountTable(account) {
  const accountRows = trackerData.displayBob.filter(row => same(getField(row, ["Customer"]), account));
  if (!accountRows.length) return `<div class="account-card"><h3>${escapeHtml(account)} Display Details</h3><p class="empty">No display detail found for this account.</p></div>`;
  const months = orderMonths(uniqueSorted(accountRows.map(row => getField(row, ["Month"])).filter(Boolean)));
  const families = uniqueSorted(accountRows.map(row => getField(row, ["Brand Goal Group"])).filter(Boolean));
  const rows = families.map(family => ({ family, statuses: months.map(month => accountRows.some(row => same(getField(row, ["Brand Goal Group"]), family) && same(getField(row, ["Month"]), month) && Number(getField(row, ["Qualifier Met"]) || 0) !== 0) ? "Yes" : "No") }));
  return `<div class="account-card"><h3>${escapeHtml(account)} Display Details</h3><div class="table-wrap"><table><thead><tr><th>Brand Family</th>${months.map(month => `<th>${escapeHtml(month)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.family)}</td>${row.statuses.map(status => `<td>${status === "Yes" ? '<span class="yes-pill">Yes</span>' : '<span class="no-pill">No</span>'}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
}
function clearAccountsAndData() { state.accounts = ["", "", "", "", "", ""]; state.accountBrandGroups = {}; resetTrackerDataOnly(); }
function resetTrackerDataOnly() { trackerData = { podFlat: [], podBob: [], displayFlat: [], displayBob: [] }; document.getElementById("podRowCount").textContent = "0"; document.getElementById("podBobRowCount").textContent = "0"; document.getElementById("displayRowCount").textContent = "0"; populateAccountDropdowns(); }
function resetTrackerViews() { resetTrackerDataOnly(); renderReport(); }
function fillSelect(id, values, placeholder, selectedValue) { const select = document.getElementById(id); select.innerHTML = `<option value="">${placeholder}</option>` + values.map(value => `<option value="${escapeAttr(value)}">${escapeHtml(value)}</option>`).join(""); if (selectedValue && values.includes(selectedValue)) select.value = selectedValue; }
function getField(row, candidates) { const keys = Object.keys(row || {}); const map = new Map(keys.map(key => [normalizeKey(key), key])); for (const candidate of candidates) { const key = map.get(normalizeKey(candidate)); if (key !== undefined) { const value = row[key]; return typeof value === "string" ? value.trim() : value; } } return ""; }
function sum(rows, candidates) { return rows.reduce((total, row) => { const value = Number(getField(row, candidates) || 0); return total + (Number.isFinite(value) ? value : 0); }, 0); }
function percent(actual, goal) { const a = Number(actual || 0), g = Number(goal || 0); return g ? a / g : null; }
function uniqueSorted(values) { return [...new Set(values.map(v => String(v || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)); }
function normalizeKey(value) { return String(value || "").toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9]/g, ""); }
function same(a, b) { return String(a || "").trim().toUpperCase() === String(b || "").trim().toUpperCase(); }
function isOffPremise(value) { const v = String(value || "").trim().toUpperCase(); return v === "OFF" || v === "OFF PREMISE" || v.includes("OFF"); }
function beforeParen(value) { return String(value || "").split("(")[0].trim(); }
function formatNumber(value) { const n = Number(value || 0); return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : ""; }
function formatPercent(value) { return value === null || value === undefined || value === "" ? "" : Number(value).toLocaleString(undefined, { style: "percent", maximumFractionDigits: 1 }); }
function formatPodIcon(value) { const n = Number(value || 0); if (n === 1) return "✅"; if (n === 0) return "❌"; return escapeHtml(n); }
function orderMonths(months) { const order = { JAN:1, JANUARY:1, FEB:2, FEBRUARY:2, MAR:3, MARCH:3, APR:4, APRIL:4, MAY:5, JUN:6, JUNE:6, JUL:7, JULY:7, AUG:8, AUGUST:8, SEP:9, SEPTEMBER:9, OCT:10, OCTOBER:10, NOV:11, NOVEMBER:11, DEC:12, DECEMBER:12 }; return months.sort((a, b) => (order[String(a).trim().toUpperCase()] || 999) - (order[String(b).trim().toUpperCase()] || 999) || String(a).localeCompare(String(b))); }
function setStatus(message, isError = false) {
  console.log(isError ? "Error:" : "Status:", message);
}
function setHint(message, isWarning = false) { const el = document.getElementById("selectionHint"); el.textContent = message; el.classList.toggle("warning", Boolean(isWarning)); }
function emptySection(title, message) { return `<div class="report-section"><div class="section-title">${escapeHtml(title)}</div><p class="empty">${escapeHtml(message)}</p></div>`; }
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function escapeAttr(value) { return escapeHtml(value); }

function showLoadingBar(message = "Loading tracker data...") {
  const wrap = document.getElementById("loadingBarWrap");
  const text = document.getElementById("loadingText");
  const percent = document.getElementById("loadingPercent");
  const bar = document.getElementById("loadingBar");

  if (!wrap || !text || !percent || !bar) return;

  wrap.classList.remove("hidden");
  text.textContent = message;
  percent.textContent = "0%";
  bar.style.width = "0%";
}

function updateLoadingBar(value, message = "") {
  const text = document.getElementById("loadingText");
  const percent = document.getElementById("loadingPercent");
  const bar = document.getElementById("loadingBar");

  if (!text || !percent || !bar) return;

  const safeValue = Math.max(0, Math.min(100, value));

  if (message) text.textContent = message;

  percent.textContent = `${safeValue}%`;
  bar.style.width = `${safeValue}%`;
}

function hideLoadingBar(delay = 700) {
  const wrap = document.getElementById("loadingBarWrap");

  if (!wrap) return;

  setTimeout(() => {
    wrap.classList.add("hidden");
  }, delay);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
