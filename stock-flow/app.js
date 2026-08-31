// Desktop Redirect Check
if (window.innerWidth >= 900 || window.matchMedia("(min-width: 900px)").matches) {
  window.location.replace("../index.html");
}

// iOS / Mobile gesture and zoom prevention
document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
document.addEventListener('touchstart', function (event) { if (event.touches.length > 1) event.preventDefault(); }, { passive: false });
document.addEventListener('wheel', function (e) { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
document.addEventListener('keydown', function (e) { if (e.ctrlKey && (e.key === '=' || e.key === '-' || e.key === '0' || e.key === '+')) e.preventDefault(); });

// ==========================================
// CONFIGURATION & CORE STATE
// ==========================================
const WORKER_URL = 'https://ib-v2.hsgglobalpteltd.workers.dev';

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
    try {
      const parsed = JSON.parse(cachedProducts);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(p => p.Description !== undefined && p.Description !== null)) {
        products = parsed;
        isDataReady = true;
      } else {
        localStorage.removeItem('inventoryProducts');
      }
    } catch (e) {
      localStorage.removeItem('inventoryProducts');
    }
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

  // Auto-scroll input into focus when keyboard opens on mobile
  setupKeyboardScrollHandling();

  // Run initial sync & fetch
  backgroundSync();
});

