// Desktop Redirect Check
if (window.innerWidth > 600) {
  window.location.href = '../index.html';
}

// ==========================================
// CONFIGURATION & CORE STATE
// ==========================================
const WORKER_URL = 'https://ib.hsgglobalpteltd.workers.dev';

let products = [];
let quantities = {};
let logs = [];
let storeKeepers = [];
let isDataReady = false;
let isDataStale = false;
let currentViewData = [];
let currentViewTitle = "";
let excludedBrands = new Set();
let skippedProducts = new Set();

// ==========================================
// LIFE CYCLE & INITIALIZATION
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
  const cachedProducts = localStorage.getItem('inventoryProducts');
  const cachedLogs = localStorage.getItem('inventoryLogs');
  const cachedStoreKeepers = localStorage.getItem('inventoryStoreKeepers');

  if (cachedProducts) {
    products = JSON.parse(cachedProducts);
    isDataReady = true;
  }
  if (cachedLogs) logs = JSON.parse(cachedLogs);
  if (cachedStoreKeepers) storeKeepers = JSON.parse(cachedStoreKeepers);

  const cachedQuantities = localStorage.getItem('inventoryQuantities');
  if (cachedQuantities) quantities = JSON.parse(cachedQuantities);

  const cachedSkipped = localStorage.getItem('inventorySkipped');
  if (cachedSkipped) {
    skippedProducts = new Set(JSON.parse(cachedSkipped));
  }

  // Setup scroll listener for Page 2 persistence
  const productsContainer = document.getElementById('productsContainer');
  productsContainer.addEventListener('scroll', () => {
    if (!document.getElementById('page2').classList.contains('hidden')) {
      localStorage.setItem('inventoryScrollPage2', productsContainer.scrollTop);
    }
  }, { passive: true });

  const lastPage = localStorage.getItem('inventoryCurrentPage');
  if (lastPage) {
    if (lastPage === 'page2') {
      renderProducts();
      showPage('page2');
    } else if (lastPage === 'page3') {
      const savedSummary = localStorage.getItem('inventoryLastSummary');
      if (savedSummary) {
        const s = JSON.parse(savedSummary);
        renderGroupedList(s.data, s.title, s.remark, s.showSubmit, false);
      } else {
        showPage('page1');
      }
    } else {
      showPage('page1');
    }
  } else {
    showPage('page1');
  }

  // Run initial sync & fetch
  backgroundSync();
});

// ==========================================
// SYNCHRONIZATION & DATA FETCHING
// ==========================================
function updateSyncStatus(status) {
  const btnIndicator = document.getElementById('btnSyncIndicator');
  if (btnIndicator) {
    btnIndicator.className = 'button-loading-bar ' + status;
  }
}

async function backgroundSync() {
  updateSyncStatus('loading');
  await syncSubmissions();
  const success = await fetchData(true);
  if (success) {
    cacheImagesLocally();
  }
}

async function fetchData(silent = true) {
  isDataStale = false;

  try {
    updateSyncStatus('loading');

    // Fetch in parallel from Cloudflare Worker
    const [prodRes, brandRes, logsRes, usersRes] = await Promise.all([
      fetch(`${WORKER_URL}/api/app/stock-take/products?t=${Date.now()}`),
      fetch(`${WORKER_URL}/api/app/stock-take/brands?t=${Date.now()}`),
      fetch(`${WORKER_URL}/api/app/stock-take/log?t=${Date.now()}`),
      fetch(`${WORKER_URL}/api/app/stock-take/users?t=${Date.now()}`)
    ]);

    if (!prodRes.ok || !brandRes.ok || !logsRes.ok || !usersRes.ok) {
      throw new Error("One or more network requests failed");
    }

    const rawProducts = await prodRes.json();
    const rawBrands = await brandRes.json();
    const rawLogs = await logsRes.json();
    const rawUsers = await usersRes.json();

    // 1. Map Brands
    const brandMap = {};
    rawBrands.forEach(b => {
      brandMap[b.ID || b.id] = {
        name: b["Display Name"] || b.name,
        rank: parseInt(b.Rank || b.rank) || 999
      };
    });

    // 2. Map Products and normalize
    products = rawProducts.map(p => {
      const bInfo = brandMap[p["Brands ID"] || p["brands id"] || p["Brand ID"]] || { name: "Unknown", rank: 999 };
      return {
        Code: p.SKU || p.sku || p.Code || p.code,
        Description: p["Display Name"] || p.Description || p.description,
        ImgLink: p.Image || p.image || p.ImgLink,
        Pack: parseInt(p.Carton || p.carton || p.Pack) || 0,
        Rank: parseInt(p.Rank || p.rank) || 999,
        Brand: bInfo.name,
        BrandRank: bInfo.rank
      };
    });

    // 3. Map and parse Logs (handling user's Audit column change)
    logs = rawLogs.map(l => {
      let auditData = [];
      try {
        const rawData = typeof l.Audit === 'string' ? JSON.parse(l.Audit) : (l.Audit || l["Audit JSON"]);
        if (Array.isArray(rawData)) {
          auditData = rawData.map(item => ({
            Code: item.sku || item.code || item.Code || item.SKU,
            Qty: item.qty !== undefined ? item.qty : item.Qty,
            Skipped: item.skipped || item.Skipped || false
          }));
        }
      } catch (e) {
        console.warn("Failed to parse Audit JSON for log at " + l.Timestamp, e);
      }
      return {
        timestamp: l.Timestamp || l.timestamp,
        submittedBy: l["Audit by"] || l.submittedBy,
        data: auditData
      };
    }).filter(l => l.data && l.data.length > 0);

    // 4. Set Storekeepers (Users)
    storeKeepers = rawUsers.map(u => ({
      id: u.ID || u.id,
      name: u.Name || u.name,
      pin: String(u.PIN || u.pin).trim()
    }));

    // Sort logs descending
    logs.sort((a, b) => parseTimestamp(b.timestamp) - parseTimestamp(a.timestamp));

    // Save to local storage
    localStorage.setItem('inventoryProducts', JSON.stringify(products));
    localStorage.setItem('inventoryLogs', JSON.stringify(logs));
    localStorage.setItem('inventoryStoreKeepers', JSON.stringify(storeKeepers));
    isDataReady = true;

    if (!document.getElementById('page2').classList.contains('hidden')) {
      renderProducts();
    }

    updateSyncStatus('loaded');
    
    // Clear old stale checks and set 1h timer
    clearTimeout(window.syncIndicatorTimer);
    window.syncIndicatorTimer = setTimeout(() => {
      updateSyncStatus('error');
      isDataStale = true;
    }, 3600000); 

    return true;
  } catch (err) {
    console.error("Fetch failed:", err);
    isDataStale = true;
    updateSyncStatus('error');
    if (!silent) alert("Error syncing data. Cloud connection failed.");
    return false;
  }
}

