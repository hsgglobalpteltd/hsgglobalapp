// iB - Staff Claims & Expenses App (Project 3)
const WORKER_URL = "https://ib-v2.hsgglobalpteltd.workers.dev";
const MAX_BATCH_LIMIT = 100.00;

// Global State
let currentUser = null; // { id, name, email, role, paynow_number, pin }
let allEmployees = [];
let adminsList = [];
let unsubmittedExpenses = [];
let submittedBatches = [];
let selectedExpenseIds = new Set();
let capturedReceiptData = null; // { src, name, type }

// Desktop Redirect Check (Mobile-only constraint)
if (window.innerWidth > 600) {
  window.location.href = '../index.html';
}

// ============================================================================
// INITIALIZATION
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
  initApp();
});

async function initApp() {
  // Set default date to today
  const dateInput = document.getElementById("input-date");
  if (dateInput) {
    dateInput.value = new Date().toISOString().split("T")[0];
  }

  // Bind PIN hidden input events
  bindPinKeypad();

  // Load employees database
  await loadEmployeesData();

  // Check saved session in localStorage
  const cachedUser = getCachedAuth();
  if (cachedUser) {
    currentUser = cachedUser;
    showMainApp();
    await refreshData();
  } else {
    showAuthGatekeeper();
  }
}

// Format date helper (dd/mm/yyyy)
function formatDateDisplay(dStr) {
  if (!dStr) return "";
  if (dStr.includes("-")) {
    const parts = dStr.split("-");
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dStr;
}

// Format PayNow helper (strips +65 and spaces)
function formatCleanPayNow(val) {
  if (!val) return "";
  let clean = String(val).trim().replace(/[\s-]/g, "");
  if (clean.startsWith("+65")) {
    clean = clean.substring(3);
  } else if (clean.startsWith("65") && clean.length === 10) {
    clean = clean.substring(2);
  }
  return clean;
}

// ============================================================================
// AUTHENTICATION & PIN GATEKEEPER
// ============================================================================
async function loadEmployeesData() {
  try {
    const res = await fetch(`${WORKER_URL}/api/employees`);
    if (res.ok) {
      const data = await res.json();
      allEmployees = Array.isArray(data) ? data : [];
    }
  } catch (err) {
    console.error("Failed to load employees:", err);
  }
}

function bindPinKeypad() {
  const hiddenInput = document.getElementById("auth-pin-hidden");
  const wrapper = document.getElementById("pin-digits-wrapper");
  const displays = document.querySelectorAll(".pin-digit-display");

  if (wrapper && hiddenInput) {
    wrapper.addEventListener("click", () => {
      hiddenInput.focus();
    });
  }

  if (hiddenInput) {
    hiddenInput.addEventListener("input", (e) => {
      const val = hiddenInput.value.replace(/\D/g, "").substring(0, 4);
      hiddenInput.value = val;

      displays.forEach((d, idx) => {
        if (idx < val.length) {
          d.textContent = "•";
          d.classList.add("active");
        } else {
          d.textContent = "";
          d.classList.remove("active");
        }
      });

      if (val.length === 4) {
        verifyPin(val);
      }
    });
  }
}

function clearAuthPin() {
  const hiddenInput = document.getElementById("auth-pin-hidden");
  const displays = document.querySelectorAll(".pin-digit-display");
  if (hiddenInput) {
    hiddenInput.value = "";
    hiddenInput.focus();
  }
  displays.forEach((d) => {
    d.textContent = "";
    d.classList.remove("active", "error");
  });
}

async function verifyPin(pinStr) {
  const enteredPin = parseInt(pinStr, 10);
  const matched = allEmployees.find(
    (e) => parseInt(e.pin, 10) === enteredPin || parseInt(e.PIN, 10) === enteredPin
  );

  if (!matched) {
    const displays = document.querySelectorAll(".pin-digit-display");
    displays.forEach((d) => d.classList.add("error"));
    showToast("Incorrect PIN. Please try again.", "error");

    setTimeout(() => {
      clearAuthPin();
    }, 600);
    return;
  }

  // Bind employee details
  const cleanPayNow = formatCleanPayNow(matched.paynow_number || matched.phone || "");
  currentUser = {
    id: matched.id || "",
    name: matched.name || matched.full_name || "Staff",
    email: (matched.email || "").toLowerCase().trim(),
    role: matched.role || "",
    paynow_number: cleanPayNow,
    pin: pinStr
  };

  // Cache session for 30 minutes
  setCachedAuth(currentUser);

  showToast(`Welcome, ${currentUser.name}!`, "success");
  showMainApp();
  await refreshData();
}

function getCachedAuth() {
  const userStr = localStorage.getItem("staff_claims_user");
  const expireStr = localStorage.getItem("staff_claims_expire");
  if (!userStr || !expireStr) return null;

  if (Date.now() > parseInt(expireStr, 10)) {
    clearCachedAuth();
    return null;
  }

  try {
    return JSON.parse(userStr);
  } catch (_) {
    return null;
  }
}

function setCachedAuth(user) {
  const expire = Date.now() + 30 * 60 * 1000; // 30 mins
  localStorage.setItem("staff_claims_user", JSON.stringify(user));
  localStorage.setItem("staff_claims_expire", expire.toString());
}

function clearCachedAuth() {
  localStorage.removeItem("staff_claims_user");
  localStorage.removeItem("staff_claims_expire");
  currentUser = null;
  showAuthGatekeeper();
}

function showAuthGatekeeper() {
  document.getElementById("auth-page").style.display = "flex";
  document.getElementById("main-app").classList.remove("active");
  clearAuthPin();
}

function showMainApp() {
  document.getElementById("auth-page").style.display = "none";
  document.getElementById("main-app").classList.add("active");

  // Setup header buttons
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.onclick = () => {
      clearCachedAuth();
      showToast("Logged out successfully.", "info");
    };
  }

  const paynowHeaderBtn = document.getElementById("header-paynow-btn");
  if (paynowHeaderBtn) {
    paynowHeaderBtn.onclick = () => openPayNowModal();
  }

  updatePayNowBanner();
}

