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
let stockMovements = [];
let currentSelectedBrand = '';
let lastSummarySourcePage = 'page2';
let isDataReady = false;
let isDataStale = false;
let currentViewData = [];
let currentViewTitle = "";
let excludedBrands = new Set();
let skippedProducts = new Set();

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ==========================================
// LIFE CYCLE & INITIALIZATION
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
  const cachedProducts = localStorage.getItem('inventoryProducts');
  const cachedLogs = localStorage.getItem('inventoryLogs');
  const cachedStoreKeepers = localStorage.getItem('inventoryStoreKeepers');
  const cachedStockMovements = localStorage.getItem('inventoryStockMovements');

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
  if (cachedStockMovements) {
    try { stockMovements = JSON.parse(cachedStockMovements); } catch (e) {}
  }

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

  // Clean up any heavy image cache to free up mobile localStorage completely
  try {
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('img_cache_')) {
        localStorage.removeItem(key);
      }
    });
  } catch (_) {}

  // Initialize Slide To Submit sliders
  initSlideToSubmit();
  initSlideToAuditSubmit();

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
  await fetchData(true);
}

async function fetchData(silent = true) {
  isDataStale = false;

  try {
    updateSyncStatus('loading');

    // Fetch in parallel from Cloudflare Worker secure proxy to Supabase REST API
    const [prodRes, brandRes, logsRes, usersRes, smRes] = await Promise.all([
      fetch(`${WORKER_URL}/api/app4/products?t=${Date.now()}`),
      fetch(`${WORKER_URL}/api/app4/brands?t=${Date.now()}`),
      fetch(`${WORKER_URL}/api/app4/logs?t=${Date.now()}`),
      fetch(`${WORKER_URL}/api/app4/users?t=${Date.now()}`),
      fetch(`${WORKER_URL}/api/app4/stock-movement?t=${Date.now()}`)
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
      const bId = b.ID || b.id || b.brands_id || b.Brands_ID;
      const bName = b['Display Name'] || b.display_name || b.name || b.Name || "Brand";
      const bRank = parseInt(b.Rank || b.rank) || 999;
      if (bId) {
        brandMap[bId] = { name: bName, rank: bRank };
      }
      brandMap[bName.toLowerCase().trim()] = { name: bName, rank: bRank };
    });

    // 2. Map Products and normalize - ONLY Active & Non-Archived Products
    products = prodList.filter(p => {
      const status = String(p.Status || p.status || p.State || p.state || '').trim().toLowerCase();
      const archived = p.Archived === true || p.archived === true || String(p.Archived) === 'true' || String(p.archived) === 'true';
      if (archived) return false;
      if (p.status === false || p.Status === false) return false;
      if (status && (status === 'inactive' || status === 'archived' || status === 'disabled' || status === 'draft' || status === 'deleted' || status === 'false' || status === '0')) return false;
      return true;
    }).map(p => {
      const brandId = p['Brands ID'] || p.brands_id || p.brand_id || p.Brand_ID || '';
      const rawBrandName = String(p.Brand || p.brand || p['Brand Name'] || p.brand_name || '').trim();
      const bInfo = brandMap[brandId] || brandMap[rawBrandName.toLowerCase()] || { name: rawBrandName || "General", rank: 999 };
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

    // Sort products by BrandRank, Brand Name, Product Rank, and SKU Code
    products.sort((a, b) => {
      if (a.BrandRank !== b.BrandRank) return a.BrandRank - b.BrandRank;
      if (a.Brand !== b.Brand) return a.Brand.localeCompare(b.Brand);
      if (a.Rank !== b.Rank) return a.Rank - b.Rank;
      return a.Code.localeCompare(b.Code);
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

    // 5. Map Stock Movements (Manage Stock history)
    try {
      if (smRes && smRes.ok) {
        const rawSm = await smRes.json();
        const smList = Array.isArray(rawSm) ? rawSm : (rawSm.value || rawSm.data || []);
        stockMovements = smList.map(m => {
          let itemsList = [];
          try {
            const rawItems = typeof m.items === 'string' ? JSON.parse(m.items) : (m.items || []);
            if (Array.isArray(rawItems)) {
              itemsList = rawItems.map(it => ({
                sku: it.sku || it.SKU || it.code || it.Code || '',
                qty: parseInt(it.qty !== undefined ? it.qty : it.Qty) || 0
              }));
            }
          } catch (e) {}
          return {
            id: m.id,
            timestamp: parseTimestamp(m.timestamp),
            action_type: String(m.action_type || m.action || '').trim(),
            items: itemsList
          };
        });
        localStorage.setItem('inventoryStockMovements', JSON.stringify(stockMovements));
      }
    } catch (e) {
      console.warn("Failed to parse stock movements:", e);
    }

    // Sort logs descending
    logs.sort((a, b) => parseTimestamp(b.timestamp) - parseTimestamp(a.timestamp));

    // Save to local storage
    localStorage.setItem('inventoryProducts', JSON.stringify(products));
    localStorage.setItem('inventoryLogs', JSON.stringify(logs));
    localStorage.setItem('inventoryStoreKeepers', JSON.stringify(storeKeepers));
    isDataReady = true;

    if (!document.getElementById('page2').classList.contains('hidden')) {
      renderProducts();
    } else if (!document.getElementById('pageCurrentStock').classList.contains('hidden')) {
      openCurrentStock();
    } else if (!document.getElementById('pageCurrentStockBrand').classList.contains('hidden') && currentSelectedBrand) {
      openBrandProducts(currentSelectedBrand);
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
// IMAGE RESOLVER (LIGHTWEIGHT & FAST)
// ==========================================
function getProductImg(p) {
  const defaultImg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%231e293b'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='24' font-weight='900' fill='%23475569'%3E?%3C/text%3E%3C/svg%3E";
  if (!p) return defaultImg;

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

  const allPages = ['page1', 'page2', 'page3', 'pageManageStock', 'pageManageStockStep2', 'pageStockCardSummary', 'pageCurrentStock', 'pageCurrentStockBrand'];
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
      titleEl.textContent = 'Select Stock';
    } else if (pageId === 'pageManageStockStep2') {
      titleEl.textContent = 'Select Action';
    } else if (pageId === 'pageStockCardSummary') {
      titleEl.textContent = 'Summary';
    } else if (pageId === 'pageCurrentStock') {
      titleEl.textContent = 'Current Stock';
    } else if (pageId === 'pageCurrentStockBrand') {
      titleEl.textContent = currentSelectedBrand || 'Brand Products';
    } else if (pageId === 'page2') {
      titleEl.textContent = 'Stock Take';
    } else if (pageId === 'page3') {
      titleEl.textContent = 'Stock Take Summary';
    } else {
      titleEl.textContent = 'iB - Stock Flow';
    }
  }

  const refreshBtn = document.getElementById('headerRefreshBtn');

  if (pageId === 'page1') {
    if (backBtn) backBtn.classList.add('hidden');
    if (searchBtn) searchBtn.classList.add('hidden');
    if (addStockBtn) addStockBtn.classList.add('hidden');
    if (refreshBtn) refreshBtn.classList.remove('hidden');
  } else if (pageId === 'pageManageStock') {
    if (backBtn) backBtn.classList.remove('hidden');
    if (searchBtn) searchBtn.classList.add('hidden');
    if (addStockBtn) addStockBtn.classList.remove('hidden');
    if (refreshBtn) refreshBtn.classList.add('hidden');
  } else if (pageId === 'pageManageStockStep2' || pageId === 'pageStockCardSummary') {
    if (backBtn) backBtn.classList.remove('hidden');
    if (searchBtn) searchBtn.classList.add('hidden');
    if (addStockBtn) addStockBtn.classList.add('hidden');
    if (refreshBtn) refreshBtn.classList.add('hidden');
  } else {
    if (backBtn) backBtn.classList.remove('hidden');
    if (searchBtn) searchBtn.classList.remove('hidden');
    if (addStockBtn) addStockBtn.classList.add('hidden');
    if (refreshBtn) refreshBtn.classList.add('hidden');
  }
}

async function manualRefresh() {
  const icon = document.querySelector('#headerRefreshBtn i');
  if (icon) icon.classList.add('fa-spin');
  try {
    await refreshAllData();
  } catch (e) {
    console.error("Refresh failed:", e);
  } finally {
    setTimeout(() => {
      if (icon) icon.classList.remove('fa-spin');
    }, 600);
  }
}

function goBack() {
  if (!document.getElementById('pageCurrentStockBrand').classList.contains('hidden')) {
    showPage('pageCurrentStock');
  } else if (!document.getElementById('pageCurrentStock').classList.contains('hidden')) {
    showPage('page1');
  } else if (!document.getElementById('pageStockCardSummary').classList.contains('hidden')) {
    showPage('pageManageStockStep2');
  } else if (!document.getElementById('pageManageStockStep2').classList.contains('hidden')) {
    showPage('pageManageStock');
  } else if (!document.getElementById('pageManageStock').classList.contains('hidden')) {
    showPage('page1');
  } else if (!document.getElementById('page3').classList.contains('hidden')) {
    if (lastSummarySourcePage === 'pageCurrentStock') {
      showPage('pageCurrentStock');
    } else {
      showPage('page2');
    }
  } else if (!document.getElementById('page2').classList.contains('hidden')) {
    showPage('page1');
  }
}

// ==========================================
// REAL-TIME CURRENT STOCK CALCULATION
// ==========================================
function calculateCurrentStock(productCode) {
  let baselineQty = 0;
  let baselineTimestamp = 0;
  let hasBaseline = false;

  // 1. Find the latest stock take baseline for this productCode
  if (Array.isArray(logs)) {
    for (const log of logs) {
      if (Array.isArray(log.data)) {
        const item = log.data.find(d => String(d.Code).trim().toLowerCase() === String(productCode).trim().toLowerCase());
        if (item && item.Qty !== undefined && item.Qty !== null && item.Qty !== "" && item.Qty !== "NOT COUNTED") {
          baselineQty = parseInt(item.Qty) || 0;
          baselineTimestamp = parseTimestamp(log.timestamp);
          hasBaseline = true;
          break;
        }
      }
    }
  }

  // 2. Aggregate movements recorded after baselineTimestamp
  let inQty = 0;
  let outQty = 0;
  let transferQty = 0;

  if (Array.isArray(stockMovements)) {
    stockMovements.forEach(m => {
      if (m.timestamp > baselineTimestamp) {
        const item = m.items.find(it => String(it.sku).trim().toLowerCase() === String(productCode).trim().toLowerCase());
        if (item && item.qty) {
          const act = m.action_type.toLowerCase();
          if (act.includes('in')) {
            inQty += item.qty;
          } else if (act.includes('transfer')) {
            transferQty += item.qty;
          } else if (act.includes('out')) {
            outQty += item.qty;
          } else {
            outQty += item.qty;
          }
        }
      }
    });
  }

  const currentQty = baselineQty + inQty - outQty - transferQty;
  return {
    currentQty,
    baselineQty,
    baselineTimestamp,
    inQty,
    outQty,
    transferQty,
    hasBaseline
  };
}

// ==========================================
// HOME PAGE ACTIONS & CURRENT STOCK
// ==========================================
function openCurrentStock() {
  if (!isDataReady) {
    alert("Data is syncing. Please wait a few seconds...");
    return;
  }

  // Set top banner last stock take date
  const lastDateEl = document.getElementById('currentStockLastTakeDate');
  if (lastDateEl) {
    let lastDateStr = '';
    if (Array.isArray(logs) && logs.length > 0 && logs[0].timestamp) {
      lastDateStr = formatDateFull(logs[0].timestamp);
    } else {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      lastDateStr = formatDateFull(y);
    }
    lastDateEl.textContent = lastDateStr;
  }

  // Group active products by Brand
  const brandGroupMap = {};
  products.forEach(p => {
    const bName = p.Brand || 'Other';
    if (!brandGroupMap[bName]) {
      brandGroupMap[bName] = {
        name: bName,
        rank: p.BrandRank || 999,
        items: []
      };
    }
    brandGroupMap[bName].items.push(p);
  });

  const brandList = Object.values(brandGroupMap).sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.name.localeCompare(b.name);
  });

  const grid = document.getElementById('currentStockBrandsGrid');
  if (grid) {
    grid.innerHTML = brandList.map(b => `
      <div class="brand-grid-card" onclick="openBrandProducts(this.getAttribute('data-brand-name'))" data-brand-name="${escapeHtml(b.name)}" data-brand="${escapeHtml(b.name.toLowerCase())}">
        <span class="brand-grid-card-name">${escapeHtml(b.name)}</span>
        <span class="brand-grid-card-count">${b.items.length} ${b.items.length === 1 ? 'ITEM' : 'ITEMS'}</span>
      </div>
    `).join('');
  }

  showPage('pageCurrentStock');
}

function openBrandProducts(brandName) {
  currentSelectedBrand = brandName;
  const brandProducts = products.filter(p => p.Brand === brandName);

  const container = document.getElementById('currentStockProductsList');
  if (container) {
    container.innerHTML = brandProducts.map(p => {
      const stockInfo = calculateCurrentStock(p.Code);
      const qty = stockInfo.currentQty;
      
      // Calculate packaging carton breakdown
      let packStr = "";
      if (p.Pack && p.Pack > 1) {
        const ctns = Math.floor(Math.abs(qty) / p.Pack);
        const pcs = Math.abs(qty) % p.Pack;
        const sign = qty < 0 ? "-" : "";
        if (ctns > 0 && pcs > 0) {
          packStr = `(${sign}${ctns} Ctn ${pcs} Pcs)`;
        } else if (ctns > 0) {
          packStr = `(${sign}${ctns} Ctn)`;
        } else {
          packStr = `(${sign}${pcs} Pcs)`;
        }
      }

      const qtyDisplay = qty === 0 ? "0" : qty.toLocaleString();
      const qtyClass = qty < 0 ? "text-rose-600 font-bold" : (qty === 0 ? "text-slate-400 font-bold" : "text-slate-900 font-bold");

      return `
        <div class="summary-item" data-search="${escapeHtml(p.Code.toLowerCase())} ${escapeHtml(p.Description.toLowerCase())}">
          <div class="summary-item-top">
            <div class="flex-center" style="flex-direction:row; align-items:center;">
              <span class="summary-item-sku">${escapeHtml(p.Code)}</span>
              <button onclick="openImageModal('${escapeHtml(p.Code)}')" class="info-help-btn" style="color:var(--color-text-secondary); padding:0.25rem;">
                <i class="fa-solid fa-circle-info"></i>
              </button>
            </div>
            <div class="summary-item-dots"></div>
            <span class="summary-item-qty ${qtyClass}">${qtyDisplay}</span>
          </div>
          <div class="summary-item-bottom">
            <span class="summary-item-desc">${escapeHtml(p.Description)}</span>
            <span class="summary-item-pack">${packStr}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  showPage('pageCurrentStockBrand');
}

function showLatestStockTake(sourcePage = 'page2') {
  lastSummarySourcePage = sourcePage;
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

  // Update top bar last stock take date text
  const lastDateEl = document.getElementById('lastStockTakeDateText');
  if (lastDateEl) {
    let lastDateStr = '';
    if (Array.isArray(logs) && logs.length > 0 && logs[0].timestamp) {
      lastDateStr = formatDateFull(logs[0].timestamp);
    } else {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      lastDateStr = formatDateFull(y);
    }
    lastDateEl.textContent = lastDateStr;
  }

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
      <span><i class="fa-solid fa-tag text-slate-700 mr-2"></i>${brand}</span>
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
        <span><i class="fa-solid fa-tag text-slate-700 mr-2"></i>${brand}</span>
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

  resetSlideToAuditSubmit();
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
  
  if (!document.getElementById('pageCurrentStock').classList.contains('hidden')) {
    const cards = document.querySelectorAll('#currentStockBrandsGrid .brand-grid-card');
    cards.forEach(card => {
      const b = card.getAttribute('data-brand') || "";
      if (b.includes(q)) {
        card.classList.remove('hidden');
      } else {
        card.classList.add('hidden');
      }
    });
  }
  else if (!document.getElementById('pageCurrentStockBrand').classList.contains('hidden')) {
    const items = document.querySelectorAll('#currentStockProductsList .summary-item');
    items.forEach(item => {
      const s = item.getAttribute('data-search') || "";
      if (s.includes(q)) {
        item.classList.remove('hidden');
      } else {
        item.classList.add('hidden');
      }
    });
  }
  else if (!document.getElementById('page2').classList.contains('hidden')) {
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
    resetSlideToAuditSubmit();
    return;
  }

  // Directly submit audit using logged in employee session (no PIN auth)
  const staffName = getLoggedInEmployee() || 'Warehouse Staff';
  pendingAuditData = auditData;
  finalizeSubmit({ id: staffName, name: staffName });
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
  resetSlideToAuditSubmit();
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

function getLoggedInEmployee() {
  try {
    const raw = localStorage.getItem('ib_auth_user') || localStorage.getItem('currentUser') || localStorage.getItem('user');
    if (raw) {
      const parsed = JSON.parse(raw);
      return parsed.name || parsed.Name || parsed.display_name || parsed.username || '';
    }
  } catch (_) {}
  return '';
}

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
  select.innerHTML = '<option value="">Select Approval...</option><option value="N/A">N/A</option>';
  
  (administratorsList || []).forEach(adm => {
    const opt = document.createElement('option');
    opt.value = adm.name || adm.email;
    opt.textContent = adm.name || adm.email;
    select.appendChild(opt);
  });

  const isTransfer = (stockCardState.action === 'Transfer' || stockCardState.action === 'Transfer stock to Tiktok Fulfillment' || stockCardState.action === 'Stock Transfer');
  if (isTransfer) {
    select.value = 'N/A';
    stockCardState.approvedBy = 'N/A';
  } else if (currentVal) {
    select.value = currentVal;
  }
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

  const isTransfer = (stockCardState.action === 'Transfer' || stockCardState.action === 'Transfer stock to Tiktok Fulfillment' || stockCardState.action === 'Stock Transfer');

  if (isTransfer) {
    stockCardState.hasDoc = false;
    stockCardState.refNumber = '';
    stockCardState.approvedBy = 'N/A';
  } else {
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
  }

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

const ACTION_PRETEXT_MAP = {
  'Stock Out': [
    'Internal Use',
    'Sample',
    'Replacement Tiktok',
    'Marketing',
    'Dispose',
    'Damage',
    'Expired',
    'Return to Supplier'
  ],
  'Stock In': [
    'Stock Return',
    'New Stock',
    'Cancel Order'
  ]
};

function updateDescriptionByAction(action) {
  const descEl = document.getElementById('stockCardDescription');
  const badgeContainer = document.getElementById('pretextBadgesContainer');
  if (!descEl || !badgeContainer) return;

  const isTransfer = (action === 'Transfer' || action === 'Transfer stock to Tiktok Fulfillment' || action === 'Stock Transfer');

  if (isTransfer) {
    descEl.value = 'Transfer Goods to Tiktok.';
    descEl.readOnly = true;
    descEl.style.backgroundColor = '#F1F5F9';
    descEl.style.color = '#475569';
    descEl.style.cursor = 'not-allowed';
    stockCardState.description = 'Transfer Goods to Tiktok.';
    badgeContainer.innerHTML = '';
    badgeContainer.classList.add('hidden');
  } else {
    descEl.readOnly = false;
    descEl.style.backgroundColor = '#FFFFFF';
    descEl.style.color = '#0F172A';
    descEl.style.cursor = 'text';

    if (descEl.value === 'Transfer Goods to Tiktok.') {
      descEl.value = '';
      stockCardState.description = '';
    }

    badgeContainer.classList.remove('hidden');
    const badges = ACTION_PRETEXT_MAP[action] || ACTION_PRETEXT_MAP['Stock Out'];
    badgeContainer.innerHTML = badges.map(b => `
      <button type="button" class="pretext-badge" onclick="appendPretext('${b.replace(/'/g, "\\'")}')">${b}</button>
    `).join('');
  }
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

  const isTransfer = (action === 'Transfer' || action === 'Transfer stock to Tiktok Fulfillment' || action === 'Stock Transfer');
  const sectionDocRef = document.getElementById('sectionDocRef');
  const sectionApproval = document.getElementById('sectionApproval');

  if (isTransfer) {
    if (sectionDocRef) sectionDocRef.classList.add('hidden');
    if (sectionApproval) sectionApproval.classList.add('hidden');
    setDocumentToggle(false);
    stockCardState.hasDoc = false;
    stockCardState.refNumber = '';
    stockCardState.approvedBy = 'N/A';
    const select = document.getElementById('stockCardApprovedBy');
    if (select) select.value = 'N/A';
  } else {
    if (sectionDocRef) sectionDocRef.classList.remove('hidden');
    if (sectionApproval) sectionApproval.classList.remove('hidden');
    const select = document.getElementById('stockCardApprovedBy');
    if (select && select.value === 'N/A') select.value = '';
    stockCardState.approvedBy = (select?.value || '').trim();
  }

  updateDescriptionByAction(action);
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
  if (!desc || desc.readOnly) return;
  const current = desc.value.trim();
  if (!current) {
    desc.value = text;
  } else if (!current.includes(text)) {
    desc.value = `${current} - ${text}`;
  }
  stockCardState.description = desc.value;
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

// Client-side image compression utility (<200KB per photo instead of 10MB)
async function compressImage(file, maxDimension = 1200, quality = 0.8) {
  return new Promise((resolve) => {
    if (!file.type || !file.type.startsWith('image/') || file.type.includes('svg')) {
      const reader = new FileReader();
      reader.onload = (e) => resolve({ file, previewUrl: e.target.result });
      reader.readAsDataURL(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          if (!blob) {
            resolve({ file, previewUrl: e.target.result });
            return;
          }
          const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, ".jpg"), {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });
          const previewUrl = canvas.toDataURL('image/jpeg', 0.6);
          resolve({ file: compressedFile, previewUrl });
        }, 'image/jpeg', quality);
      };
      img.onerror = () => resolve({ file, previewUrl: e.target.result });
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// Multi-Photo Upload Logic (1 to 8 photos) with instant compression
async function handleStockCardPhotoSelect(input) {
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

  for (const file of filesToAdd) {
    try {
      const compressed = await compressImage(file, 1200, 0.8);
      stockCardState.photos.push(compressed);
    } catch (_) {
      stockCardState.photos.push({ file, previewUrl: URL.createObjectURL(file) });
    }
  }

  renderStockCardPhotoGallery();
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

  const isTransfer = (stockCardState.action === 'Transfer' || stockCardState.action === 'Transfer stock to Tiktok Fulfillment' || stockCardState.action === 'Stock Transfer');

  if (isTransfer) {
    stockCardState.hasDoc = false;
    stockCardState.refNumber = '';
    stockCardState.approvedBy = 'N/A';
  } else {
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
    if (!approvedByVal || approvedByVal === 'N/A') {
      alert("Please select who gave approval from the Administrator dropdown.");
      document.getElementById('stockCardApprovedBy')?.focus();
      return;
    }
    stockCardState.approvedBy = approvedByVal;
  }

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

  // Populate Summary Header
  const trxEl = document.getElementById('scSummaryTrxId');
  if (trxEl) trxEl.textContent = `ID: ${stockCardState.trxId}`;
  
  // Clean Action Tag: Stock Out, Stock In, Stock Transfer
  const actionText = document.getElementById('scSummaryActionText');
  if (actionText) {
    actionText.className = 'action-tag';
    if (stockCardState.action === 'Stock In') {
      actionText.textContent = 'Stock In';
      actionText.classList.add('stock-in');
    } else if (stockCardState.action === 'Transfer stock to Tiktok Fulfillment' || stockCardState.action === 'Transfer' || stockCardState.action === 'Stock Transfer') {
      actionText.textContent = 'Stock Transfer';
      actionText.classList.add('transfer');
    } else {
      actionText.textContent = 'Stock Out';
      actionText.classList.add('stock-out');
    }
  }

  // Populate Items List (Clean & Minimal)
  const itemsList = document.getElementById('scSummaryItemsList');
  if (itemsList) {
    itemsList.innerHTML = '';
    let totalUnits = 0;
    stockCardState.items.forEach(item => {
      totalUnits += item.qty;
      const p = products.find(prod => prod.Code === item.sku) || { Code: item.sku, Description: item.name || '', Brand: '' };

      const row = document.createElement('div');
      row.className = 'summary-clean-item-row';
      row.innerHTML = `
        <div class="summary-clean-item-info">
          <span class="summary-clean-sku">${item.sku}</span>
          <span class="summary-clean-desc">${item.name || p.Description || ''}</span>
        </div>
        <span class="summary-clean-qty">${item.qty} units</span>
      `;
      itemsList.appendChild(row);
    });
    
    const totalQtyEl = document.getElementById('scSummaryTotalQty');
    if (totalQtyEl) totalQtyEl.textContent = `${totalUnits} units`;
  }

  // Details
  const isTransferAction = (stockCardState.action === 'Transfer' || stockCardState.action === 'Transfer stock to Tiktok Fulfillment' || stockCardState.action === 'Stock Transfer');

  const docRefEl = document.getElementById('scSummaryDocRef');
  if (docRefEl) docRefEl.textContent = stockCardState.hasDoc ? stockCardState.refNumber : (isTransferAction ? 'N/A' : 'None');

  const descSummaryEl = document.getElementById('scSummaryDescription');
  if (descSummaryEl) descSummaryEl.textContent = stockCardState.description || '—';

  const approvedByEl = document.getElementById('scSummaryApprovedBy');
  if (approvedByEl) approvedByEl.textContent = isTransferAction ? 'N/A' : (stockCardState.approvedBy || '—');

  // Multi-Photo Summary Review
  const photoBlock = document.getElementById('scSummaryPhotoBlock');
  const photoGrid = document.getElementById('scSummaryPhotoGrid');
  const photoCountEl = document.getElementById('scSummaryPhotoCount');

  if (photoCount > 0) {
    if (photoBlock) photoBlock.classList.remove('hidden');
    if (photoCountEl) photoCountEl.textContent = `${photoCount}/8 attached`;
    if (photoGrid) {
      photoGrid.innerHTML = '';
      stockCardState.photos.forEach((p, idx) => {
        const img = document.createElement('img');
        img.src = p.previewUrl;
        img.alt = `Proof ${idx + 1}`;
        img.className = 'summary-photo-thumb';
        photoGrid.appendChild(img);
      });
    }
  } else {
    if (photoBlock) photoBlock.classList.add('hidden');
  }

  updateSlideTextByAction();
  resetSlideToSubmit();
  showPage('pageStockCardSummary');
}

function updateSlideTextByAction() {
  const textEl = document.getElementById('slideSubmitText');
  if (!textEl) return;
  let actionLabel = 'Stock Out';
  if (stockCardState.action === 'Stock In') {
    actionLabel = 'Stock In';
  } else if (stockCardState.action === 'Transfer stock to Tiktok Fulfillment' || stockCardState.action === 'Transfer' || stockCardState.action === 'Stock Transfer') {
    actionLabel = 'Stock Transfer';
  }
  textEl.textContent = `Submit ${actionLabel} >>`;
}

let isSlideDragging = false;
let slideStartX = 0;
let slideMaxDrag = 0;

function resetSlideToSubmit() {
  isSlideDragging = false;
  const track = document.getElementById('slideSubmitTrack');
  const handle = document.getElementById('slideSubmitHandle');
  const fill = document.getElementById('slideSubmitFill');
  const text = document.getElementById('slideSubmitText');
  if (!track || !handle) return;

  track.classList.remove('submitting');
  handle.style.transform = 'translateX(0px)';
  handle.style.transition = 'transform 0.25s ease';
  handle.innerHTML = '<i class="fa-solid fa-angles-right"></i>';
  if (fill) {
    fill.style.width = '0px';
    fill.style.transition = 'width 0.25s ease';
  }
  if (text) {
    text.style.opacity = '1';
    text.style.color = '#0B57D0';
  }
  updateSlideTextByAction();
}

function initSlideToSubmit() {
  const track = document.getElementById('slideSubmitTrack');
  const handle = document.getElementById('slideSubmitHandle');
  const fill = document.getElementById('slideSubmitFill');
  const text = document.getElementById('slideSubmitText');
  if (!track || !handle) return;

  function onDragStart(clientX) {
    if (track.classList.contains('submitting')) return;
    isSlideDragging = true;
    slideStartX = clientX;
    slideMaxDrag = Math.max(10, track.clientWidth - handle.clientWidth - 8);
    handle.style.transition = 'none';
    if (fill) fill.style.transition = 'none';
  }

  function onDragMove(clientX) {
    if (!isSlideDragging) return;
    const delta = clientX - slideStartX;
    const clamped = Math.max(0, Math.min(delta, slideMaxDrag));
    handle.style.transform = `translateX(${clamped}px)`;
    if (fill) fill.style.width = `${clamped + 24}px`;
    if (text && slideMaxDrag > 0) {
      text.style.opacity = String(Math.max(0.1, 1 - (clamped / slideMaxDrag) * 0.9));
    }
  }

  function onDragEnd(clientX) {
    if (!isSlideDragging) return;
    isSlideDragging = false;
    const delta = clientX - slideStartX;
    const progress = slideMaxDrag > 0 ? (delta / slideMaxDrag) : 0;

    if (progress >= 0.7) {
      // Confirmed slide!
      handle.style.transform = `translateX(${slideMaxDrag}px)`;
      if (fill) fill.style.width = '100%';
      track.classList.add('submitting');
      handle.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-sm"></i>';
      if (text) {
        text.textContent = 'Submitting...';
        text.style.opacity = '1';
        text.style.color = '#FFFFFF';
      }
      executeStockCardSubmission();
    } else {
      resetSlideToSubmit();
    }
  }

  // Touch handlers
  handle.addEventListener('touchstart', (e) => {
    onDragStart(e.touches[0].clientX);
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (isSlideDragging && e.touches && e.touches[0]) {
      onDragMove(e.touches[0].clientX);
    }
  }, { passive: true });

  window.addEventListener('touchend', (e) => {
    if (isSlideDragging && e.changedTouches && e.changedTouches[0]) {
      onDragEnd(e.changedTouches[0].clientX);
    }
  }, { passive: true });

  // Mouse handlers
  handle.addEventListener('mousedown', (e) => {
    onDragStart(e.clientX);
  });

  window.addEventListener('mousemove', (e) => {
    if (isSlideDragging) {
      onDragMove(e.clientX);
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (isSlideDragging) {
      onDragEnd(e.clientX);
    }
  });
}

let isSlideAuditDragging = false;
let slideAuditStartX = 0;
let slideAuditMaxDrag = 0;

function resetSlideToAuditSubmit() {
  isSlideAuditDragging = false;
  const track = document.getElementById('slideAuditTrack');
  const handle = document.getElementById('slideAuditHandle');
  const fill = document.getElementById('slideAuditFill');
  const text = document.getElementById('slideAuditText');
  if (!track || !handle) return;

  track.classList.remove('submitting');
  handle.style.transform = 'translateX(0px)';
  handle.style.transition = 'transform 0.25s ease';
  handle.innerHTML = '<i class="fa-solid fa-angles-right"></i>';
  if (fill) {
    fill.style.width = '0px';
    fill.style.transition = 'width 0.25s ease';
  }
  if (text) {
    text.textContent = 'Submit Stock Take >>';
    text.style.opacity = '1';
    text.style.color = '#0B57D0';
  }
}

function initSlideToAuditSubmit() {
  const track = document.getElementById('slideAuditTrack');
  const handle = document.getElementById('slideAuditHandle');
  const fill = document.getElementById('slideAuditFill');
  const text = document.getElementById('slideAuditText');
  if (!track || !handle) return;

  function onDragStart(clientX) {
    if (track.classList.contains('submitting')) return;
    isSlideAuditDragging = true;
    slideAuditStartX = clientX;
    slideAuditMaxDrag = Math.max(10, track.clientWidth - handle.clientWidth - 8);
    handle.style.transition = 'none';
    if (fill) fill.style.transition = 'none';
  }

  function onDragMove(clientX) {
    if (!isSlideAuditDragging) return;
    const delta = clientX - slideAuditStartX;
    const clamped = Math.max(0, Math.min(delta, slideAuditMaxDrag));
    handle.style.transform = `translateX(${clamped}px)`;
    if (fill) fill.style.width = `${clamped + 24}px`;
    if (text && slideAuditMaxDrag > 0) {
      text.style.opacity = String(Math.max(0.1, 1 - (clamped / slideAuditMaxDrag) * 0.9));
    }
  }

  function onDragEnd(clientX) {
    if (!isSlideAuditDragging) return;
    isSlideAuditDragging = false;
    const delta = clientX - slideAuditStartX;
    const progress = slideAuditMaxDrag > 0 ? (delta / slideAuditMaxDrag) : 0;

    if (progress >= 0.7) {
      handle.style.transform = `translateX(${slideAuditMaxDrag}px)`;
      if (fill) fill.style.width = '100%';
      track.classList.add('submitting');
      handle.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-sm"></i>';
      if (text) {
        text.textContent = 'Submitting...';
        text.style.opacity = '1';
        text.style.color = '#FFFFFF';
      }
      submitData();
    } else {
      resetSlideToAuditSubmit();
    }
  }

  // Touch
  handle.addEventListener('touchstart', (e) => onDragStart(e.touches[0].clientX), { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (isSlideAuditDragging && e.touches && e.touches[0]) onDragMove(e.touches[0].clientX);
  }, { passive: true });
  window.addEventListener('touchend', (e) => {
    if (isSlideAuditDragging && e.changedTouches && e.changedTouches[0]) onDragEnd(e.changedTouches[0].clientX);
  }, { passive: true });

  // Mouse
  handle.addEventListener('mousedown', (e) => onDragStart(e.clientX));
  window.addEventListener('mousemove', (e) => {
    if (isSlideAuditDragging) onDragMove(e.clientX);
  });
  window.addEventListener('mouseup', (e) => {
    if (isSlideAuditDragging) onDragEnd(e.clientX);
  });
}

async function executeStockCardSubmission() {
  updateSyncStatus('loading');

  try {
    let uploadedPhotoUrls = [];
    // 1. Upload photos concurrently (1 to 8 photos)
    if (stockCardState.photos && stockCardState.photos.length > 0) {
      const uploadPromises = stockCardState.photos.map(async (p, idx) => {
        try {
          const fileName = `stock-flow-${stockCardState.trxId}-${idx + 1}-${Date.now()}.jpg`;
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
    const loggedInStaff = getLoggedInEmployee() || 'Staff';
    const payload = {
      id: stockCardState.trxId,
      action_type: stockCardState.action,
      items: stockCardState.items,
      total_qty: stockCardState.items.reduce((acc, i) => acc + (i.qty || 0), 0),
      has_document: stockCardState.hasDoc,
      ref_number: stockCardState.refNumber,
      description: stockCardState.description,
      approved_by: stockCardState.approvedBy,
      photo_url: uploadedPhotoUrls.join(','),
      photo_urls: uploadedPhotoUrls,
      created_by: loggedInStaff,
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
    showPage('page1');
  } catch (err) {
    alert("Error saving transaction: " + err.message);
    resetSlideToSubmit();
  } finally {
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

  const formattedDateStr = formatDateFull(new Date());

  // Helper to sort items cleanly by BrandRank, Brand Name, Product Rank, and Code
  function sortAuditItems(itemsList) {
    return [...itemsList].sort((a, b) => {
      const prodA = products.find(p => p.Code === a.Code) || a;
      const prodB = products.find(p => p.Code === b.Code) || b;
      const brandRankA = (prodA.BrandRank !== undefined) ? parseInt(prodA.BrandRank) : 999;
      const brandRankB = (prodB.BrandRank !== undefined) ? parseInt(prodB.BrandRank) : 999;
      if (brandRankA !== brandRankB) return brandRankA - brandRankB;

      const brandNameA = (a.Brand || prodA.Brand || '').localeCompare(b.Brand || prodB.Brand || '');
      if (brandNameA !== 0) return brandNameA;

      const rankA = (prodA.Rank !== undefined) ? parseInt(prodA.Rank) : 999;
      const rankB = (prodB.Rank !== undefined) ? parseInt(prodB.Rank) : 999;
      if (rankA !== rankB) return rankA - rankB;

      return String(a.Code || '').localeCompare(String(b.Code || ''));
    });
  }

  // Helper to construct autoTable rows with brand group subheadings
  function buildTableRows(itemList) {
    let currentBrand = null;
    const rows = [];
    itemList.forEach(item => {
      const prod = products.find(p => p.Code === item.Code) || {};
      const itemBrand = item.Brand || prod.Brand || 'General';
      if (itemBrand !== currentBrand) {
        currentBrand = itemBrand;
        // Group Header row
        rows.push([
          {
            content: currentBrand.toUpperCase(),
            colSpan: 4,
            styles: {
              fillColor: [241, 245, 249],
              textColor: [15, 23, 42],
              fontStyle: 'bold',
              fontSize: 9,
              cellPadding: 2.5
            }
          }
        ]);
      }

      const packSize = prod.Pack || 0;
      let packDetails = "-";
      if (item.Qty > 0 && packSize > 0) {
        const carton = Math.floor(item.Qty / packSize);
        const loose = item.Qty % packSize;
        let parts = [];
        if (carton > 0) parts.push(`${carton} Carton`);
        if (loose > 0) parts.push(`${loose} Loose`);
        packDetails = parts.join(' ');
      } else if (item.Qty === 0 || item.Qty === "OOS") {
        packDetails = "Out of Stock";
      }

      const qtyText = (item.Qty === 0 || item.Qty === "OOS") ? "OOS" : String(item.Qty);

      rows.push([
        item.Code,
        item.Description || prod.Description || item.Code,
        qtyText,
        packDetails
      ]);
    });
    return rows;
  }

  // Separate Unskipped and Skipped items
  const unskippedItems = sortAuditItems(dataToExport.filter(i => !i.Skipped && !i.skipped));
  const skippedItems = sortAuditItems(dataToExport.filter(i => i.Skipped || i.skipped));

  // Top Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text("INVENTORY AUDIT REPORT", 14, 18);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 25);

  let currentY = 32;

  // 1. Group 1: Unskipped (Stock Count as [Date])
  if (unskippedItems.length > 0) {
    const unskipTitle = currentViewTitle && currentViewTitle.toLowerCase().includes('stock as') 
      ? currentViewTitle 
      : `Stock Count as ${formattedDateStr}`;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(unskipTitle, 14, currentY);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text("Stock verified and counted on this stock take date.", 14, currentY + 5);

    const unskippedRows = buildTableRows(unskippedItems);

    doc.autoTable({
      startY: currentY + 8,
      head: [['Code', 'Description', 'Qty', 'Packaging Details']],
      body: unskippedRows,
      theme: 'striped',
      headStyles: {
        fillColor: [0, 0, 0], // Pure Black Header
        textColor: [255, 255, 255], // Crisp White font
        fontStyle: 'bold',
        fontSize: 9
      },
      styles: { fontSize: 8.5, cellPadding: 2.5, textColor: [30, 41, 59] },
      columnStyles: {
        0: { cellWidth: 32, fontStyle: 'bold' },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 22, halign: 'center', fontStyle: 'bold' },
        3: { cellWidth: 40 }
      }
    });

    currentY = (doc.lastAutoTable ? doc.lastAutoTable.finalY : currentY + 40) + 12;
  }

  // 2. Group 2: Skipped (Stock Count not fulfilled by this date...)
  if (skippedItems.length > 0) {
    // Find the latest previous stock take date from logs
    let latestPriorDate = '';
    if (Array.isArray(logs) && logs.length > 0) {
      for (const log of logs) {
        if (log.timestamp) {
          latestPriorDate = formatDateFull(log.timestamp);
          break;
        }
      }
    }
    if (!latestPriorDate) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      latestPriorDate = formatDateFull(yesterday);
    }

    // Check if new page needed
    if (currentY > 230) {
      doc.addPage();
      currentY = 20;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(`Stock Count Not Fulfilled as of ${formattedDateStr}`, 14, currentY);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`The data is carried forward from previous stock take date: ${latestPriorDate}.`, 14, currentY + 5);

    const skippedRows = buildTableRows(skippedItems);

    doc.autoTable({
      startY: currentY + 8,
      head: [['Code', 'Description', 'Qty', 'Packaging Details']],
      body: skippedRows,
      theme: 'striped',
      headStyles: {
        fillColor: [0, 0, 0], // Pure Black Header
        textColor: [255, 255, 255], // Crisp White font
        fontStyle: 'bold',
        fontSize: 9
      },
      styles: { fontSize: 8.5, cellPadding: 2.5, textColor: [30, 41, 59] },
      columnStyles: {
        0: { cellWidth: 32, fontStyle: 'bold' },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 22, halign: 'center', fontStyle: 'bold' },
        3: { cellWidth: 40 }
      }
    });
  }

  doc.save(`${currentViewTitle.replace(/\s+/g, '_')}.pdf`);
}

// ==========================================
// MODALS UTILITIES
// ==========================================
function openImageModal(code) {
  const p = products.find(prod => prod.Code === code || prod.sku === code) || { Code: code, Description: code };

  const modal = document.getElementById('imageModal');
  const img = document.getElementById('imageModalImg');
  const codeEl = document.getElementById('imageModalCode');
  const descEl = document.getElementById('imageModalDesc');

  const finalImg = getProductImg(p);
  if (img) {
    img.src = finalImg;
    img.onerror = () => { img.onerror = null; img.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%231e293b'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='24' font-weight='900' fill='%23475569'%3E?%3C/text%3E%3C/svg%3E"; };
  }

  if (codeEl) codeEl.innerText = p.Code || p.sku || '';
  if (descEl) descEl.innerText = p.Description || p.name || '';

  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('active'); // active uses flex
  }
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