// ==========================================
// BACKGROUND IMAGE CACHE (LOW-QUALITY WEBP)
// ==========================================
async function cacheImagesLocally() {
  if (!products || products.length === 0) return;

  for (const p of products) {
    const key = 'img_cache_' + p.Code;
    if (localStorage.getItem(key)) continue;

    const url = getProductImg(p);
    if (!url || url.startsWith('data:')) continue;

    try {
      const img = new Image();
      img.crossOrigin = "Anonymous";
      img.referrerPolicy = "no-referrer";
      img.src = url;
      img.onload = function () {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        try {
          const dataURL = canvas.toDataURL('image/webp', 0.4); // Compressed WebP to fit localStorage limit
          localStorage.setItem(key, dataURL);
        } catch (e) {
          console.warn("Storage quota full or Canvas security block, stopping image cache.");
        }
      };
    } catch (e) {
      console.warn("Could not cache image for " + p.Code);
    }

    // Rate-limit request delays
    await new Promise(r => setTimeout(r, 600));
  }
}

function getProductImg(p) {
  const defaultImg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%231e293b'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='24' font-weight='900' fill='%23475569'%3E?%3C/text%3E%3C/svg%3E";
  if (!p) return defaultImg;

  const cached = localStorage.getItem('img_cache_' + p.Code);
  if (cached) return cached;

  let link = p.ImgLink || p.imglink || p.Image || p.image;
  if (!link) return defaultImg;

  // Handle Google Drive image mapping link format
  if (link.includes('drive.google.com')) {
    let fileId = '';
    if (link.includes('/d/')) fileId = link.split('/d/')[1].split('/')[0];
    else if (link.includes('id=')) fileId = link.split('id=')[1].split('&')[0];
    if (fileId) return `https://drive.google.com/uc?export=view&id=${fileId}`;
  }

  return link;
}

// ==========================================
// NAVIGATION & VIEWS
// ==========================================
let searchActive = false;

function toggleSearch() {
  searchActive = !searchActive;
  const def = document.getElementById('defaultHeader');
  const srh = document.getElementById('searchHeader');
  const input = document.getElementById('globalSearchInput');

  if (searchActive) {
    def.classList.remove('active');
    srh.classList.add('active');
    setTimeout(() => input.focus(), 150);
  } else {
    srh.classList.remove('active');
    def.classList.add('active');
    input.value = '';
    handleGlobalSearch();
  }
}

function showPage(pageId) {
  if (searchActive) toggleSearch();

  localStorage.setItem('inventoryCurrentPage', pageId);
  if (pageId === 'page1') {
    localStorage.removeItem('inventoryLastSummary');
    localStorage.removeItem('inventoryScrollPage2');
  }

  document.getElementById('page1').classList.add('hidden');
  document.getElementById('page2').classList.add('hidden');
  document.getElementById('page3').classList.add('hidden');
  document.getElementById(pageId).classList.remove('hidden');
  document.getElementById(pageId).classList.add('active');

  if (pageId === 'page2') {
    const savedScroll = localStorage.getItem('inventoryScrollPage2');
    if (savedScroll) {
      setTimeout(() => {
        document.getElementById('productsContainer').scrollTop = parseInt(savedScroll);
      }, 50);
    }
  }

  const backBtn = document.getElementById('backBtn');
  const searchBtn = document.getElementById('headerSearchBtn');
  const refreshBtn = document.getElementById('syncRefreshBtn');
  const indicator = document.getElementById('syncIndicatorContainer');
  const exportBtn = document.getElementById('headerExportBtn');

  if (pageId === 'page1') {
    if (backBtn) backBtn.classList.add('hidden');
    if (searchBtn) searchBtn.classList.add('hidden');
    if (refreshBtn) refreshBtn.classList.add('hidden');
    if (indicator) indicator.classList.add('hidden');
    if (exportBtn) exportBtn.classList.add('hidden');
  } else {
    if (backBtn) backBtn.classList.remove('hidden');
    if (searchBtn) searchBtn.classList.remove('hidden');
    if (refreshBtn) refreshBtn.classList.add('hidden');
    if (indicator) indicator.classList.add('hidden');
  }
}

function goBack() {
  if (!document.getElementById('page3').classList.contains('hidden')) {
    const title = document.getElementById('summaryTitle').innerText.toLowerCase();
    if (title.includes('stock as')) {
      showPage('page1');
    } else {
      showPage('page2');
    }
  } else if (!document.getElementById('page2').classList.contains('hidden')) {
    showPage('page1');
  }
}

// ==========================================
// HOME PAGE ACTIONS
// ==========================================
function showLatestStockTake() {
  if (!isDataReady) {
    alert("Data is syncing. Please wait a few seconds...");
    return;
  }
  if (logs.length === 0) {
    alert("No stock take logs found.");
    return;
  }
  const targetLog = logs[0];
  const d = new Date(parseTimestamp(targetLog.timestamp));
  const dateStr = formatDateFull(d) + " " + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
  const remark = 'checked by ' + getStoreKeeperDisplay(targetLog.submittedBy);
  renderGroupedList(targetLog.data, `Stock as ${dateStr}`, remark, false);
}