function updatePayNowBanner() {
  const banner = document.getElementById("paynow-missing-banner");
  if (banner) {
    if (!currentUser || !currentUser.paynow_number) {
      banner.style.display = "flex";
    } else {
      banner.style.display = "none";
    }
  }
}

// ============================================================================
// DATA FETCHING (EXPENSES, BATCHES, ADMINS)
// ============================================================================
async function refreshData() {
  if (!currentUser || !currentUser.email) return;

  const emailParam = encodeURIComponent(currentUser.email);

  try {
    // 1. Fetch expenses
    const expRes = await fetch(`${WORKER_URL}/api/claims/operator/expenses?email=${emailParam}`);
    if (expRes.ok) {
      const exps = await expRes.json();
      unsubmittedExpenses = (Array.isArray(exps) ? exps : []).filter((e) => e.status === "unsubmitted");
      renderLedger();
    }

    // 2. Fetch submitted batches
    const batRes = await fetch(`${WORKER_URL}/api/claims/operator/batches?email=${emailParam}`);
    if (batRes.ok) {
      const bats = await batRes.json();
      submittedBatches = Array.isArray(bats) ? bats : [];
      renderBatches();
    }

    // 3. Fetch administrators list for dropdown
    const adminRes = await fetch(`${WORKER_URL}/api/claims/admins`);
    if (adminRes.ok) {
      const admins = await adminRes.json();
      adminsList = Array.isArray(admins) ? admins : [];
    }
  } catch (err) {
    console.error("Failed to load claims data:", err);
  }
}

