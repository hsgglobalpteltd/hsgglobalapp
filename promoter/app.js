// iB - Promoter App (App 8 in Project 3)
const WORKER_URL = "https://ib-v2.hsgglobalpteltd.workers.dev";

// Global State
let currentUser = null;
let schedulesData = [];
let campaignsData = [];
let productsData = [];
let storesData = [];
let retailersData = [];
let employeesData = [];

let enteredPIN = "";
let activeShiftId = null;

// Temporary image buffers
const imageBuffers = {
  "checkin-selfie-data": null,
  "checkin-shelf-data": null,
  "checkout-shelf-data": null,
  "checkout-selfie-data": null,
  "expense-receipt-data": null
};

// ============================================================================
// INITIALIZATION & LIFECYCLE
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
  initApp();
});

async function initApp() {
  updateCurrentDateDisplay();

  // 1. Check Centralized 30-day Main Portal session
  try {
    const portalUserStr = localStorage.getItem("ib_auth_user");
    const portalExpiryStr = localStorage.getItem("ib_session_expiry");
    if (portalUserStr && portalExpiryStr) {
      if (Date.now() < Number(portalExpiryStr)) {
        const pUser = JSON.parse(portalUserStr);
        currentUser = {
          id: pUser.id || "",
          name: pUser.name || "Promoter",
          full_name: pUser.full_name || pUser.name || "",
          phone: pUser.phone || "",
          role: pUser.role || "Promoter"
        };
        showMainScreen();
        await refreshData();
        return;
      }
    }
  } catch (_) {}

  // 2. Fallback to saved local session
  const savedUser = localStorage.getItem("ib_promoter_app_user");
  if (savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
      showMainScreen();
      await refreshData();
      return;
    } catch (e) {
      localStorage.removeItem("ib_promoter_app_user");
    }
  }

  // Unauthenticated: Redirect to Main Portal PIN Gate
  window.location.href = "../index.html";
}

async function loadEmployees() {
  try {
    const res = await fetch(`${WORKER_URL}/api/promoter?table=Employees`);
    if (res.ok) {
      const data = await res.json();
      employeesData = Array.isArray(data) ? data : [];
    }
  } catch (err) {
    console.error("Failed to load employees:", err);
  }
}

function updateCurrentDateDisplay() {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric"
  });
  const el = document.getElementById("current-date-display");
  if (el) el.innerText = dateStr;
}

function handleLogout() {
  currentUser = null;
  localStorage.removeItem("ib_promoter_app_user");
  localStorage.removeItem("ib_auth_user");
  localStorage.removeItem("ib_session_expiry");
  window.location.href = "../index.html";
}

function showMainScreen() {
  const mainView = document.getElementById("main-view");
  if (mainView) mainView.classList.add("active");

  if (currentUser) {
    const nameEl = document.getElementById("header-promoter-name");
    const idEl = document.getElementById("header-promoter-id");
    const avatarEl = document.getElementById("header-avatar-initial");
    if (nameEl) nameEl.innerText = currentUser.name;
    if (idEl) idEl.innerText = currentUser.id ? `ID: ${currentUser.id}` : "";
    if (avatarEl) avatarEl.innerText = (currentUser.name[0] || "P").toUpperCase();
  }
}

// ============================================================================
// DATA SYNC & DASHBOARD RENDERING
// ============================================================================
async function refreshData() {
  if (!currentUser) return;
  showToast("Syncing schedule data...", "info");

  try {
    const [resSchedules, resCampaigns, resProducts, resStores, resRetailers] = await Promise.all([
      fetch(`${WORKER_URL}/api/promoter?table=Promoter_Schedule`),
      fetch(`${WORKER_URL}/api/promoter?table=Promoter_Campaign`),
      fetch(`${WORKER_URL}/api/promoter?table=Products_DB`),
      fetch(`${WORKER_URL}/api/promoter?table=Store_Retailer_DB`),
      fetch(`${WORKER_URL}/api/promoter?table=Retailers_DB`)
    ]);

    schedulesData = resSchedules.ok ? await resSchedules.json() : [];
    campaignsData = resCampaigns.ok ? await resCampaigns.json() : [];
    productsData = resProducts.ok ? await resProducts.json() : [];
    storesData = resStores.ok ? await resStores.json() : [];
    retailersData = resRetailers.ok ? await resRetailers.json() : [];

    renderDashboard();
    showToast("Schedule up to date!", "success");
  } catch (err) {
    console.error("Sync error:", err);
    showToast("Failed to refresh schedule.", "error");
  }
}