function startCount() {
  if (!isDataReady) {
    alert("Data is syncing. Please wait a few seconds...");
    return;
  }

  const cachedProgress = localStorage.getItem('inventoryQuantities');
  if (cachedProgress) {
    quantities = JSON.parse(cachedProgress);
  } else {
    products.forEach(p => quantities[p.Code] = "");
  }

  localStorage.removeItem('inventoryScrollPage2');
  renderProducts();
  showPage('page2');
}

// ==========================================
// PRODUCTS RENDERING (PAGE 2)
// ==========================================
function renderProducts() {
  const container = document.getElementById('productsContainer');
  container.innerHTML = '';

  let yesterdayQuantities = {};
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayString = yesterdayDate.toDateString();
  const yesterdayLogs = logs.filter(l => new Date(parseTimestamp(l.timestamp)).toDateString() === yesterdayString);

  if (yesterdayLogs.length > 0) {
    const targetLog = yesterdayLogs[0];
    if (targetLog && targetLog.data) {
      targetLog.data.forEach(item => {
        yesterdayQuantities[item.Code] = item.Qty;
      });
    }
  }

  const grouped = products.reduce((acc, p) => {
    if (!acc[p.Brand]) acc[p.Brand] = [];
    acc[p.Brand].push(p);
    return acc;
  }, {});

  // Sort inside brands
  Object.keys(grouped).forEach(brand => {
    grouped[brand].sort((a, b) => (a.Rank - b.Rank) || a.Code.localeCompare(b.Code));
  });

  // Sort brand keys
  const sortedBrands = Object.keys(grouped).sort((a, b) => {
    const rankA = grouped[a][0].BrandRank || 999;
    const rankB = grouped[b][0].BrandRank || 999;
    return (rankA - rankB) || a.localeCompare(b);
  });

  const fragment = document.createDocumentFragment();

  sortedBrands.forEach(brand => {
    const header = document.createElement('div');
    header.className = 'brand-group-header';
    header.setAttribute('data-brand-header', brand.toLowerCase());
    header.innerHTML = `
      <span><i class="fa-solid fa-tag text-purple-400 mr-2"></i>${brand}</span>
      <span class="brand-badge">${grouped[brand].length} ITEMS</span>
    `;
    fragment.appendChild(header);

    grouped[brand].forEach(p => {
      const card = document.createElement('div');
      card.className = 'product-card';
      card.setAttribute('data-brand', brand.toLowerCase());
      card.setAttribute('data-search', `${p.Code} ${p.Description}`.toLowerCase());

      const currentVal = (quantities[p.Code] === undefined || quantities[p.Code] === null) ? "" : quantities[p.Code];
      let valDisplay = currentVal === "" ? "" : currentVal === 0 ? "Out Of Stock" : currentVal;
      let colorClass = currentVal === 0 ? "out-of-stock" : "";

      const finalImg = getProductImg(p);
      const yQty = yesterdayQuantities[p.Code];
      const yCountHtml = yQty !== undefined ? `<div class="yesterday-stock-tag">Yesterday: ${yQty}</div>` : '';
      
      const isSkipped = skippedProducts.has(p.Code);
      const skipBadgeHtml = isSkipped ? `<span id="skip-badge-${p.Code}" class="skip-badge">skiped</span>` : '';

      card.innerHTML = `
        <div class="product-info-row">
          <img src="${finalImg}" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'100\' height=\'100\' viewBox=\'0 0 100 100\'%3E%3Crect width=\'100\' height=\'100\' fill=\'%231e293b\'/%3E%3Ctext x=\'50%25\' y=\'50%25\' dominant-baseline=\'middle\' text-anchor=\'middle\' font-family=\'sans-serif\' font-size=\'24\' font-weight=\'900\' fill=\'%23475569\'%3E?%3C/text%3E%3C/svg%3E'" class="product-img" />
          <div class="product-details">
            <div class="sku-info-wrapper">
              <h3 class="product-sku">${p.Code}</h3>
              <button onclick="openImageModal('${p.Code}')" class="info-help-btn">
                <i class="fa-solid fa-circle-question"></i>
              </button>
              ${skipBadgeHtml}
            </div>
            <p class="product-desc">${p.Description}</p>
            ${yCountHtml}
          </div>
        </div>
        <div class="product-control-row">
          <div class="quantity-adjuster">
            <button class="adjust-btn adjust-btn-minus" onclick="updateQty('${p.Code}', -1)">-</button>
            <input type="text" inputmode="numeric" id="qty-${p.Code}" class="quantity-input ${colorClass}" value="${valDisplay}" onchange="manualQty('${p.Code}')" onclick="this.select()" />
            <button class="adjust-btn adjust-btn-plus" onclick="updateQty('${p.Code}', 1)">+</button>
          </div>
          <button class="card-calc-btn" onclick="openCalc('${p.Code}')" style="margin-right: 0.4rem;">
            <i class="fa-solid fa-calculator"></i>
          </button>
          <button class="card-skip-btn" onclick="skipProduct('${p.Code}')">
            SKIP
          </button>
        </div>
      `;
      fragment.appendChild(card);
    });
  });

  container.appendChild(fragment);
}

function updateQty(code, change) {
  removeSkipBadge(code);
  const input = document.getElementById('qty-' + code);
  let val = quantities[code];
  if (val === "" || val === undefined || val === null) val = 0;
  val += change;
  if (val <= 0) val = 0;

  quantities[code] = val;
  localStorage.setItem('inventoryQuantities', JSON.stringify(quantities));

  if (val === 0) {
    input.value = "Out Of Stock";
    input.classList.add('out-of-stock');
  } else {
    input.value = val;
    input.classList.remove('out-of-stock');
  }

  // Animation pop feedback
  input.classList.add('scale-animation');
  setTimeout(() => input.classList.remove('scale-animation'), 150);
}