// ============================================================================
// TAB NAVIGATION
// ============================================================================
function switchTab(tabId) {
  const logView = document.getElementById("view-log");
  const ledgerView = document.getElementById("view-ledger");
  const batchesView = document.getElementById("view-batches");
  const ledgerFooter = document.getElementById("ledger-footer-bar");

  const tabLog = document.getElementById("tab-log");
  const tabLedger = document.getElementById("tab-ledger");
  const tabBatches = document.getElementById("tab-batches");

  [tabLog, tabLedger, tabBatches].forEach((btn) => btn.classList.remove("active"));
  logView.style.display = "none";
  ledgerView.style.display = "none";
  batchesView.style.display = "none";
  ledgerFooter.style.display = "none";

  if (tabId === "log") {
    tabLog.classList.add("active");
    logView.style.display = "flex";
  } else if (tabId === "ledger") {
    tabLedger.classList.add("active");
    ledgerView.style.display = "flex";
    ledgerFooter.style.display = "flex";
    renderLedger();
  } else if (tabId === "batches") {
    tabBatches.classList.add("active");
    batchesView.style.display = "flex";
    renderBatches();
  }
}

// ============================================================================
// VIEW 1: LOG EXPENSE (CAMERA, COMPRESS, & SAVE)
// ============================================================================
function triggerCamera() {
  const input = document.getElementById("receipt-file-input");
  if (input) input.click();
}

function setQuickDesc(text) {
  const input = document.getElementById("input-description");
  if (input) {
    input.value = text;
    input.focus();
  }
}

async function handleFileSelected(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  showToast("Processing & optimizing photo...", "info");

  try {
    const compressed = await compressImageToMax250kb(file);
    const reader = new FileReader();

    reader.onload = (e) => {
      capturedReceiptData = {
        src: e.target.result,
        name: file.name || "receipt.jpg",
        type: file.type || "image/jpeg"
      };

      const previewImg = document.getElementById("receipt-preview-img");
      const placeholder = document.getElementById("camera-placeholder");

      if (previewImg && placeholder) {
        previewImg.src = capturedReceiptData.src;
        previewImg.style.display = "block";
        placeholder.style.display = "none";
      }

      showToast("Receipt photo ready!", "success");
    };

    reader.readAsDataURL(compressed);
  } catch (err) {
    console.error("Compression error:", err);
    showToast("Failed to process photo: " + err.message, "error");
  }
}

async function compressImageToMax250kb(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;

        const maxDim = 1200;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) return reject(new Error("Canvas blob failed"));
            const compressedFile = new File([blob], file.name || "receipt.jpg", {
              type: "image/jpeg",
              lastModified: Date.now()
            });
            resolve(compressedFile);
          },
          "image/jpeg",
          0.75
        );
      };
      img.onerror = (err) => reject(err);
      img.src = e.target.result;
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