function getFormattedStoreName(storeId, fallbackStoreName) {
  if (!storeId && !fallbackStoreName) return "Store";
  const baseName = fallbackStoreName || "";
  if (String(storeId).startsWith("OTHER")) return baseName || "Other Location";
  
  const storeObj = storesData.find(st => String(st.id) === String(storeId));
  const cleanStoreName = storeObj ? (storeObj.display_name || storeObj.name || baseName) : baseName;

  const retId = storeObj ? (storeObj.retailers_id || storeObj.retailer_id || storeObj["Retailers ID"] || storeObj["Retailer ID"]) : null;
  const retailerObj = retId ? retailersData.find(r => String(r.id) === String(retId)) : null;
  const retailerName = retailerObj ? (retailerObj.display_name || retailerObj.name || "") : (storeObj?.retailer_name || storeObj?.retailers_name || "");
  
  const prefix = retailerName ? retailerName.trim().substring(0, 5).toUpperCase() : "";
  if (prefix) {
    if (cleanStoreName.toUpperCase().startsWith(prefix)) {
      return cleanStoreName;
    }
    return `${prefix} - ${cleanStoreName}`;
  }
  return cleanStoreName || "Store";
}

function renderDashboard() {
  if (!currentUser) return;

  // Filter shifts assigned to this promoter
  const myShifts = schedulesData.filter(s => {
    const isMine = String(s.promoter_id) === String(currentUser.id);
    const isNotArchived = !(s.archived && (String(s.archived) === "1" || String(s.archived) === "true"));
    return isMine && isNotArchived;
  });

  const now = new Date();
  const todayStr = now.toDateString();

  const todayShifts = [];
  const upcomingShifts = [];
  const pastShifts = [];

  myShifts.forEach(s => {
    const shiftDate = new Date(Number(s.date));
    const shiftDateStr = shiftDate.toDateString();

    if (shiftDateStr === todayStr) {
      todayShifts.push(s);
    } else if (shiftDate.getTime() > now.getTime()) {
      upcomingShifts.push(s);
    } else {
      pastShifts.push(s);
    }
  });

  // Sort lists
  todayShifts.sort((a, b) => Number(a.date) - Number(b.date));
  upcomingShifts.sort((a, b) => Number(a.date) - Number(b.date));
  pastShifts.sort((a, b) => Number(b.date) - Number(a.date));

  // Render containers
  document.getElementById("today-shifts-count").innerText = todayShifts.length;
  document.getElementById("upcoming-shifts-count").innerText = upcomingShifts.length;
  document.getElementById("past-shifts-count").innerText = pastShifts.length;

  renderShiftsList("today-shifts-list", todayShifts, true);
  renderShiftsList("upcoming-shifts-list", upcomingShifts, false);
  renderShiftsList("past-shifts-list", pastShifts, false);
}