function manualQty(code) {
  removeSkipBadge(code);
  const input = document.getElementById('qty-' + code);
  let valStr = input.value.trim().toUpperCase();

  if (valStr === '' || valStr === 'OUT OF STOCK' || valStr === 'OOS') {
    if (valStr === '') {
      quantities[code] = "";
      input.value = "";
      input.classList.remove('out-of-stock');
    } else {
      quantities[code] = 0;
      input.value = "Out Of Stock";
      input.classList.add('out-of-stock');
    }
    return;
  }

  let val = parseInt(valStr);
  if (isNaN(val) || val < 0) {
    quantities[code] = "";
    input.value = "";
    input.classList.remove('out-of-stock');
  } else if (val === 0) {
    quantities[code] = 0;
    input.value = "Out Of Stock";
    input.classList.add('out-of-stock');
  } else {
    quantities[code] = val;
    input.value = val;
    input.classList.remove('out-of-stock');
  }
  localStorage.setItem('inventoryQuantities', JSON.stringify(quantities));
}

// ==========================================
// SKIP COUNT FUNCTIONALITY
// ==========================================
function getLastQty(code) {
  // Search from the most recent logs first
  for (const log of logs) {
    const item = log.data.find(d => d.Code === code);
    if (item && item.Qty !== undefined && item.Qty !== null && item.Qty !== "NOT COUNTED" && item.Qty !== "") {
      const parsed = parseInt(item.Qty);
      return isNaN(parsed) ? 0 : parsed;
    }
  }
  return 0; // Default fallback if no prior history
}

function skipProduct(code) {
  const lastQty = getLastQty(code);
  quantities[code] = lastQty;
  localStorage.setItem('inventoryQuantities', JSON.stringify(quantities));

  // Update input UI
  const input = document.getElementById('qty-' + code);
  if (input) {
    if (lastQty === 0) {
      input.value = "Out Of Stock";
      input.classList.add('out-of-stock');
    } else {
      input.value = lastQty;
      input.classList.remove('out-of-stock');
    }
    // Visual flash
    input.classList.add('apply-flash');
    setTimeout(() => input.classList.remove('apply-flash'), 500);
  }

  // Track skipped state
  skippedProducts.add(code);
  localStorage.setItem('inventorySkipped', JSON.stringify(Array.from(skippedProducts)));

  // Render Skipped Badge next to SKU
  const card = document.querySelector(`.product-card[data-search*="${code.toLowerCase()}"]`);
  if (card) {
    const skuWrapper = card.querySelector('.sku-info-wrapper');
    if (skuWrapper && !document.getElementById('skip-badge-' + code)) {
      const badge = document.createElement('span');
      badge.id = 'skip-badge-' + code;
      badge.className = 'skip-badge';
      badge.innerText = 'skiped';
      skuWrapper.appendChild(badge);
    }
  }

  alert(`Product ${code} skiped.\nLast recorded quantity applied: ${lastQty}`);
}

function removeSkipBadge(code) {
  if (skippedProducts.has(code)) {
    skippedProducts.delete(code);
    localStorage.setItem('inventorySkipped', JSON.stringify(Array.from(skippedProducts)));
  }
  const badge = document.getElementById('skip-badge-' + code);
  if (badge) {
    badge.remove();
  }
}

// ==========================================
// CALCULATOR math VIEW
// ==========================================
let currentCodeForCalc = null;
let calcCurrentVal = '0';
let calcResultShown = false;
let fullCalcLog = {};

function openCalc(code) {
  currentCodeForCalc = code;
  const currentVal = (quantities[code] === undefined || quantities[code] === null) ? "" : quantities[code];
  calcCurrentVal = (currentVal === "" || currentVal === 0) ? '0' : currentVal.toString();
  calcResultShown = false;

  renderCalcHistoryLog();
  document.getElementById('calcProductCode').innerText = `Counting: ${code}`;
  document.getElementById('calcHistory').innerText = '';
  updateCalcDisplay();

  const modal = document.getElementById('calcModal');
  modal.classList.remove('hidden');
  modal.classList.add('active'); // active uses flex
}

function renderCalcHistoryLog() {
  const logContainer = document.getElementById('calcHistoryLog');
  const hist = fullCalcLog[currentCodeForCalc] || [];
  logContainer.innerHTML = `<div>${hist.join(' | ')}</div>`;
}

function closeCalc() {
  const modal = document.getElementById('calcModal');
  modal.classList.remove('active');
  modal.classList.add('hidden');
}