async function handleSaveExpense(event) {
  event.preventDefault();

  if (!currentUser || !currentUser.email) {
    showToast("Session expired. Please log in again.", "error");
    showAuthGatekeeper();
    return;
  }

  const amountVal = parseFloat(document.getElementById("input-amount").value);
  const descVal = document.getElementById("input-description").value.trim();
  const dateVal = document.getElementById("input-date").value;
  const remarksVal = document.getElementById("input-remarks").value.trim();

  if (!amountVal || amountVal <= 0 || !descVal) {
    showToast("Please enter a valid amount and description.", "warning");
    return;
  }

  if (!capturedReceiptData) {
    showToast("Receipt photo is mandatory for all expense records.", "warning");
    return;
  }

  const saveBtn = document.getElementById("btn-save-expense");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving to Ledger...";

  try {
    const payload = {
      user_email: currentUser.email,
      user_name: currentUser.name,
      employee_id: currentUser.id,
      employee_name: currentUser.name,
      employee_role: currentUser.role,
      paynow_number: currentUser.paynow_number,
      date: dateVal,
      description: descVal,
      amount: amountVal,
      remarks: remarksVal,
      receipt: capturedReceiptData
    };

    const res = await fetch(`${WORKER_URL}/api/claims/operator/expense/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(await res.text());

    showToast("Expense recorded successfully!", "success");

    // Reset Form
    document.getElementById("input-amount").value = "";
    document.getElementById("input-description").value = "";
    document.getElementById("input-remarks").value = "";
    capturedReceiptData = null;

    const previewImg = document.getElementById("receipt-preview-img");
    const placeholder = document.getElementById("camera-placeholder");
    if (previewImg) previewImg.style.display = "none";
    if (placeholder) placeholder.style.display = "flex";

    await refreshData();
    switchTab("ledger");
  } catch (err) {
    console.error("Save expense error:", err);
    showToast("Failed to save expense: " + err.message, "error");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save to Ledger";
  }
}

// ============================================================================
// VIEW 2: MY LEDGER & BATCH SELECTION (<= $100)
// ============================================================================
function renderLedger() {
  const container = document.getElementById("ledger-list-container");
  const badge = document.getElementById("ledger-count-badge");
  if (!container) return;

  if (badge) badge.textContent = unsubmittedExpenses.length;

  if (unsubmittedExpenses.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: #94A3B8;">
        <svg style="width: 48px; height: 48px; margin-bottom: 10px; stroke: #CBD5E1;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
        <div style="font-size: 14px; font-weight: 700; color: #475569;">Ledger is empty</div>
        <div style="font-size: 12px; margin-top: 4px;">Tap "Log Expense" to snap and record a receipt.</div>
      </div>
    `;
    updateLedgerCalculations();
    return;
  }

  let html = "";
  unsubmittedExpenses.forEach((exp) => {
    const isSelected = selectedExpenseIds.has(exp.id);
    html += `
      <div class="ledger-item-card ${isSelected ? 'selected' : ''}" onclick="toggleSelectExpense('${exp.id}')">
        <div class="ledger-item-checkbox">
          ${isSelected ? `
            <svg viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3" style="width: 16px; height: 16px;">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          ` : ''}
        </div>

        ${exp.receipt_url ? `
          <img src="${exp.receipt_url}" class="ledger-item-thumb" onclick="event.stopPropagation(); showLightbox('${exp.receipt_url}')" alt="Receipt">
        ` : `
          <div class="ledger-item-thumb" style="display: flex; align-items: center; justify-content: center;">
            <svg viewBox="0 0 24 24" fill="none" stroke="#94A3B8" stroke-width="2" style="width: 20px; height: 20px;">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
            </svg>
          </div>
        `}

        <div class="ledger-item-info">
          <span class="ledger-item-desc">${exp.description}</span>
          <span class="ledger-item-date">${formatDateDisplay(exp.date)} ${exp.remarks ? `• ${exp.remarks}` : ''}</span>
        </div>

        <span class="ledger-item-amount">$${Number(exp.amount || 0).toFixed(2)}</span>
      </div>
    `;
  });

  container.innerHTML = html;
  updateLedgerCalculations();
}

function toggleSelectExpense(expId) {
  if (selectedExpenseIds.has(expId)) {
    selectedExpenseIds.delete(expId);
  } else {
    selectedExpenseIds.add(expId);
  }
  renderLedger();
}

function updateLedgerCalculations() {
  const selectedExps = unsubmittedExpenses.filter((e) => selectedExpenseIds.has(e.id));
  const total = selectedExps.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const roundedTotal = Number(total.toFixed(2));
  const isOverLimit = roundedTotal > MAX_BATCH_LIMIT;

  const countEl = document.getElementById("calc-selected-count");
  const totalEl = document.getElementById("calc-total-val");
  const submitBtn = document.getElementById("btn-submit-batch");

  if (countEl) countEl.textContent = `${selectedExps.length} of ${unsubmittedExpenses.length} selected`;
  if (totalEl) {
    totalEl.textContent = `$${roundedTotal.toFixed(2)}`;
    if (isOverLimit) {
      totalEl.classList.add("over-limit");
    } else {
      totalEl.classList.remove("over-limit");
    }
  }

  if (submitBtn) {
    if (selectedExps.length > 0 && !isOverLimit) {
      submitBtn.disabled = false;
      submitBtn.textContent = `Submit Claim Batch ($${roundedTotal.toFixed(2)})`;
    } else if (isOverLimit) {
      submitBtn.disabled = true;
      submitBtn.textContent = `Limit Exceeded ($${roundedTotal.toFixed(2)} / $100 max)`;
    } else {
      submitBtn.disabled = true;
      submitBtn.textContent = "Select Items to Submit";
    }
  }
}

// ============================================================================
// BATCH SUBMISSION MODAL
// ============================================================================
function openSubmitBatchModal() {
  const selectedExps = unsubmittedExpenses.filter((e) => selectedExpenseIds.has(e.id));
  const total = selectedExps.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const roundedTotal = Number(total.toFixed(2));

  if (!currentUser.paynow_number || !currentUser.paynow_number.trim()) {
    showToast("Please register your PayNow number before submitting a batch.", "warning");
    openPayNowModal();
    return;
  }

  document.getElementById("modal-employee-name").textContent = currentUser.name;
  document.getElementById("modal-paynow-num").textContent = `PayNow: ${currentUser.paynow_number}`;
  document.getElementById("modal-batch-total").textContent = `$${roundedTotal.toFixed(2)}`;

  // Populate Admin select
  const selectEl = document.getElementById("modal-admin-select");
  if (selectEl) {
    if (adminsList.length === 0) {
      selectEl.innerHTML = '<option value="">No administrators found</option>';
    } else {
      selectEl.innerHTML = adminsList
        .map((a) => `<option value="${a.email}">${a.name} (${a.email})</option>`)
        .join("");
    }
  }

  document.getElementById("submit-batch-modal").classList.add("active");
}

function closeSubmitBatchModal() {
  document.getElementById("submit-batch-modal").classList.remove("active");
}

async function executeBatchSubmit() {
  const selectEl = document.getElementById("modal-admin-select");
  const targetAdminEmail = selectEl ? selectEl.value : "";

  if (!targetAdminEmail) {
    showToast("Please select an administrator to route this claim.", "warning");
    return;
  }

  const matchedAdmin = adminsList.find((a) => a.email.toLowerCase() === targetAdminEmail.toLowerCase());
  const adminName = matchedAdmin?.name || targetAdminEmail;

  const confirmBtn = document.getElementById("btn-confirm-batch-submit");
  confirmBtn.disabled = true;
  confirmBtn.textContent = "Submitting...";

  try {
    const payload = {
      user_email: currentUser.email,
      user_name: currentUser.name,
      employee_id: currentUser.id,
      employee_name: currentUser.name,
      employee_role: currentUser.role,
      paynow_number: currentUser.paynow_number,
      target_admin_email: targetAdminEmail,
      target_admin_name: adminName,
      expense_ids: Array.from(selectedExpenseIds)
    };

    const res = await fetch(`${WORKER_URL}/api/claims/operator/batch/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(await res.text());

    showToast(`Claim batch submitted to ${adminName}!`, "success");
    closeSubmitBatchModal();
    selectedExpenseIds.clear();

    await refreshData();
    switchTab("batches");
  } catch (err) {
    console.error("Batch submission failed:", err);
    showToast("Submission failed: " + err.message, "error");
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = "Confirm & Submit";
  }
}

// ============================================================================
// VIEW 3: SUBMITTED BATCHES TRACKER
// ============================================================================
function renderBatches() {
  const container = document.getElementById("batches-list-container");
  if (!container) return;

  if (submittedBatches.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: #94A3B8;">
        <svg style="width: 48px; height: 48px; margin-bottom: 10px; stroke: #CBD5E1;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
        <div style="font-size: 14px; font-weight: 700; color: #475569;">No claims submitted yet</div>
        <div style="font-size: 12px; margin-top: 4px;">Submitted batches will show review and PayNow payout status here.</div>
      </div>
    `;
    return;
  }

  let html = "";
  submittedBatches.forEach((batch) => {
    const isPaid = batch.status === "paid" || batch.status === "claimed_to_finance";
    const isRejected = batch.status === "rejected";

    const statusPill = isPaid
      ? `<span class="status-pill paid">✓ Paid by Supervisor</span>`
      : isRejected
      ? `<span class="status-pill rejected">✕ Rejected</span>`
      : `<span class="status-pill pending">⏳ Pending Review</span>`;

    const items = Array.isArray(batch.items) ? batch.items : [];

    html += `
      <div class="batch-card">
        <div class="batch-header">
          <div>
            <span class="batch-id">${batch.id}</span>
            <span style="font-size: 11px; color: #64748B; display: block; margin-top: 2px;">
              ${formatDateDisplay(batch.claim_date)} • To: <strong>${batch.target_admin_name || 'Admin'}</strong>
            </span>
          </div>
          <div style="text-align: right;">
            <span style="font-size: 16px; font-weight: 800; color: #0F172A; font-family: monospace; display: block;">
              $${Number(batch.total_amount || 0).toFixed(2)}
            </span>
            ${statusPill}
          </div>
        </div>

        ${isPaid && batch.payment_reference ? `
          <div style="font-size: 11px; color: #065F46; background-color: #ECFDF5; padding: 6px 10px; border-radius: 6px; font-family: monospace; font-weight: 700;">
            PayNow Ref: ${batch.payment_reference}
          </div>
        ` : ''}

        ${isRejected && batch.reject_reason ? `
          <div style="font-size: 11px; color: #991B1B; background-color: #FEF2F2; padding: 6px 10px; border-radius: 6px;">
            Reason: ${batch.reject_reason}
          </div>
        ` : ''}

        <div style="display: flex; flex-direction: column; gap: 6px; border-top: 1px solid #F8FAFC; padding-top: 6px;">
          ${items.map((it) => `
            <div style="display: flex; align-items: center; justify-content: space-between; font-size: 12px;">
              <span style="font-weight: 600; color: #334155; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-right: 8px;">
                ${it.description}
              </span>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-weight: 700; color: #0F172A; font-family: monospace;">$${Number(it.amount || 0).toFixed(2)}</span>
                ${it.receipt_url ? `
                  <button type="button" onclick="showLightbox('${it.receipt_url}')" style="padding: 2px 6px; font-size: 10px; font-weight: 700; background-color: #EFF6FF; color: #1D4ED8; border: 1px solid #BFDBFE; border-radius: 4px; cursor: pointer;">
                    Receipt
                  </button>
                ` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

// ============================================================================
// PAYNOW QUICK UPDATE MODAL
// ============================================================================
function openPayNowModal() {
  const input = document.getElementById("modal-paynow-input");
  if (input && currentUser) {
    input.value = currentUser.paynow_number || "";
  }
  document.getElementById("paynow-modal").classList.add("active");
}

function closePayNowModal() {
  document.getElementById("paynow-modal").classList.remove("active");
}

async function handleSavePayNow(event) {
  event.preventDefault();

  const inputVal = document.getElementById("modal-paynow-input").value.trim();
  const cleanNumber = formatCleanPayNow(inputVal);

  if (!cleanNumber) {
    showToast("Please enter a valid PayNow number.", "warning");
    return;
  }

  const saveBtn = document.getElementById("btn-save-paynow");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";

  try {
    const res = await fetch(`${WORKER_URL}/api/claims/operator/update-paynow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employee_id: currentUser.id,
        user_email: currentUser.email,
        paynow_number: cleanNumber
      })
    });

    if (!res.ok) throw new Error(await res.text());

    currentUser.paynow_number = cleanNumber;
    setCachedAuth(currentUser);

    showToast("PayNow number saved successfully!", "success");
    closePayNowModal();
    updatePayNowBanner();
  } catch (err) {
    showToast("Failed to update PayNow: " + err.message, "error");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save Number";
  }
}

// ============================================================================
// LIGHTBOX & TOAST
// ============================================================================
function showLightbox(url) {
  const modal = document.getElementById("lightbox-modal");
  const img = document.getElementById("lightbox-img");
  if (modal && img) {
    img.src = url;
    modal.classList.add("active");
  }
}

function closeLightbox() {
  const modal = document.getElementById("lightbox-modal");
  if (modal) modal.classList.remove("active");
}

let toastTimer = null;
function showToast(msg, type = "info") {
  const toast = document.getElementById("toast-popup");
  if (!toast) return;

  toast.textContent = msg;
  toast.classList.add("active");

  if (type === "error") toast.style.backgroundColor = "#EF4444";
  else if (type === "success") toast.style.backgroundColor = "#10B981";
  else if (type === "warning") toast.style.backgroundColor = "#F59E0B";
  else toast.style.backgroundColor = "#0F172A";

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("active");
  }, 2800);
}