function renderShiftsList(containerId, list, isToday) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (list.length === 0) {
    container.innerHTML = `<div class="empty-state">No activations found</div>`;
    return;
  }

  container.innerHTML = list.map(s => {
    const storeObj = storesData.find(st => String(st.id) === String(s.store_id));
    const storeName = getFormattedStoreName(s.store_id, s.store_name);
    const storeAddress = storeObj?.address || storeObj?.store_address || "Singapore";
    
    // Status determination
    let statusLabel = "Scheduled";
    let statusClass = "scheduled";

    if (s.actual_end || s.status === "Completed") {
      statusLabel = "Completed";
      statusClass = "completed";
    } else if (s.actual_start || s.status === "Checked In") {
      statusLabel = "Checked In";
      statusClass = "checked-in";
    }

    const shiftDate = new Date(Number(s.date));
    const dateFormatted = shiftDate.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short"
    });

    const scheduledTime = `${s.shift_start || "09:00"} - ${s.shift_end || "17:00"}`;

    return `
      <div class="shift-card ${isToday ? "today" : ""}">
        <div class="shift-card-header">
          <div class="store-info">
            <div class="store-name">${escapeHtml(storeName)}</div>
            <div class="store-address">${escapeHtml(storeAddress)}</div>
            <div class="campaign-tag">${escapeHtml(s.campaign_title || "Product Activation")}</div>
          </div>
          <div class="status-pill ${statusClass}">${statusLabel}</div>
        </div>

        <div class="shift-meta">
          <div class="meta-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
            <span>${dateFormatted}</span>
          </div>
          <div class="meta-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            <span>${scheduledTime}</span>
          </div>
          ${s.actual_start ? `
            <div class="meta-item" style="color: var(--success);">
              <span>Act: ${s.actual_start}${s.actual_end ? ` - ${s.actual_end}` : ""}</span>
            </div>
          ` : ""}
        </div>

        <!-- Action Buttons -->
        <div class="card-actions">
          <!-- Add Expense Button (Always Available) -->
          <button type="button" class="btn-action btn-expense" onclick="openExpenseModal('${s.id}')">
            <span>➕ Add Expense</span>
          </button>

          ${isToday && !s.actual_start && s.status !== "Completed" ? `
            <button type="button" class="btn-action btn-checkin" onclick="openCheckInModal('${s.id}')">
              <span>📍 Check-In</span>
            </button>
          ` : ""}

          ${isToday && s.actual_start && !s.actual_end && s.status !== "Completed" ? `
            <button type="button" class="btn-action btn-checkout" onclick="openCheckOutModal('${s.id}')">
              <span>🏁 Check-Out</span>
            </button>
          ` : ""}

          ${s.status === "Completed" || s.actual_end ? `
            <button type="button" class="btn-action btn-summary" onclick="openSummaryModal('${s.id}')">
              <span>📄 View Summary</span>
            </button>
          ` : ""}
        </div>
      </div>
    `;
  }).join("");
}

// ============================================================================
// CAMERA / IMAGE HANDLING
// ============================================================================
function triggerCameraInput(inputId) {
  const el = document.getElementById(inputId);
  if (el) el.click();
}

function handleImageSelected(event, previewBoxId, dataBufferKey) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const base64Data = e.target.result;
    imageBuffers[dataBufferKey] = {
      file: file,
      base64: base64Data
    };

    const box = document.getElementById(previewBoxId);
    if (box) {
      const placeholder = box.querySelector(".upload-placeholder");
      const img = box.querySelector(".preview-img");
      if (placeholder) placeholder.style.display = "none";
      if (img) {
        img.src = base64Data;
        img.style.display = "block";
      }
    }
  };
  reader.readAsDataURL(file);
}

function resetImagePreview(previewBoxId, dataBufferKey) {
  imageBuffers[dataBufferKey] = null;
  const box = document.getElementById(previewBoxId);
  if (box) {
    const placeholder = box.querySelector(".upload-placeholder");
    const img = box.querySelector(".preview-img");
    if (placeholder) placeholder.style.display = "flex";
    if (img) {
      img.src = "";
      img.style.display = "none";
    }
  }
}

async function uploadImageToR2(imageBuffer, prefix = "promoter-proof") {
  if (!imageBuffer || !imageBuffer.file) return "";

  const timestamp = Date.now();
  const safeName = `${prefix}-${timestamp}.jpg`;
  const uploadUrl = `${WORKER_URL}/api/upload?filename=${encodeURIComponent(safeName)}`;

  try {
    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": imageBuffer.file.type || "image/jpeg" },
      body: imageBuffer.file
    });

    if (res.ok) {
      const data = await res.json();
      return data.url || "";
    }
  } catch (err) {
    console.error("Upload error:", err);
  }
  return "";
}