function setupKeyboardScrollHandling() {
  document.addEventListener('focusin', (e) => {
    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
      setTimeout(() => {
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      }, 300);
    }
  });
}

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

    // Fetch in parallel from Cloudflare Worker secure proxy to Supabase REST API
    const [prodRes, brandRes, logsRes, usersRes] = await Promise.all([
      fetch(`${WORKER_URL}/api/app4/products?t=${Date.now()}`),
      fetch(`${WORKER_URL}/api/app4/brands?t=${Date.now()}`),
      fetch(`${WORKER_URL}/api/app4/logs?t=${Date.now()}`),
      fetch(`${WORKER_URL}/api/app4/users?t=${Date.now()}`)
    ]);

    if (!prodRes.ok || !brandRes.ok || !logsRes.ok || !usersRes.ok) {
      throw new Error("One or more network requests failed");
    }

    const rawProducts = await prodRes.json();
    const rawBrands = await brandRes.json();
    const rawLogs = await logsRes.json();
    const rawUsers = await usersRes.json();

    const prodList = Array.isArray(rawProducts) ? rawProducts : (rawProducts.products || rawProducts.value || rawProducts.data || []);
    const brandList = Array.isArray(rawBrands) ? rawBrands : (rawBrands.value || rawBrands.brands || rawBrands.data || []);
    const logsList = Array.isArray(rawLogs) ? rawLogs : (rawLogs.value || rawLogs.logs || rawLogs.data || []);
    const usersList = Array.isArray(rawUsers) ? rawUsers : (rawUsers.value || rawUsers.users || rawUsers.data || []);

    // 1. Map Brands (handle any casing)
    const brandMap = {};
    brandList.forEach(b => {
      const bId = b.ID || b.id || b.brands_id;
      if (bId) {
        brandMap[bId] = {
          name: b['Display Name'] || b.display_name || b.name || "Brand",
          rank: parseInt(b.Rank || b.rank) || 999
        };
      }
    });

    // 2. Map Products and normalize - ONLY Active & Non-Archived Products
    products = prodList.filter(p => {
      const status = String(p.Status || p.status || p.State || p.state || 'Active').trim().toLowerCase();
      const archived = p.Archived === true || p.archived === true || String(p.Archived) === 'true' || String(p.archived) === 'true';
      if (archived) return false;
      if (status === 'inactive' || status === 'archived' || status === 'disabled' || status === 'draft' || status === 'deleted') return false;
      return true;
    }).map(p => {
      const brandId = p['Brands ID'] || p.brands_id || p.brand_id || p.Brand_ID || '';
      const bInfo = brandMap[brandId] || { name: p.Brand || p.brand || "General", rank: 999 };
      const sku = p.SKU || p.sku || p.Code || p.code || '';
      const desc = p['Display Name'] || p.display_name || p.Description || p.description || p.name || sku;
      const img = p.Image || p.image || p.ImgLink || '';
      const pack = parseInt(p.Carton || p.carton || p.Pack) || 0;
      const rank = parseInt(p.Rank || p.rank) || 999;
      return {
        Code: sku,
        sku: sku,
        Description: desc,
        name: desc,
        ImgLink: img,
        Image: img,
        Pack: pack,
        Rank: rank,
        Brand: bInfo.name,
        BrandRank: bInfo.rank
      };
    });

    // 3. Map and parse Logs
    logs = logsList.map(l => {
      let auditData = [];
      try {
        const rawData = typeof l.audit === 'string' ? JSON.parse(l.audit) : l.audit;
        if (Array.isArray(rawData)) {
          auditData = rawData.map(item => ({
            Code: item.sku || item.code || item.Code || item.SKU,
            Qty: item.qty !== undefined ? item.qty : item.Qty,
            Skipped: item.skipped || item.Skipped || false
          }));
        }
      } catch (e) {
        console.warn("Failed to parse Audit JSON for log at " + (l.timestamp || l.Timestamp), e);
      }
      return {
        timestamp: l.timestamp || l.Timestamp,
        submittedBy: l.audit_by || l['Audit By'],
        data: auditData
      };
    }).filter(l => l.data && l.data.length > 0);

    // 4. Set Storekeepers (filter employees with app role 'Warehouse')
    storeKeepers = rawUsers.filter(emp => {
      const isArchived = emp.archived === true || emp.archived === 1 || String(emp.archived) === "true";
      if (isArchived) return false;
      try {
        if (!emp.role) return false;
        const roles = typeof emp.role === "string" ? JSON.parse(emp.role) : emp.role;
        return Array.isArray(roles) && roles.includes("Warehouse");
      } catch {
        return false;
      }
    }).map(u => ({
      id: u.id,
      name: u.name,
      pin: String(u.pin || "").trim()
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

  // Handle Google Drive image mapping - request 200px thumbnail
  if (link.includes('drive.google.com') || link.includes('googleusercontent.com')) {
    let fileId = '';
    if (link.includes('/d/')) fileId = link.split('/d/')[1].split('/')[0];
    else if (link.includes('id=')) fileId = link.split('id=')[1].split('&')[0];
    if (fileId) return `https://drive.google.com/thumbnail?id=${fileId}&sz=w200`;
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

  const allPages = ['page1', 'page2', 'page3', 'pageManageStock', 'pageManageStockStep2', 'pageStockCardSummary'];
  allPages.forEach(p => {
    const el = document.getElementById(p);
    if (el) {
      el.classList.add('hidden');
      el.classList.remove('active');
    }
  });

  const target = document.getElementById(pageId);
  if (target) {
    target.classList.remove('hidden');
    target.classList.add('active');
  }

  if (pageId === 'page2') {
    const savedScroll = localStorage.getItem('inventoryScrollPage2');
    if (savedScroll) {
      setTimeout(() => {
        const container = document.getElementById('productsContainer');
        if (container) container.scrollTop = parseInt(savedScroll);
      }, 50);
    }
  }

  const backBtn = document.getElementById('backBtn');
  const searchBtn = document.getElementById('headerSearchBtn');
  const addStockBtn = document.getElementById('headerAddStockBtn');
  const titleEl = document.getElementById('mainHeaderTitle');

  if (titleEl) {
    if (pageId === 'pageManageStock') {
      titleEl.textContent = 'Manage Stock';
    } else if (pageId === 'pageManageStockStep2') {
      titleEl.textContent = 'Stock Details';
    } else if (pageId === 'pageStockCardSummary') {
      titleEl.textContent = 'Review Transaction';
    } else {
      titleEl.textContent = 'iB - Stock Flow';
    }
  }

  if (pageId === 'page1') {
    if (backBtn) backBtn.classList.add('hidden');
    if (searchBtn) searchBtn.classList.add('hidden');
    if (addStockBtn) addStockBtn.classList.add('hidden');
  } else if (pageId === 'pageManageStock') {
    if (backBtn) backBtn.classList.remove('hidden');
    if (searchBtn) searchBtn.classList.add('hidden');
    if (addStockBtn) addStockBtn.classList.remove('hidden');
  } else if (pageId === 'pageManageStockStep2' || pageId === 'pageStockCardSummary') {
    if (backBtn) backBtn.classList.remove('hidden');
    if (searchBtn) searchBtn.classList.add('hidden');
    if (addStockBtn) addStockBtn.classList.add('hidden');
  } else {
    if (backBtn) backBtn.classList.remove('hidden');
    if (searchBtn) searchBtn.classList.remove('hidden');
    if (addStockBtn) addStockBtn.classList.add('hidden');
  }
}

function goBack() {
  if (!document.getElementById('pageStockCardSummary').classList.contains('hidden')) {
    showPage('pageManageStockStep2');
  } else if (!document.getElementById('pageManageStockStep2').classList.contains('hidden')) {
    showPage('pageManageStock');
  } else if (!document.getElementById('pageManageStock').classList.contains('hidden')) {
    showPage('page1');
  } else if (!document.getElementById('page3').classList.contains('hidden')) {
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
let currentCalcContext = 'page2';
let stockFlowCalcLogs = {};

try {
  const savedCalcLogs = localStorage.getItem('stockFlowCalcLogs');
  if (savedCalcLogs) stockFlowCalcLogs = JSON.parse(savedCalcLogs);
} catch (e) {}

function openCalc(code) {
  currentCalcContext = 'page2';
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

function openStockCardCalc(code) {
  currentCalcContext = 'stockCard';
  currentCodeForCalc = code;
  const item = (stockCardState && stockCardState.items) ? stockCardState.items.find(i => i.sku === code) : null;
  const currentVal = item ? item.qty : 1;
  calcCurrentVal = (currentVal === "" || currentVal === 0) ? '0' : currentVal.toString();
  calcResultShown = false;

  renderCalcHistoryLog();
  document.getElementById('calcProductCode').innerText = `Counting: ${code}`;
  document.getElementById('calcHistory').innerText = '';
  updateCalcDisplay();

  const modal = document.getElementById('calcModal');
  modal.classList.remove('hidden');
  modal.classList.add('active');
}

function renderCalcHistoryLog() {
  const logContainer = document.getElementById('calcHistoryLog');
  if (!logContainer) return;
  const hist = (currentCalcContext === 'stockCard' ? (stockFlowCalcLogs[currentCodeForCalc] || []) : (fullCalcLog[currentCodeForCalc] || []));
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
    
    if (currentCalcContext === 'stockCard') {
      if (!stockFlowCalcLogs[currentCodeForCalc]) stockFlowCalcLogs[currentCodeForCalc] = [];
      stockFlowCalcLogs[currentCodeForCalc].push(calculationEntry);
      if (stockFlowCalcLogs[currentCodeForCalc].length > 4) stockFlowCalcLogs[currentCodeForCalc].shift();
      localStorage.setItem('stockFlowCalcLogs', JSON.stringify(stockFlowCalcLogs));
    } else {
      if (!fullCalcLog[currentCodeForCalc]) fullCalcLog[currentCodeForCalc] = [];
      fullCalcLog[currentCodeForCalc].push(calculationEntry);
      if (fullCalcLog[currentCodeForCalc].length > 4) fullCalcLog[currentCodeForCalc].shift();
    }
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
  if (currentCalcContext === 'page2') {
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
    if (input) {
      if (val === 0) {
        input.value = "Out Of Stock";
        input.classList.add('out-of-stock');
      } else {
        input.value = val;
        input.classList.remove('out-of-stock');
      }
      input.classList.add('apply-flash');
      setTimeout(() => input.classList.remove('apply-flash'), 500);
    }

    localStorage.setItem('inventoryQuantities', JSON.stringify(quantities));
    closeCalc();
  } else if (currentCalcContext === 'stockCard') {
    if (!calcResultShown && calcCurrentVal !== '0') {
      try {
        const expression = calcCurrentVal.replace(/[^-()\d/*+.]/g, '');
        let res = Function('"use strict";return (' + expression + ')')();
        calcCurrentVal = (Math.max(0, Math.round(res))).toString();
      } catch (e) { }
    }
    const val = Math.max(1, parseInt(calcCurrentVal) || 1);
    const item = (stockCardState && stockCardState.items) ? stockCardState.items.find(i => i.sku === currentCodeForCalc) : null;
    if (item) {
      item.qty = val;
    }
    renderStockCardItems();
    closeCalc();

    setTimeout(() => {
      const input = document.getElementById('sc-qty-' + currentCodeForCalc);
      if (input) {
        input.classList.add('apply-flash');
        setTimeout(() => input.classList.remove('apply-flash'), 500);
      }
    }, 100);
  }
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
  if (input) input.value = '';

  const boxes = document.querySelectorAll('#pin-auth-overlay .pin-digit-display');
  boxes.forEach(box => {
    box.innerText = '';
    box.className = 'pin-digit-display';
  });

  const overlay = document.getElementById('pin-auth-overlay');
  if (overlay) overlay.classList.remove('hidden');

  setTimeout(() => input && input.focus(), 150);
}

function closePinModal() {
  const overlay = document.getElementById('pin-auth-overlay');
  if (overlay) overlay.classList.add('hidden');
  const input = document.getElementById('hiddenPinInput');
  if (input) input.blur();
}

function cancelPinModal() {
  closePinModal();
  pendingAuditData = null;
  pendingStockCardData = null;
}

function handleHiddenPinInput(el) {
  let val = el.value.replace(/\D/g, ''); 
  el.value = val;
  currentPin = val;

  const boxes = document.querySelectorAll('#pin-auth-overlay .pin-digit-display');
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
  // Find authorized staff in storeKeepers, portal session, or cached employees
  let authorizedStaff = storeKeepers.find(s => String(s.pin || '').trim() === currentPin);
  
  if (!authorizedStaff) {
    try {
      const portalUserStr = localStorage.getItem('ib_auth_user');
      if (portalUserStr) {
        const pUser = JSON.parse(portalUserStr);
        if (String(pUser.pin || '').trim() === currentPin) {
          authorizedStaff = pUser;
        }
      }
    } catch (_) {}
  }

  if (!authorizedStaff) {
    try {
      const empCached = JSON.parse(localStorage.getItem('ib_employees') || '[]');
      if (Array.isArray(empCached)) {
        authorizedStaff = empCached.find(e => String(e.pin || '').trim() === currentPin);
      }
    } catch (_) {}
  }
  
  if (authorizedStaff) {
    closePinModal();
    if (pendingStockCardData) {
      finalizeStockCardSubmit(authorizedStaff);
    } else if (pendingAuditData) {
      finalizeSubmit(authorizedStaff);
    }
  } else {
    // Shake animation feedback
    const wrapper = document.getElementById('pin-digits-wrapper');
    if (wrapper) wrapper.classList.add('shake-animation');
    
    const boxes = document.querySelectorAll('#pin-auth-overlay .pin-digit-display');
    boxes.forEach(box => {
      box.innerText = '';
      box.classList.remove('active');
      box.classList.add('error');
    });

    setTimeout(() => {
      if (wrapper) wrapper.classList.remove('shake-animation');
      alert('Invalid security PIN! Please try again.', 'TRY AGAIN', () => {
        const input = document.getElementById('hiddenPinInput');
        if (input) {
          input.value = '';
          input.focus();
        }
      });
      
      currentPin = '';
      const input = document.getElementById('hiddenPinInput');
      if (input) input.value = '';
      boxes.forEach(box => box.classList.remove('error'));
    }, 400);
  }
}

// ==========================================
// STOCK CARD / MANAGE STOCK LOGIC
// ==========================================
let stockCardState = {
  action: 'Stock Out',
  items: [], // [{ sku, name, qty, image, carton }]
  hasDoc: false,
  refNumber: '',
  description: '',
  approvedBy: '',
  photoFile: null,
  photoPreviewUrl: '',
  trxId: ''
};

let administratorsList = [];
let pendingStockCardData = null;

async function fetchAdministrators() {
  try {
    const res = await fetch(`${WORKER_URL}/api/app4/admins`);
    if (res.ok) {
      administratorsList = await res.json();
      populateApprovedByDropdown();
    }
  } catch (err) {
    console.warn("Could not load administrators:", err);
  }
}

function populateApprovedByDropdown() {
  const select = document.getElementById('stockCardApprovedBy');
  if (!select) return;
  
  const currentVal = select.value;
  select.innerHTML = '<option value="">Select Approval...</option>';
  
  (administratorsList || []).forEach(adm => {
    const opt = document.createElement('option');
    opt.value = adm.name || adm.email;
    opt.textContent = adm.name || adm.email;
    select.appendChild(opt);
  });

  if (currentVal) select.value = currentVal;
  checkStockFlowFormValidity();
}

function checkStockFlowFormValidity() {
  const footer = document.getElementById('footerReviewStockFlow');
  if (!footer) return false;

  // 1. Action must be selected
  if (!stockCardState || !stockCardState.action) {
    footer.classList.add('hidden');
    return false;
  }

  // 2. Must have at least 1 product with valid qty >= 1
  if (!stockCardState.items || stockCardState.items.length === 0) {
    footer.classList.add('hidden');
    return false;
  }
  const hasInvalidQty = stockCardState.items.some(i => !i.qty || i.qty < 1);
  if (hasInvalidQty) {
    footer.classList.add('hidden');
    return false;
  }

  // 3. If hasDoc is true, ref number is required
  if (stockCardState.hasDoc) {
    const refVal = (document.getElementById('stockCardRefNumber')?.value || '').trim();
    if (!refVal) {
      footer.classList.add('hidden');
      return false;
    }
    stockCardState.refNumber = refVal;
  }

  // 4. Approved by is required
  const approvedByVal = (document.getElementById('stockCardApprovedBy')?.value || '').trim();
  if (!approvedByVal) {
    footer.classList.add('hidden');
    return false;
  }
  stockCardState.approvedBy = approvedByVal;

  // 5. Photos: Minimum 1 photo, Maximum 8 photos
  const photoCount = (stockCardState.photos || []).length;
  if (photoCount < 1 || photoCount > 8) {
    footer.classList.add('hidden');
    return false;
  }

  // All mandatory inputs are complete
  footer.classList.remove('hidden');
  return true;
}

function openManageStock() {
  let savedDraft = [];
  try {
    const raw = localStorage.getItem('stockFlowDraftItems');
    if (raw) savedDraft = JSON.parse(raw);
  } catch (e) {}

  stockCardState = {
    action: 'Stock Out',
    items: Array.isArray(savedDraft) ? savedDraft : [],
    hasDoc: false,
    refNumber: '',
    description: '',
    approvedBy: '',
    photos: [],
    trxId: ''
  };

  selectStockCardAction('Stock Out');
  setDocumentToggle(false);
  
  const descEl = document.getElementById('stockCardDescription');
  if (descEl) descEl.value = '';
  
  const refEl = document.getElementById('stockCardRefNumber');
  if (refEl) refEl.value = '';

  renderStockCardPhotoGallery();
  renderStockCardItems();
  fetchAdministrators();
  checkStockFlowFormValidity();
  
  showPage('pageManageStock');
}

function selectStockCardAction(action) {
  stockCardState.action = action;

  // Update pills
  const pills = document.querySelectorAll('.action-pill');
  pills.forEach(pill => {
    const attr = pill.getAttribute('onclick') || '';
    if (attr.includes(`'${action}'`)) {
      pill.classList.add('active');
    } else {
      pill.classList.remove('active');
    }
  });

  checkStockFlowFormValidity();
}

function setDocumentToggle(hasDoc) {
  stockCardState.hasDoc = hasDoc;
  const noBtn = document.getElementById('docToggleNo');
  const yesBtn = document.getElementById('docToggleYes');
  const wrapper = document.getElementById('docRefInputWrapper');

  if (noBtn && yesBtn) {
    if (hasDoc) {
      yesBtn.classList.add('active');
      noBtn.classList.remove('active');
      if (wrapper) wrapper.classList.remove('hidden');
    } else {
      noBtn.classList.add('active');
      yesBtn.classList.remove('active');
      if (wrapper) wrapper.classList.add('hidden');
    }
  }

  checkStockFlowFormValidity();
}

function appendPretext(text) {
  const desc = document.getElementById('stockCardDescription');
  if (!desc) return;
  const current = desc.value.trim();
  if (!current) {
    desc.value = text;
  } else if (!current.includes(text)) {
    desc.value = `${current} - ${text}`;
  }
  checkStockFlowFormValidity();
}

function renderStockCardItems() {
  const container = document.getElementById('stockCardItemsContainer');
  const footerStep1 = document.getElementById('footerManageStockStep1');
  if (!container) return;

  // Persist draft in localStorage
  localStorage.setItem('stockFlowDraftItems', JSON.stringify(stockCardState.items));

  if (!stockCardState.items || stockCardState.items.length === 0) {
    container.innerHTML = `
      <div id="scEmptyPlaceholder" class="empty-items-box-large" onclick="openProductPickerModal()">
        <i class="fa-solid fa-boxes-stacked text-4xl text-slate-300 mb-2"></i>
        <span class="text-base font-bold text-slate-700">No stock items added</span>
        <span class="text-xs font-normal text-slate-400 mt-1">Tap here or the + button above to select products</span>
      </div>`;
    if (footerStep1) footerStep1.classList.add('hidden');
    return;
  }

  container.innerHTML = '';
  stockCardState.items.forEach((item) => {
    const p = products.find(prod => prod.Code === item.sku) || { Code: item.sku, Description: item.name || '', Brand: '' };
    const finalImg = getProductImg(p);
    const calcHist = stockFlowCalcLogs[item.sku] || [];
    const latestCalc = calcHist.length > 0 ? calcHist[calcHist.length - 1] : '';

    const card = document.createElement('div');
    card.className = 'product-card mb-3';

    card.innerHTML = `
      <div class="product-info-row">
        <img src="${finalImg}" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'100\\' height=\\'100\\' viewBox=\\'0 0 100 100\\'%3E%3Crect width=\\'100\\' height=\\'100\\' fill=\\'%231e293b\\'/%3E%3Ctext x=\\'50%25\\' y=\\'50%25\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\' font-family=\\'sans-serif\\' font-size=\\'24\\' font-weight=\\'900\\' fill=\\'%23475569\\'%3E?%3C/text%3E%3C/svg%3E'" class="product-img" />
        <div class="product-details">
          <div class="sku-info-wrapper">
            <h3 class="product-sku">${p.Code}</h3>
            <button type="button" onclick="openImageModal('${p.Code}')" class="info-help-btn">
              <i class="fa-solid fa-circle-question"></i>
            </button>
          </div>
          <p class="product-desc">${p.Description || item.name || ''}</p>
          ${latestCalc ? `<div class="text-[11px] font-semibold text-purple-600 mt-1"><i class="fa-solid fa-calculator mr-1"></i>${latestCalc}</div>` : ''}
        </div>
      </div>
      <div class="product-control-row">
        <div class="quantity-adjuster">
          <button type="button" class="adjust-btn adjust-btn-minus" onclick="updateStockCardItemQty('${p.Code}', -1)">-</button>
          <input type="text" inputmode="numeric" id="sc-qty-${p.Code}" class="quantity-input" value="${item.qty}" onchange="setStockCardItemQty('${p.Code}', this.value)" onclick="this.select()" />
          <button type="button" class="adjust-btn adjust-btn-plus" onclick="updateStockCardItemQty('${p.Code}', 1)">+</button>
        </div>
        <button type="button" class="card-calc-btn" onclick="openStockCardCalc('${p.Code}')" style="margin-right: 0.4rem;" title="Count with Calculator">
          <i class="fa-solid fa-calculator"></i>
        </button>
        <button type="button" class="card-trash-btn" onclick="removeStockCardItem('${p.Code}')" title="Remove Item">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    `;
    container.appendChild(card);
  });

  const hasValidQty = stockCardState.items.some(i => i.qty > 0);
  if (footerStep1) {
    if (hasValidQty) {
      footerStep1.classList.remove('hidden');
    } else {
      footerStep1.classList.add('hidden');
    }
  }
}

function updateStockCardItemQty(sku, change) {
  const item = stockCardState.items.find(i => i.sku === sku);
  if (item) {
    item.qty = Math.max(1, (item.qty || 1) + change);
    renderStockCardItems();
  }
}

function setStockCardItemQty(sku, valStr) {
  const item = stockCardState.items.find(i => i.sku === sku);
  if (item) {
    const parsed = parseInt(valStr, 10);
    item.qty = isNaN(parsed) || parsed < 1 ? 1 : parsed;
    renderStockCardItems();
  }
}

function removeStockCardItem(sku) {
  stockCardState.items = stockCardState.items.filter(i => i.sku !== sku);
  delete stockFlowCalcLogs[sku];
  localStorage.setItem('stockFlowCalcLogs', JSON.stringify(stockFlowCalcLogs));
  renderStockCardItems();
}

function goToManageStockStep2() {
  if (!stockCardState.items || stockCardState.items.length === 0) {
    alert("Please select at least 1 product.");
    return;
  }
  const hasInvalid = stockCardState.items.some(i => !i.qty || i.qty < 1);
  if (hasInvalid) {
    alert("Please ensure all products have a valid quantity of at least 1.");
    return;
  }
  checkStockFlowFormValidity();
  showPage('pageManageStockStep2');
}

// Product Picker Modal
function openProductPickerModal() {
  const modal = document.getElementById('productPickerModal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('active');
  }
  const searchInput = document.getElementById('pickerSearchInput');
  if (searchInput) {
    searchInput.value = '';
    if (document.activeElement === searchInput) {
      searchInput.blur();
    }
  }
  filterProductPicker();
}

function closeProductPickerModal() {
  const modal = document.getElementById('productPickerModal');
  if (modal) {
    modal.classList.remove('active');
    modal.classList.add('hidden');
  }
}

function filterProductPicker() {
  const rawQ = (document.getElementById('pickerSearchInput')?.value || '').trim().toLowerCase();
  const container = document.getElementById('pickerProductsList');
  if (!container) return;

  container.innerHTML = '';
  
  // Split search into individual words/tokens for flexible multi-part search (1:50 by word)
  const tokens = rawQ.split(/\s+/).filter(Boolean);

  const matched = (products || []).filter(p => {
    if (tokens.length === 0) return true;
    const target = `${p.Code || ''} ${p.Description || ''} ${p.Brand || ''}`.toLowerCase();
    return tokens.every(token => target.includes(token));
  });

  // Sort by Brand first, then by Code (SKU)
  matched.sort((a, b) => {
    const brandA = (a.Brand || '').trim().toLowerCase();
    const brandB = (b.Brand || '').trim().toLowerCase();
    if (brandA !== brandB) {
      return brandA.localeCompare(brandB);
    }
    return (a.Code || '').trim().localeCompare((b.Code || '').trim());
  });

  if (matched.length === 0) {
    container.innerHTML = '<div class="p-6 text-center text-slate-400 text-xs font-normal">No products found matching all keywords.</div>';
    return;
  }

  // Display top 50 matches (1:50 limit for fast scanning)
  const displayLimit = 50;
  const itemsToRender = matched.slice(0, displayLimit);

  itemsToRender.forEach(p => {
    const isSelected = (stockCardState.items || []).some(i => i.sku === p.Code);
    const finalImg = getProductImg(p);
    const div = document.createElement('div');
    div.className = `picker-product-item ${isSelected ? 'selected' : ''}`;
    div.setAttribute('style', `display: flex !important; flex-direction: row !important; align-items: center !important; justify-content: space-between !important; background-color: ${isSelected ? '#ECFDF5' : '#FFFFFF'} !important; border: 1.5px solid ${isSelected ? '#10B981' : '#E2E8F0'} !important; border-radius: 12px !important; padding: 0.6rem 0.75rem !important; cursor: pointer !important; width: 100% !important; box-sizing: border-box !important; margin-bottom: 0.4rem !important;`);
    div.onclick = () => toggleProductInStockCard(p);

    div.innerHTML = `
      <img src="${finalImg}" class="picker-prod-img" style="width:52px !important;height:52px !important;min-width:52px !important;max-width:52px !important;min-height:52px !important;max-height:52px !important;object-fit:cover !important;border-radius:8px !important;flex-shrink:0 !important;margin-right:0.75rem !important;display:block !important;background-color:#F1F5F9 !important;border:1px solid #E2E8F0 !important;" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'100\\' height=\\'100\\' viewBox=\\'0 0 100 100\\'%3E%3Crect width=\\'100\\' height=\\'100\\' fill=\\'%231e293b\\'/%3E%3Ctext x=\\'50%25\\' y=\\'50%25\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\' font-family=\\'sans-serif\\' font-size=\\'24\\' font-weight=\\'900\\' fill=\\'%23475569\\'%3E?%3C/text%3E%3C/svg%3E'" />
      <div class="picker-prod-info" style="flex:1 1 auto !important;min-width:0 !important;display:flex !important;flex-direction:column !important;justify-content:center !important;overflow:hidden !important;text-align:left !important;">
        <div class="picker-prod-sku-row" style="display:flex !important;flex-direction:row !important;align-items:center !important;gap:6px !important;overflow:hidden !important;width:100% !important;">
          <span class="picker-prod-sku" style="font-size:1.05rem !important;font-weight:800 !important;color:#0F172A !important;line-height:1.2 !important;white-space:nowrap !important;">${p.Code}</span>
          ${p.Brand ? `<span class="picker-prod-brand" style="font-size:0.68rem !important;font-weight:700 !important;color:#7C3AED !important;background:#F3E8FF !important;padding:1px 6px !important;border-radius:6px !important;white-space:nowrap !important;text-transform:uppercase !important;">${p.Brand}</span>` : ''}
        </div>
        <div class="picker-prod-name" style="font-size:0.8rem !important;font-weight:500 !important;color:#64748B !important;white-space:nowrap !important;overflow:hidden !important;text-overflow:ellipsis !important;margin-top:2px !important;line-height:1.3 !important;width:100% !important;display:block !important;">${p.Description || ''}</div>
      </div>
      <div class="picker-check-btn" style="flex:0 0 auto !important;flex-shrink:0 !important;margin-left:0.75rem !important;display:flex !important;align-items:center !important;justify-content:center !important;">
        <i class="fa-solid ${isSelected ? 'fa-circle-check text-emerald-600' : 'fa-circle-plus text-slate-300'}" style="font-size:1.5rem !important;"></i>
      </div>
    `;
    container.appendChild(div);
  });

  if (matched.length > displayLimit) {
    const moreNotice = document.createElement('div');
    moreNotice.className = 'text-center py-2 text-[11px] text-slate-400 font-normal';
    moreNotice.textContent = `Showing 50 of ${matched.length} products. Type more to narrow down.`;
    container.appendChild(moreNotice);
  }
}

function toggleProductInStockCard(p) {
  const existing = stockCardState.items.find(i => i.sku === p.Code);
  if (existing) {
    stockCardState.items = stockCardState.items.filter(i => i.sku !== p.Code);
  } else {
    stockCardState.items.push({
      sku: p.Code,
      name: p.Description || p.Code,
      qty: 1,
      carton: p.Pack || 1
    });
  }
  filterProductPicker();
  renderStockCardItems();
}

// Multi-Photo Upload Logic (1 to 8 photos)
function handleStockCardPhotoSelect(input) {
  if (!input.files || input.files.length === 0) return;

  if (!stockCardState.photos) stockCardState.photos = [];
  
  const currentCount = stockCardState.photos.length;
  const remainingSlots = 8 - currentCount;

  if (remainingSlots <= 0) {
    alert("You have reached the maximum limit of 8 photos.");
    input.value = '';
    return;
  }

  const filesToAdd = Array.from(input.files).slice(0, remainingSlots);
  if (input.files.length > remainingSlots) {
    alert(`Only ${remainingSlots} photo(s) added. Maximum limit is 8 photos.`);
  }

  let processed = 0;
  filesToAdd.forEach(file => {
    const reader = new FileReader();
    reader.onload = (e) => {
      stockCardState.photos.push({
        file: file,
        previewUrl: e.target.result
      });
      processed++;
      if (processed === filesToAdd.length) {
        renderStockCardPhotoGallery();
      }
    };
    reader.readAsDataURL(file);
  });

  input.value = '';
}

function renderStockCardPhotoGallery() {
  const gallery = document.getElementById('stockCardPhotoGallery');
  const countBadge = document.getElementById('photoCountBadge');
  if (!gallery) return;

  if (!stockCardState.photos) stockCardState.photos = [];
  const count = stockCardState.photos.length;

  if (countBadge) {
    countBadge.textContent = `(${count}/8)`;
    if (count >= 1 && count <= 8) {
      countBadge.className = 'text-xs font-semibold text-emerald-600';
    } else {
      countBadge.className = 'text-xs font-semibold text-slate-500';
    }
  }

  gallery.innerHTML = '';

  // Render photo thumbnails (compact 4-column container)
  stockCardState.photos.forEach((p, idx) => {
    const thumb = document.createElement('div');
    thumb.className = 'photo-thumb-item';
    thumb.setAttribute('style', 'position: relative !important; width: 100% !important; aspect-ratio: 1 / 1 !important; max-height: 75px !important; border-radius: 8px !important; overflow: hidden !important; border: 1.5px solid #CBD5E1 !important; background-color: #FFFFFF !important; display: flex !important; align-items: center !important; justify-content: center !important; box-sizing: border-box !important;');
    thumb.innerHTML = `
      <img src="${p.previewUrl}" alt="Photo ${idx + 1}" class="photo-thumb-img" style="width: 100% !important; height: 100% !important; max-width: 100% !important; max-height: 100% !important; object-fit: cover !important; display: block !important;" />
      <button type="button" onclick="removeStockCardPhotoItem(${idx})" class="photo-thumb-remove" style="position: absolute !important; top: 3px !important; right: 3px !important; width: 22px !important; height: 22px !important; border-radius: 50% !important; background: rgba(0, 0, 0, 0.7) !important; border: none !important; color: white !important; display: flex !important; align-items: center !important; justify-content: center !important; cursor: pointer !important; font-size: 0.7rem !important; z-index: 2 !important;" title="Remove Photo">
        <i class="fa-solid fa-xmark"></i>
      </button>
    `;
    gallery.appendChild(thumb);
  });

  // Render Add Photo tile if count < 8
  if (count < 8) {
    const addTile = document.createElement('div');
    addTile.id = 'photoAddTile';
    addTile.className = 'photo-add-tile';
    addTile.setAttribute('style', 'width: 100% !important; aspect-ratio: 1 / 1 !important; max-height: 75px !important; border: 1.5px dashed #0B57D0 !important; border-radius: 8px !important; display: flex !important; flex-direction: column !important; align-items: center !important; justify-content: center !important; text-align: center !important; background-color: #F0F4F9 !important; cursor: pointer !important; padding: 0.2rem !important; box-sizing: border-box !important;');
    addTile.onclick = () => document.getElementById('stockCardPhotoInput').click();
    addTile.innerHTML = `
      <i class="fa-solid fa-camera text-xl text-[#0B57D0] mb-0.5"></i>
      <span class="text-[11px] font-semibold text-slate-700 leading-tight">Add Photo</span>
      <span class="text-[9px] text-slate-400 font-medium">${count}/8</span>
    `;
    gallery.appendChild(addTile);
  }

  checkStockFlowFormValidity();
}

function removeStockCardPhotoItem(index) {
  if (stockCardState.photos && stockCardState.photos[index]) {
    stockCardState.photos.splice(index, 1);
    renderStockCardPhotoGallery();
  }
}

// Review Transaction
function reviewStockCardTransaction() {
  if (stockCardState.items.length === 0) {
    alert("Please select at least 1 product.");
    return;
  }

  const descVal = (document.getElementById('stockCardDescription')?.value || '').trim();
  stockCardState.description = descVal;

  if (stockCardState.hasDoc) {
    const refVal = (document.getElementById('stockCardRefNumber')?.value || '').trim();
    if (!refVal) {
      alert("Please enter the Delivery Order / Transfer / Stock Issue reference number.");
      document.getElementById('stockCardRefNumber')?.focus();
      return;
    }
    stockCardState.refNumber = refVal;
  } else {
    stockCardState.refNumber = '';
  }

  const approvedByVal = (document.getElementById('stockCardApprovedBy')?.value || '').trim();
  if (!approvedByVal) {
    alert("Please select who gave approval from the Administrator dropdown.");
    document.getElementById('stockCardApprovedBy')?.focus();
    return;
  }
  stockCardState.approvedBy = approvedByVal;

  // Check minimum 1 photo, maximum 8 photos
  const photoCount = (stockCardState.photos || []).length;
  if (photoCount < 1) {
    alert("Please attach at least 1 picture (minimum 1, maximum 8 photos)!");
    return;
  }
  if (photoCount > 8) {
    alert("Maximum 8 photos allowed.");
    return;
  }

  // Generate unique transaction ID: SF-YYYYMMDD-XXXX
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const rand4 = Math.floor(1000 + Math.random() * 9000);
  stockCardState.trxId = `SF-${yyyy}${mm}${dd}-${rand4}`;

  // Populate Summary View
  document.getElementById('scSummaryTrxId').textContent = `Transaction ID: ${stockCardState.trxId}`;
  
  const actionBanner = document.getElementById('scSummaryActionBanner');
  const actionText = document.getElementById('scSummaryActionText');
  actionText.textContent = stockCardState.action.toUpperCase();
  actionBanner.className = 'summary-action-banner';
  if (stockCardState.action === 'Stock In') actionBanner.classList.add('stock-in');
  else if (stockCardState.action === 'Transfer stock to Tiktok Fulfillment') actionBanner.classList.add('transfer');

  const itemsList = document.getElementById('scSummaryItemsList');
  itemsList.innerHTML = '';
  let totalUnits = 0;
  stockCardState.items.forEach(item => {
    totalUnits += item.qty;
    const row = document.createElement('div');
    row.className = 'summary-item-row';
    row.innerHTML = `
      <div class="flex flex-col min-w-0 flex-1">
        <span class="font-bold text-slate-800 text-[13px]">${item.sku}</span>
        <span class="text-xs text-slate-500 truncate mt-0.5">${item.name}</span>
      </div>
      <span class="font-bold text-[#0B57D0] text-[13px] ml-2 flex-shrink-0">${item.qty} units</span>
    `;
    itemsList.appendChild(row);
  });
  document.getElementById('scSummaryTotalQty').textContent = `${totalUnits} units`;

  document.getElementById('scSummaryDocRef').textContent = stockCardState.hasDoc ? stockCardState.refNumber : 'None';
  document.getElementById('scSummaryDescription').textContent = stockCardState.description || '—';
  document.getElementById('scSummaryApprovedBy').textContent = stockCardState.approvedBy;

  // Multi-Photo Summary Review
  const photoBlock = document.getElementById('scSummaryPhotoBlock');
  const photoGrid = document.getElementById('scSummaryPhotoGrid');
  const photoCountEl = document.getElementById('scSummaryPhotoCount');

  if (photoCount > 0) {
    photoBlock.classList.remove('hidden');
    if (photoCountEl) photoCountEl.textContent = `(${photoCount} photo${photoCount > 1 ? 's' : ''})`;
    if (photoGrid) {
      photoGrid.innerHTML = '';
      stockCardState.photos.forEach((p, idx) => {
        const thumb = document.createElement('div');
        thumb.className = 'summary-photo-thumb';
        thumb.setAttribute('style', 'width: 100% !important; aspect-ratio: 1 / 1 !important; max-height: 75px !important; border-radius: 8px !important; overflow: hidden !important; border: 1px solid #CBD5E1 !important; background-color: #FFFFFF !important; display: flex !important; align-items: center !important; justify-content: center !important;');
        thumb.innerHTML = `<img src="${p.previewUrl}" alt="Proof ${idx + 1}" style="width: 100% !important; height: 100% !important; max-width: 100% !important; max-height: 100% !important; object-fit: cover !important; display: block !important;" />`;
        photoGrid.appendChild(thumb);
      });
    }
  } else {
    photoBlock.classList.add('hidden');
  }

  showPage('pageStockCardSummary');
}

function promptPinForStockCard() {
  pendingStockCardData = { ...stockCardState };
  currentPin = '';
  const input = document.getElementById('hiddenPinInput');
  if (input) input.value = '';

  const boxes = document.querySelectorAll('#pin-auth-overlay .pin-digit-display');
  boxes.forEach(box => {
    box.innerText = '';
    box.className = 'pin-digit-display';
  });

  const overlay = document.getElementById('pin-auth-overlay');
  if (overlay) overlay.classList.remove('hidden');

  setTimeout(() => input && input.focus(), 150);
}

async function finalizeStockCardSubmit(authorizedStaff) {
  updateSyncStatus('loading');
  const btn = document.getElementById('btnSubmitStockCard');
  if (btn) btn.disabled = true;

  try {
    let uploadedPhotoUrls = [];
    // 1. Upload photos concurrently (1 to 8 photos)
    if (pendingStockCardData.photos && pendingStockCardData.photos.length > 0) {
      const uploadPromises = pendingStockCardData.photos.map(async (p, idx) => {
        try {
          const fileName = `stock-flow-${pendingStockCardData.trxId}-${idx + 1}-${Date.now()}.jpg`;
          const uploadRes = await fetch(`${WORKER_URL}/api/app4/upload?filename=${encodeURIComponent(fileName)}`, {
            method: 'POST',
            headers: { 'Content-Type': p.file.type || 'image/jpeg' },
            body: p.file
          });
          if (uploadRes.ok) {
            const uploadData = await uploadRes.json();
            return uploadData.url || '';
          }
        } catch (uploadErr) {
          console.warn("Photo upload warning for index", idx, uploadErr);
        }
        return '';
      });

      const results = await Promise.all(uploadPromises);
      uploadedPhotoUrls = results.filter(Boolean);
    }

    // 2. Submit to stock-flow endpoint
    const payload = {
      id: pendingStockCardData.trxId,
      action_type: pendingStockCardData.action,
      items: pendingStockCardData.items,
      total_qty: pendingStockCardData.items.reduce((acc, i) => acc + (i.qty || 0), 0),
      has_document: pendingStockCardData.hasDoc,
      ref_number: pendingStockCardData.refNumber,
      description: pendingStockCardData.description,
      approved_by: pendingStockCardData.approvedBy,
      photo_url: uploadedPhotoUrls.join(','),
      photo_urls: uploadedPhotoUrls,
      created_by: authorizedStaff.name || 'Operator',
      created_by_pin: authorizedStaff.pin || currentPin,
      created_at: Date.now()
    };

    const res = await fetch(`${WORKER_URL}/api/app4/stock-flow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`Server returned error ${res.status}`);
    }

    alert(`Success!\nTransaction ${payload.id} recorded into Stock Flow.`);
    localStorage.removeItem('stockFlowDraftItems');
    localStorage.removeItem('stockFlowCalcLogs');
    stockFlowCalcLogs = {};
    stockCardState = {
      action: 'Stock Out',
      items: [],
      hasDoc: false,
      refNumber: '',
      description: '',
      approvedBy: '',
      photos: [],
      trxId: ''
    };
    pendingStockCardData = null;
    showPage('page1');
  } catch (err) {
    alert("Error saving transaction: " + err.message);
  } finally {
    if (btn) btn.disabled = false;
    updateSyncStatus('success');
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
        sheet: "stock_take_log",
        action: "insert",
        data: {
          timestamp: String(item.id),
          audit_by: safeStoreKeeperId,
          audit: JSON.stringify(item.payload)
        }
      };

      const res = await fetch(`${WORKER_URL}/api/app4/write`, {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { 
          'Content-Type': 'application/json'
        }
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