function updateCalcDisplay() {
  const display = document.getElementById('calcDisplay');
  let visualStr = calcCurrentVal.replace(/\*/g, '×').replace(/\//g, '÷');
  display.innerText = visualStr;

  if (visualStr.length > 8) {
    display.classList.add('text-3xl');
  } else {
    display.classList.remove('text-3xl');
  }
}

function calcInput(char) {
  if (calcResultShown) {
    if (['+', '-', '*', '/'].includes(char)) {
      calcResultShown = false;
    } else {
      calcCurrentVal = '0';
      calcResultShown = false;
    }
  }

  if (calcCurrentVal === '0' && !['+', '-', '*', '/', ')', '.'].includes(char)) {
    calcCurrentVal = char;
  } else {
    calcCurrentVal += char;
  }
  updateCalcDisplay();
}

function calcOp(op) {
  if (calcResultShown) calcResultShown = false;

  const lastChar = calcCurrentVal.slice(-1);
  if (['+', '-', '*', '/'].includes(lastChar)) {
    calcCurrentVal = calcCurrentVal.slice(0, -1) + op;
  } else {
    calcCurrentVal += op;
  }
  updateCalcDisplay();
}

function calcEq() {
  try {
    const expression = calcCurrentVal.replace(/[^-()\d/*+.]/g, '');
    if (!expression) return;

    let res = Function('"use strict";return (' + expression + ')')();
    let roundedRes = Math.max(0, Math.round(res * 100) / 100);

    const calculationEntry = calcCurrentVal.replace(/\*/g, '×').replace(/\//g, '÷') + ' = ' + roundedRes;
    if (!fullCalcLog[currentCodeForCalc]) fullCalcLog[currentCodeForCalc] = [];
    fullCalcLog[currentCodeForCalc].push(calculationEntry);
    if (fullCalcLog[currentCodeForCalc].length > 4) fullCalcLog[currentCodeForCalc].shift();
    renderCalcHistoryLog();

    document.getElementById('calcHistory').innerText = calcCurrentVal.replace(/\*/g, '×').replace(/\//g, '÷') + ' =';
    calcCurrentVal = roundedRes.toString();
    calcResultShown = true;
    updateCalcDisplay();
  } catch (e) {
    document.getElementById('calcHistory').innerText = 'Error';
    setTimeout(() => { document.getElementById('calcHistory').innerText = ''; }, 1500);
  }
}

function calcClear() {
  calcCurrentVal = '0';
  calcResultShown = false;
  document.getElementById('calcHistory').innerText = '';
  updateCalcDisplay();
}

function calcDel() {
  if (calcResultShown) {
    calcClear();
    return;
  }
  if (calcCurrentVal.length > 1) {
    calcCurrentVal = calcCurrentVal.slice(0, -1);
  } else {
    calcCurrentVal = '0';
  }
  updateCalcDisplay();
}

function applyCalc() {
  removeSkipBadge(currentCodeForCalc);
  if (!calcResultShown && calcCurrentVal !== '0') {
    try {
      const expression = calcCurrentVal.replace(/[^-()\d/*+.]/g, '');
      let res = Function('"use strict";return (' + expression + ')')();
      calcCurrentVal = (Math.max(0, Math.round(res))).toString();
    } catch (e) { }
  }
  const val = parseInt(calcCurrentVal) || 0;
  quantities[currentCodeForCalc] = val;

  const input = document.getElementById('qty-' + currentCodeForCalc);
  if (val === 0) {
    input.value = "Out Of Stock";
    input.classList.add('out-of-stock');
  } else {
    input.value = val;
    input.classList.remove('out-of-stock');
  }

  localStorage.setItem('inventoryQuantities', JSON.stringify(quantities));
  closeCalc();

  // Highlight flash animation
  input.classList.add('apply-flash');
  setTimeout(() => input.classList.remove('apply-flash'), 500);
}

// ==========================================
// SUMMARY REVIEW PANEL (PAGE 3)
// ==========================================
function prepareSummary() {
  const auditData = [];
  let hasUncounted = false;

  products.forEach(p => {
    let q = quantities[p.Code];
    if (q === "" || q === undefined || q === null) {
      hasUncounted = true;
      auditData.push({
        Code: p.Code,
        Brand: p.Brand,
        Description: p.Description,
        Qty: "NOT COUNTED",
        isUncounted: true
      });
    } else {
      auditData.push({
        Code: p.Code,
        Brand: p.Brand,
        Description: p.Description,
        Qty: q
      });
    }
  });

  if (hasUncounted) {
    renderGroupedList(auditData, "Incomplete Count", "Please count all red items before submitting.", false);
  } else {
    renderGroupedList(auditData, `Stock as ${formatDateFull(new Date())}`, "All items counted successfully.", true);
  }
}

function renderGroupedList(dataArray, title, remark, showSubmit, saveToSession = true) {
  // Pre-process dataArray to fill in missing Brand, BrandRank, Description, and normalize Quantity
  const processedData = dataArray.map(item => {
    const code = item.Code || item.code || item.sku || item.SKU;
    const p = products.find(prod => prod.Code === code) || {};
    const isSkipped = item.Skipped || item.skipped || skippedProducts.has(code);
    return {
      ...item,
      Code: code,
      Brand: item.Brand || p.Brand || 'Unknown',
      BrandRank: p.BrandRank || 999,
      Description: item.Description || p.Description || 'No Description',
      Qty: item.Qty !== undefined ? item.Qty : (item.qty !== undefined ? item.qty : 0),
      Skipped: isSkipped
    };
  });
  dataArray = processedData;
  currentViewData = processedData;
  currentViewTitle = title;
  excludedBrands.clear(); 

  if (saveToSession) {
    localStorage.setItem('inventoryLastSummary', JSON.stringify({
      data: dataArray,
      title: title,
      remark: remark,
      showSubmit: showSubmit
    }));
  }

  document.getElementById('summaryTitle').innerText = title;
  document.getElementById('summaryRemark').innerText = remark;
  document.getElementById('submitBtnContainer').style.display = showSubmit ? 'block' : 'none';

  const container = document.getElementById('summaryListContainer');
  container.innerHTML = '';

  if (dataArray.length === 0) {
    container.innerHTML = `
      <div class="flex-center p-12 text-center text-gray-500">
        <i class="fa-solid fa-box-open text-4xl mb-3 text-gray-600"></i>
        <p>No items found.</p>
      </div>`;
    showPage('page3');
    return;
  }

  // Group by brand
  const grouped = dataArray.reduce((acc, item) => {
    const b = item.Brand || 'Unknown';
    if (!acc[b]) acc[b] = [];
    acc[b].push(item);
    return acc;
  }, {});

  // Sort inside brands
  Object.keys(grouped).forEach(brand => {
    grouped[brand].sort((a, b) => {
      const prodA = products.find(p => p.Code === a.Code) || a;
      const prodB = products.find(p => p.Code === b.Code) || b;
      return (prodA.Rank - prodB.Rank) || a.Code.localeCompare(b.Code);
    });
  });

  // Sort brands by rank
  const sortedBrands = Object.keys(grouped).sort((a, b) => {
    const rankA = grouped[a][0].BrandRank || 999;
    const rankB = grouped[b][0].BrandRank || 999;
    return (rankA - rankB) || a.localeCompare(b);
  });

  sortedBrands.forEach(brand => {
    const header = document.createElement('div');
    header.className = 'brand-group-header';
    header.style.position = 'sticky';
    header.style.top = '0';
    header.style.zIndex = '50';
    header.setAttribute('data-brand-header', brand.toLowerCase());

    const isHistoryView = !showSubmit && title.toLowerCase().includes('stock as');
    const checkboxHtml = isHistoryView ? `<input type="checkbox" checked onchange="toggleBrandFilter('${brand.replace(/'/g, "\\'")}', this.checked)" class="summary-brand-checkbox" />` : '';

    header.innerHTML = `
      <div class="flex-center" style="flex-direction:row; align-items:center;">
        ${checkboxHtml}
        <span><i class="fa-solid fa-tag text-purple-400 mr-2"></i>${brand}</span>
      </div>
      <span class="brand-badge">${grouped[brand].length} ITEMS</span>
    `;
    container.appendChild(header);

    grouped[brand].forEach(item => {
      const itemDiv = document.createElement('div');
      itemDiv.className = 'summary-item';
      itemDiv.setAttribute('data-search', `${item.Code} ${item.Description}`.toLowerCase());
      itemDiv.setAttribute('data-brand', brand.toLowerCase());

      if (item.isUncounted) {
        itemDiv.innerHTML = `
          <div class="summary-item-top">
            <div class="flex-center" style="flex-direction:row;">
              <span class="summary-item-sku text-rose-500">${item.Code}</span>
              <button onclick="openImageModal('${item.Code}')" class="info-help-btn text-rose-500" style="padding:0.25rem;"><i class="fa-solid fa-circle-info"></i></button>
            </div>
            <div class="summary-item-dots"></div>
            <span class="summary-item-qty qty-uncounted">NOT COUNTED</span>
          </div>
          <div class="summary-item-bottom">
            <span class="summary-item-desc text-rose-400/75">${item.Description}</span>
          </div>
        `;
      } else {
        let qtyDisplay = item.Qty === 0 ? "OOS" : item.Qty;
        let qtyClass = item.Qty === 0 ? "qty-oos" : "";

        if (item.Skipped) {
          qtyDisplay = `${qtyDisplay} (skiped)`;
        }

        let packStr = "";
        if (item.Qty > 0) {
          const prodRef = products.find(p => p.Code === item.Code);
          const packSize = prodRef ? prodRef.Pack : 0;

          if (packSize > 0) {
            const carton = Math.floor(item.Qty / packSize);
            const loose = item.Qty % packSize;
            let parts = [];
            if (carton > 0) parts.push(carton + " Ctn");
            if (loose > 0) parts.push(loose + " Lse");
            if (parts.length > 0) {
              packStr = `(${parts.join(' ')})`;
            }
          }
        }

        const skippedIndicator = item.Skipped ? `<span class="summary-skipped-tag">skiped</span>` : '';

        itemDiv.innerHTML = `
          <div class="summary-item-top">
            <div class="flex-center" style="flex-direction:row; align-items:center;">
              <span class="summary-item-sku">${item.Code}</span>
              <button onclick="openImageModal('${item.Code}')" class="info-help-btn" style="color:var(--color-text-secondary); padding:0.25rem;"><i class="fa-solid fa-circle-info"></i></button>
              ${skippedIndicator}
            </div>
            <div class="summary-item-dots"></div>
            <span class="summary-item-qty ${qtyClass}">${qtyDisplay}</span>
          </div>
          <div class="summary-item-bottom">
            <span class="summary-item-desc">${item.Description}</span>
            <span class="summary-item-pack">${packStr}</span>
          </div>
        `;
      }
      container.appendChild(itemDiv);
    });
  });

  showPage('page3');

  // Configure export button visibility in header (only for log reports)
  const exportBtn = document.getElementById('headerExportBtn');
  if (!showSubmit && title.toLowerCase().includes('stock as')) {
    exportBtn.classList.remove('hidden');
  } else {
    exportBtn.classList.add('hidden');
  }
}

function toggleBrandFilter(brand, isChecked) {
  if (isChecked) excludedBrands.delete(brand);
  else excludedBrands.add(brand);

  const brandLower = brand.toLowerCase();
  document.querySelectorAll(`#summaryListContainer [data-brand="${brandLower}"]`).forEach(el => {
    if (isChecked) el.classList.remove('hidden');
    else el.classList.add('hidden');
  });
}

// ==========================================
// SEARCH LOGIC
// ==========================================
function handleGlobalSearch() {
  const q = document.getElementById('globalSearchInput').value.trim().toLowerCase();
  
  if (!document.getElementById('page2').classList.contains('hidden')) {
    const querySet = new Set();
    const cards = document.querySelectorAll('#productsContainer .product-card');
    const headers = document.querySelectorAll('#productsContainer [data-brand-header]');

    cards.forEach(card => {
      const s = card.getAttribute('data-search') || "";
      const b = card.getAttribute('data-brand') || "";
      const isMatch = b.includes(q) || s.includes(q);

      if (isMatch) {
        card.classList.remove('hidden');
        querySet.add(b);
      } else {
        card.classList.add('hidden');
      }
    });

    headers.forEach(h => {
      const b = h.getAttribute('data-brand-header');
      if (querySet.has(b)) h.classList.remove('hidden');
      else h.classList.add('hidden');
    });
  } 
  else if (!document.getElementById('page3').classList.contains('hidden')) {
    const querySet = new Set();
    const items = document.querySelectorAll('#summaryListContainer .summary-item');
    const headers = document.querySelectorAll('#summaryListContainer [data-brand-header]');

    items.forEach(item => {
      const s = item.getAttribute('data-search') || "";
      const b = item.getAttribute('data-brand') || "";
      const isMatch = b.includes(q) || s.includes(q);

      if (isMatch) {
        item.classList.remove('hidden');
        querySet.add(b);
      } else {
        item.classList.add('hidden');
      }
    });

    headers.forEach(h => {
      const b = h.getAttribute('data-brand-header');
      if (querySet.has(b)) h.classList.remove('hidden');
      else h.classList.add('hidden');
    });
  }
}

// ==========================================
// SUBMISSION & SECURITY PIN MODAL
// ==========================================
let currentPin = '';
let pendingAuditData = null;

function submitData() {
  const auditData = [];
  let hasUncounted = false;
  
  products.forEach(p => {
    let q = quantities[p.Code];
    if (q === "" || q === undefined || q === null) {
      hasUncounted = true;
    } else {
      auditData.push({
        "sku": p.Code,
        "qty": quantities[p.Code],
        "skipped": skippedProducts.has(p.Code)
      });
    }
  });

  if (hasUncounted || auditData.length === 0) {
    alert("Cannot submit. Please make sure all items are counted.");
    return;
  }

  openPinModal(auditData);
}

function openPinModal(auditData) {
  pendingAuditData = auditData;
  currentPin = '';
  const input = document.getElementById('hiddenPinInput');
  input.value = '';

  const boxes = document.querySelectorAll('#pinModal .pin-box');
  boxes.forEach(box => {
    box.innerText = '';
    box.className = 'pin-box';
  });

  const modal = document.getElementById('pinModal');
  modal.classList.remove('hidden');
  modal.classList.add('active'); // flex view

  setTimeout(() => input.focus(), 100);
}

function closePinModal() {
  const modal = document.getElementById('pinModal');
  modal.classList.remove('active');
  modal.classList.add('hidden');
  document.getElementById('hiddenPinInput').blur();
}

function cancelPinModal() {
  closePinModal();
  pendingAuditData = null;
}

function handleHiddenPinInput(el) {
  let val = el.value.replace(/\D/g, ''); 
  el.value = val;
  currentPin = val;

  const boxes = document.querySelectorAll('#pinModal .pin-box');
  boxes.forEach((box, index) => {
    if (index < currentPin.length) {
      box.innerText = '•';
      box.classList.add('active');
    } else {
      box.innerText = '';
      box.classList.remove('active');
    }
  });

  if (currentPin.length === 4) {
    el.blur();
    setTimeout(validatePin, 150);
  }
}

function validatePin() {
  const storeKeeper = storeKeepers.find(s => s.pin === currentPin);
  
  if (storeKeeper) {
    closePinModal();
    finalizeSubmit(storeKeeper);
  } else {
    // Shake animation feedback
    const container = document.querySelector('#pinModal .pin-box-wrapper');
    container.classList.add('shake-animation');
    
    const boxes = document.querySelectorAll('#pinModal .pin-box');
    boxes.forEach(box => {
      box.innerText = '';
      box.classList.remove('active');
      box.classList.add('error');
    });

    setTimeout(() => {
      container.classList.remove('shake-animation');
      alert('Invalid security PIN! Please try again.');
      
      currentPin = '';
      const input = document.getElementById('hiddenPinInput');
      input.value = '';
      boxes.forEach(box => box.classList.remove('error'));
      setTimeout(() => input.focus(), 150);
    }, 350);
  }
}

function finalizeSubmit(storeKeeper) {
  const timestampIso = Date.now();

  // Add submission to local offline queue
  let pendingStr = localStorage.getItem('inventoryPendingSync');
  let pending = pendingStr ? JSON.parse(pendingStr) : [];
  pending.push({
    id: Date.now(),
    storeKeeperId: storeKeeper.id,
    payload: pendingAuditData
  });
  localStorage.setItem('inventoryPendingSync', JSON.stringify(pending));

  // Instantly prepend into local logs array for offline UI response
  logs.unshift({
    timestamp: timestampIso,
    data: pendingAuditData,
    submittedBy: storeKeeper.id
  });
  localStorage.setItem('inventoryLogs', JSON.stringify(logs));

  // Clear current count values
  products.forEach(p => quantities[p.Code] = "");
  localStorage.removeItem('inventoryQuantities');

  // Clear skipped products state
  skippedProducts.clear();
  localStorage.removeItem('inventorySkipped');

  alert("Success, " + storeKeeper.name + "!\nInventory count submitted.");
  showPage('page1');

  // Trigger sync in background
  syncSubmissions();
  pendingAuditData = null;
}

async function syncSubmissions() {
  let pendingStr = localStorage.getItem('inventoryPendingSync');
  if (!pendingStr) return;
  let pending = JSON.parse(pendingStr);

  if (pending.length === 0) return;

  const itemsToProcess = [...pending];
  let didSync = false;

  updateSyncStatus('loading');

  for (const item of itemsToProcess) {
    try {
      const safeStoreKeeperId = item.storeKeeperId || 'Unknown';
      
      const payload = {
        sheet: "Stock_Take_Log",
        action: "insert",
        data: {
          "Timestamp": item.id,
          "Audit by": safeStoreKeeperId,
          "Audit": JSON.stringify(item.payload) // Written as stringified JSON to Audit column
        }
      };

      const res = await fetch(`${WORKER_URL}/api/app/stock-take/write`, {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' }
      });

      if (!res.ok) {
        throw new Error(`Worker status ${res.status}`);
      }

      const result = await res.json();
      if (result && (result.success || result.status === 'success')) {
        let currentQueue = JSON.parse(localStorage.getItem('inventoryPendingSync') || "[]");
        currentQueue = currentQueue.filter(q => q.id !== item.id);
        localStorage.setItem('inventoryPendingSync', JSON.stringify(currentQueue));
        didSync = true;
      } else {
        throw new Error(result ? result.error : "Unknown error");
      }
    } catch (err) {
      console.error("Sync item failed:", err);
      updateSyncStatus('error');
      break; 
    }
  }

  if (didSync) {
    updateSyncStatus('loaded');
    fetchData(true);
  }
}

// ==========================================
// PDF GENERATION (JSPDF + AUTOTABLE)
// ==========================================
function handleExportAction(type) {
  const filteredData = currentViewData.filter(item => !excludedBrands.has(item.Brand));
  if (filteredData.length === 0) {
    alert("No visible data available to export. Please check at least one brand.");
    return;
  }
  exportToPDF(filteredData);
}

function exportToPDF(dataToExport) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(18);
  doc.text(currentViewTitle, 14, 22);
  doc.setFontSize(11);
  doc.setTextColor(100);
  doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 30);

  const tableData = dataToExport.map(item => {
    const prod = products.find(p => p.Code === item.Code);
    const packSize = prod ? prod.Pack : 0;
    let packDetails = "-";
    if (item.Qty > 0 && packSize > 0) {
      const carton = Math.floor(item.Qty / packSize);
      const loose = item.Qty % packSize;
      let parts = [];
      if (carton > 0) parts.push(`${carton} Carton`);
      if (loose > 0) parts.push(`${loose} Loose`);
      packDetails = parts.join(' ');
    } else if (item.Qty === 0) {
      packDetails = "Out of Stock";
    }

    let qtyText = item.Qty === 0 || item.Qty === "OOS" ? "OOS" : item.Qty;
    if (item.Skipped) {
      qtyText = `${qtyText} (skiped)`;
      packDetails = packDetails === "-" ? "skiped" : `${packDetails} (skiped)`;
    }

    return [
      item.Code,
      item.Description,
      qtyText,
      packDetails
    ];
  });

  doc.autoTable({
    startY: 35,
    head: [['Code', 'Description', 'Qty', 'Packaging Details']],
    body: tableData,
    theme: 'striped',
    headStyles: { fillColor: [139, 92, 246], textColor: [255, 255, 255] }, // Purple Header
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: {
      0: { cellWidth: 30, fontStyle: 'bold' },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 20, halign: 'center' },
      3: { cellWidth: 35 }
    }
  });

  doc.save(`${currentViewTitle.replace(/\s+/g, '_')}.pdf`);
}

// ==========================================
// MODALS UTILITIES
// ==========================================
function openImageModal(code) {
  const p = products.find(prod => prod.Code === code);
  if (!p) return;

  const modal = document.getElementById('imageModal');
  const img = document.getElementById('imageModalImg');
  const codeEl = document.getElementById('imageModalCode');
  const descEl = document.getElementById('imageModalDesc');

  const finalImg = getProductImg(p);
  img.src = finalImg;
  img.onerror = () => { img.onerror = null; img.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%231e293b'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='24' font-weight='900' fill='%23475569'%3E?%3C/text%3E%3C/svg%3E"; };

  codeEl.innerText = p.Code;
  descEl.innerText = p.Description;

  modal.classList.remove('hidden');
  modal.classList.add('active'); // active uses flex
}

function closeImageModal() {
  const modal = document.getElementById('imageModal');
  modal.classList.remove('active');
  modal.classList.add('hidden');
}

// Overwrite default browser alert window
window.alert = function (message, buttonText = "OK, GOT IT", onConfirm = null) {
  const modal = document.getElementById('customAlertModal');
  const box = document.getElementById('customAlertBox');
  const icon = document.getElementById('customAlertIcon');
  const title = document.getElementById('customAlertTitle');
  const msgEl = document.getElementById('customAlertMessage');
  const btn = document.getElementById('customAlertBtn');

  msgEl.innerText = message;
  if (btn) {
    btn.innerText = buttonText;
    btn.onclick = function () {
      closeCustomAlert();
      if (onConfirm) onConfirm();
    };
  }

  const msgLower = message.toLowerCase();
  if (msgLower.includes('error') || msgLower.includes('invalid') || msgLower.includes('cannot') || msgLower.includes('failed') || msgLower.includes('no data') || msgLower.includes('havent')) {
    title.innerText = 'Action Required';
    icon.className = 'alert-icon-wrapper icon-red';
    icon.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
  } else if (msgLower.includes('success') || msgLower.includes('saved') || msgLower.includes('submitted')) {
    title.innerText = 'Success';
    icon.className = 'alert-icon-wrapper icon-green';
    icon.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
  } else {
    title.innerText = 'Notification';
    icon.className = 'alert-icon-wrapper icon-blue';
    icon.innerHTML = '<i class="fa-solid fa-bell"></i>';
  }

  modal.classList.remove('hidden');
  modal.classList.add('active'); // active uses flex
};

function closeCustomAlert() {
  const modal = document.getElementById('customAlertModal');
  modal.classList.remove('active');
  modal.classList.add('hidden');
}

// ==========================================
// CONVERSION & DISPLAY FORMATTERS
// ==========================================
function getStoreKeeperDisplay(id) {
  if (!id) return 'Unknown Name';
  const sk = storeKeepers.find(s => s.id === id);
  return sk ? sk.name : id;
}

function parseTimestamp(ts) {
  if (!ts) return 0;
  if (/^\d+$/.test(String(ts).trim())) {
    const val = parseInt(ts);
    return val < 50000000000 ? val * 1000 : val;
  }
  const parsed = new Date(ts).getTime();
  return isNaN(parsed) ? 0 : parsed;
}

function formatDateFull(date) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = new Date(parseTimestamp(date));
  return `${d.getDate().toString().padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

// ==========================================
// STRESS TEST UTILITY
// ==========================================
let versionClicks = 0;
function handleVersionClick() {
  versionClicks++;
  if (versionClicks >= 5) {
    versionClicks = 0;
    if (confirm("Run Stress Test? (Generates 500 mock products)")) {
      runStressTest();
    }
  }
}

function runStressTest() {
  const mockBrands = ['BRAND-X', 'BRAND-Y', 'ALPHA', 'OMEGA', 'ZETA'];
  const stressProducts = [];
  for (let i = 1; i <= 500; i++) {
    const brand = mockBrands[Math.floor(Math.random() * mockBrands.length)];
    stressProducts.push({
      Code: `STRESS-${i.toString().padStart(3, '0')}`,
      Description: `Stress Test Product ${i} for Brand ${brand}`,
      Brand: brand,
      Pack: 12,
      Rank: i,
      ImgLink: ""
    });
  }

  products = stressProducts;
  quantities = {};
  products.forEach(p => quantities[p.Code] = "");

  alert(`Stress Test Loaded!\n500 items generated. UI optimized.`);
  renderProducts();
  showPage('page2');
}