// ============================================================================
// MODAL 1: CHECK-IN WORKFLOW
// ============================================================================
function openCheckInModal(shiftId) {
  activeShiftId = shiftId;
  const shift = schedulesData.find(s => String(s.id) === String(shiftId));
  if (!shift) return;

  document.getElementById("checkin-store-sub").innerText = getFormattedStoreName(shift.store_id, shift.store_name);

  resetImagePreview("checkin-selfie-preview-box", "checkin-selfie-data");
  resetImagePreview("checkin-shelf-preview-box", "checkin-shelf-data");

  // Render Campaign SKUs counter
  const campaignProds = getCampaignProductsForShift(shift);
  const container = document.getElementById("checkin-products-list");

  if (campaignProds.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding: 12px;">No campaign products configured.</div>`;
  } else {
    container.innerHTML = campaignProds.map(p => `
      <div class="product-counter-row">
        <div class="prod-details">
          <span class="prod-title">${escapeHtml(p.display_name)}</span>
          <span class="prod-sku">SKU: ${p.sku}</span>
        </div>
        <div class="stepper-controls">
          <button type="button" class="stepper-btn" onclick="stepQty('checkin-qty-${p.sku}', -1)">-</button>
          <input type="number" id="checkin-qty-${p.sku}" data-sku="${p.sku}" value="0" min="0" class="stepper-input">
          <button type="button" class="stepper-btn" onclick="stepQty('checkin-qty-${p.sku}', 1)">+</button>
        </div>
      </div>
    `).join("");
  }

  document.getElementById("checkin-modal").classList.add("active");
}

function stepQty(inputId, delta) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const current = parseInt(input.value) || 0;
  input.value = Math.max(0, current + delta);
}

async function submitCheckIn() {
  if (!activeShiftId) return;

  if (!imageBuffers["checkin-selfie-data"]) {
    showToast("Please take a check-in selfie photo.", "warning");
    return;
  }
  if (!imageBuffers["checkin-shelf-data"]) {
    showToast("Please take an opening shelf photo.", "warning");
    return;
  }

  const btn = document.getElementById("btn-submit-checkin");
  btn.disabled = true;
  btn.innerText = "Uploading proofs...";

  try {
    // 1. Upload photos to Cloudflare R2
    const selfieUrl = await uploadImageToR2(imageBuffers["checkin-selfie-data"], `selfie-in-${activeShiftId}`);
    const shelfUrl = await uploadImageToR2(imageBuffers["checkin-shelf-data"], `shelf-in-${activeShiftId}`);

    // 2. Gather starting quantities
    const shift = schedulesData.find(s => String(s.id) === String(activeShiftId));
    const campaignProds = getCampaignProductsForShift(shift);
    const startQtyList = campaignProds.map(p => {
      const input = document.getElementById(`checkin-qty-${p.sku}`);
      const qty = input ? parseInt(input.value) || 0 : 0;
      return { sku: p.sku, qty };
    });

    const now = new Date();
    const actualStartTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    // 3. Save to database
    const payload = {
      table: "Promoter_Schedule",
      action: "update",
      data: {
        id: activeShiftId,
        actual_start: actualStartTime,
        status: "Checked In",
        check_in_selfie: selfieUrl,
        shelf_photo_start: shelfUrl,
        start_qty: JSON.stringify(startQtyList)
      }
    };

    const res = await fetch(`${WORKER_URL}/api/promoter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      showToast("Check-In completed successfully!", "success");
      closeModal("checkin-modal");
      await refreshData();
    } else {
      throw new Error("Failed to save check-in record.");
    }
  } catch (err) {
    console.error("Check-In error:", err);
    showToast("Error during check-in: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerText = "Complete Check-In";
  }
}

// ============================================================================
// MODAL 2: CHECK-OUT WORKFLOW
// ============================================================================
function openCheckOutModal(shiftId) {
  activeShiftId = shiftId;
  const shift = schedulesData.find(s => String(s.id) === String(shiftId));
  if (!shift) return;

  document.getElementById("checkout-store-sub").innerText = getFormattedStoreName(shift.store_id, shift.store_name);

  resetImagePreview("checkout-shelf-preview-box", "checkout-shelf-data");
  resetImagePreview("checkout-selfie-preview-box", "checkout-selfie-data");

  // Render Campaign SKUs counter with starting qty reference
  const campaignProds = getCampaignProductsForShift(shift);
  const container = document.getElementById("checkout-products-list");

  let startQtyMap = {};
  if (shift.start_qty) {
    try {
      const parsed = JSON.parse(shift.start_qty);
      if (Array.isArray(parsed)) {
        parsed.forEach(it => { startQtyMap[it.sku] = Number(it.qty || 0); });
      }
    } catch (e) {}
  }

  if (campaignProds.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding: 12px;">No campaign products configured.</div>`;
  } else {
    container.innerHTML = campaignProds.map(p => {
      const startCount = startQtyMap[p.sku] || 0;
      return `
        <div class="product-counter-row">
          <div class="prod-details">
            <span class="prod-title">${escapeHtml(p.display_name)}</span>
            <span class="prod-sku">SKU: ${p.sku} &bull; Start: ${startCount} pcs</span>
          </div>
          <div class="stepper-controls">
            <button type="button" class="stepper-btn" onclick="stepQty('checkout-qty-${p.sku}', -1)">-</button>
            <input type="number" id="checkout-qty-${p.sku}" data-sku="${p.sku}" value="${startCount}" min="0" class="stepper-input">
            <button type="button" class="stepper-btn" onclick="stepQty('checkout-qty-${p.sku}', 1)">+</button>
          </div>
        </div>
      `;
    }).join("");
  }

  document.getElementById("checkout-modal").classList.add("active");
}

async function submitCheckOut() {
  if (!activeShiftId) return;

  if (!imageBuffers["checkout-shelf-data"]) {
    showToast("Please take a closing shelf photo.", "warning");
    return;
  }
  if (!imageBuffers["checkout-selfie-data"]) {
    showToast("Please take a check-out selfie photo.", "warning");
    return;
  }

  const btn = document.getElementById("btn-submit-checkout");
  btn.disabled = true;
  btn.innerText = "Submitting check-out...";

  try {
    // 1. Upload photos to Cloudflare R2
    const shelfUrl = await uploadImageToR2(imageBuffers["checkout-shelf-data"], `shelf-out-${activeShiftId}`);
    const selfieUrl = await uploadImageToR2(imageBuffers["checkout-selfie-data"], `selfie-out-${activeShiftId}`);

    // 2. Gather end quantities & calculate items moved
    const shift = schedulesData.find(s => String(s.id) === String(activeShiftId));
    const campaignProds = getCampaignProductsForShift(shift);

    let startQtyMap = {};
    if (shift.start_qty) {
      try {
        const parsed = JSON.parse(shift.start_qty);
        if (Array.isArray(parsed)) {
          parsed.forEach(it => { startQtyMap[it.sku] = Number(it.qty || 0); });
        }
      } catch (e) {}
    }

    const endQtyList = [];
    const itemsMovedList = [];

    campaignProds.forEach(p => {
      const input = document.getElementById(`checkout-qty-${p.sku}`);
      const endQty = input ? parseInt(input.value) || 0 : 0;
      const startQty = startQtyMap[p.sku] || 0;
      const movedQty = Math.max(0, startQty - endQty);

      endQtyList.push({ sku: p.sku, qty: endQty });
      if (movedQty > 0) {
        itemsMovedList.push({ sku: p.sku, qty: movedQty });
      }
    });

    const now = new Date();
    const actualEndTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    // 3. Save to database
    const payload = {
      table: "Promoter_Schedule",
      action: "update",
      data: {
        id: activeShiftId,
        actual_end: actualEndTime,
        status: "Completed",
        check_out_selfie: selfieUrl,
        shelf_photo_end: shelfUrl,
        end_qty: JSON.stringify(endQtyList),
        items_moved: JSON.stringify(itemsMovedList)
      }
    };

    const res = await fetch(`${WORKER_URL}/api/promoter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      showToast("Shift completed! Opening Summary...", "success");
      closeModal("checkout-modal");
      await refreshData();
      openSummaryModal(activeShiftId);
    } else {
      throw new Error("Failed to save check-out record.");
    }
  } catch (err) {
    console.error("Check-Out error:", err);
    showToast("Error during check-out: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerText = "Complete Check-Out";
  }
}

// ============================================================================
// MODAL 3: ADD EXPENSE / RECEIPT (ANYTIME ACTION)
// ============================================================================
function openExpenseModal(shiftId) {
  activeShiftId = shiftId;
  const shift = schedulesData.find(s => String(s.id) === String(shiftId));
  if (!shift) return;

  document.getElementById("expense-item-name").value = "";
  document.getElementById("expense-item-amount").value = "";
  resetImagePreview("expense-receipt-preview-box", "expense-receipt-data");

  renderLoggedExpenses(shift);
  document.getElementById("expense-modal").classList.add("active");
}

function renderLoggedExpenses(shift) {
  const container = document.getElementById("logged-expenses-list");
  if (!container) return;

  let list = [];
  if (shift.promoting_cost) {
    try {
      const parsed = JSON.parse(shift.promoting_cost);
      if (Array.isArray(parsed)) list = parsed;
    } catch (e) {}
  }

  if (list.length === 0) {
    container.innerHTML = `<span style="font-size: 11px; color: var(--text-sub); italic">No expenses logged yet.</span>`;
    return;
  }

  container.innerHTML = list.map(item => `
    <div class="logged-item">
      <span>${escapeHtml(item.item || "Expense")}</span>
      <span style="font-family: monospace; font-weight: 600; color: var(--text-main);">$${Number(item.amount || 0).toFixed(2)}</span>
    </div>
  `).join("");
}

async function submitAddExpense() {
  if (!activeShiftId) return;

  const itemName = document.getElementById("expense-item-name").value.trim();
  const amount = parseFloat(document.getElementById("expense-item-amount").value);

  if (!itemName) {
    showToast("Please enter an expense description.", "warning");
    return;
  }
  if (isNaN(amount) || amount <= 0) {
    showToast("Please enter a valid amount.", "warning");
    return;
  }
  if (!imageBuffers["expense-receipt-data"]) {
    showToast("Please attach a photo of the receipt.", "warning");
    return;
  }

  const btn = document.getElementById("btn-submit-expense");
  btn.disabled = true;
  btn.innerText = "Uploading receipt...";

  try {
    const receiptUrl = await uploadImageToR2(imageBuffers["expense-receipt-data"], `receipt-${activeShiftId}`);

    const shift = schedulesData.find(s => String(s.id) === String(activeShiftId));
    let existingExpenses = [];
    if (shift && shift.promoting_cost) {
      try {
        const parsed = JSON.parse(shift.promoting_cost);
        if (Array.isArray(parsed)) existingExpenses = parsed;
      } catch (e) {}
    }

    const newExpense = {
      item: itemName,
      amount: amount,
      receipt_photo: receiptUrl,
      logged_at: Date.now()
    };

    const updatedExpenses = [...existingExpenses, newExpense];

    const payload = {
      table: "Promoter_Schedule",
      action: "update",
      data: {
        id: activeShiftId,
        promoting_cost: JSON.stringify(updatedExpenses)
      }
    };

    const res = await fetch(`${WORKER_URL}/api/promoter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      showToast("Expense logged successfully!", "success");
      closeModal("expense-modal");
      await refreshData();
    } else {
      throw new Error("Failed to save expense.");
    }
  } catch (err) {
    console.error("Add Expense error:", err);
    showToast("Error saving expense: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerText = "Add Expense";
  }
}

// ============================================================================
// MODAL 4: DIGITAL SUMMARY CARD (SCREENSHOT PAGE)
// ============================================================================
function openSummaryModal(shiftId) {
  const shift = schedulesData.find(s => String(s.id) === String(shiftId));
  if (!shift) return;

  const storeObj = storesData.find(st => String(st.id) === String(shift.store_id));
  const storeName = getFormattedStoreName(shift.store_id, shift.store_name);
  const storeAddress = storeObj?.address || storeObj?.store_address || "Singapore";

  const shiftDate = new Date(Number(shift.date));
  const dateFormatted = shiftDate.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric"
  });

  // Items moved
  let itemsMoved = [];
  if (shift.items_moved) {
    try {
      const parsed = JSON.parse(shift.items_moved);
      if (Array.isArray(parsed)) itemsMoved = parsed;
    } catch (e) {}
  }
  const totalUnits = itemsMoved.reduce((acc, it) => acc + Number(it.qty || 0), 0);

  // Expenses
  let expenses = [];
  if (shift.promoting_cost) {
    try {
      const parsed = JSON.parse(shift.promoting_cost);
      if (Array.isArray(parsed)) expenses = parsed;
    } catch (e) {}
  }
  const totalExpenses = expenses.reduce((acc, it) => acc + Number(it.amount || 0), 0);

  const container = document.getElementById("summary-card-content");
  container.innerHTML = `
    <div class="summary-card-view">
      
      <!-- Store Header -->
      <div class="summary-store-header">
        <h2 class="summary-store-title">${escapeHtml(storeName)}</h2>
        <p class="summary-store-address">${escapeHtml(storeAddress)}</p>
      </div>

      <!-- Info Grid -->
      <div class="summary-info-grid">
        <div class="summary-info-item">
          <span class="lbl">Date</span>
          <span class="val">${dateFormatted}</span>
        </div>
        <div class="summary-info-item">
          <span class="lbl">Promoter</span>
          <span class="val">${escapeHtml(shift.promoter_name || currentUser.name)}</span>
        </div>
        <div class="summary-info-item">
          <span class="lbl">Campaign</span>
          <span class="val">${escapeHtml(shift.campaign_title || "—")}</span>
        </div>
        <div class="summary-info-item">
          <span class="lbl">Actual Shift</span>
          <span class="val" style="color: var(--success); font-family: monospace;">${shift.actual_start || "—"} - ${shift.actual_end || "—"}</span>
        </div>
      </div>

      <!-- Items Moved Table -->
      <div class="summary-section">
        <span class="summary-section-label">Stock Movement (Items Moved):</span>
        <table class="summary-table">
          <thead>
            <tr>
              <th>Product SKU</th>
              <th style="text-align: right;">Moved Qty</th>
            </tr>
          </thead>
          <tbody>
            ${itemsMoved.length === 0 ? `
              <tr><td colspan="2" style="text-align: center; color: var(--text-sub);">0 items moved</td></tr>
            ` : itemsMoved.map(it => {
              const prod = productsData.find(p => p.sku === it.sku);
              return `
                <tr>
                  <td>${prod?.display_name || it.sku} <span style="font-size: 9.5px; color: var(--text-sub);">(${it.sku})</span></td>
                  <td style="text-align: right; font-family: monospace; font-weight: 600;">${it.qty} pcs</td>
                </tr>
              `;
            }).join("")}
            <tr class="total-row">
              <td>Total Units Moved</td>
              <td style="text-align: right; font-family: monospace;">${totalUnits} pcs</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Expenses Summary if any -->
      ${expenses.length > 0 ? `
        <div class="summary-section">
          <span class="summary-section-label">Expenses Claimed:</span>
          <table class="summary-table">
            <tbody>
              ${expenses.map(ex => `
                <tr>
                  <td>${escapeHtml(ex.item || "Expense")}</td>
                  <td style="text-align: right; font-family: monospace;">$${Number(ex.amount || 0).toFixed(2)}</td>
                </tr>
              `).join("")}
              <tr class="total-row">
                <td>Total Expenses</td>
                <td style="text-align: right; font-family: monospace;">$${totalExpenses.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ` : ""}

    </div>
  `;

  document.getElementById("summary-modal").classList.add("active");
}

// ============================================================================
// HELPERS
// ============================================================================
function getCampaignProductsForShift(shift) {
  if (!shift) return productsData;
  const camp = campaignsData.find(c => String(c.id) === String(shift.campaign_id));
  if (!camp) return productsData;

  if (camp.brand) {
    const brandIds = String(camp.brand).split(",").map(b => b.trim()).filter(Boolean);
    const brandProds = productsData.filter(p => brandIds.includes(String(p.brands_id || p["brands_id"])));
    if (camp.products) {
      const targeted = String(camp.products).split(",").map(s => s.trim()).filter(Boolean);
      if (targeted.length > 0) {
        return brandProds.filter(p => targeted.includes(p.sku));
      }
    }
    return brandProds;
  }
  return productsData;
}

function closeModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.remove("active");
}

let toastTimer = null;
function showToast(message, type = "info") {
  const toast = document.getElementById("app-toast");
  if (!toast) return;

  toast.innerText = message;
  toast.className = "toast show";

  if (type === "error") {
    toast.style.background = "#DC2626";
  } else if (type === "success") {
    toast.style.background = "#059669";
  } else if (type === "warning") {
    toast.style.background = "#D97706";
  } else {
    toast.style.background = "#0F172A";
  }

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2800);
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
