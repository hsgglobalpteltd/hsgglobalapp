// Desktop Redirect Check
if (window.innerWidth > 600) {
  window.location.href = '../index.html';
}

const WORKER_URL = 'https://ib.hsgglobalpteltd.workers.dev';
const APP_VERSION = "26.0.37";

// Refresh and Auto-refresh State
let lastRefreshTime = Date.now();
let isFetchingData = false;
let deferredPrompt = null;

// App State
let allStores = [];
let allTasks = [];
let allAuditLogs = [];
let allShelfLogs = [];
let allRetailers = [];
let allBrands = [];
let allProducts = [];
let allRetailersSku = [];
let poCart = [];
let selectedPoStoreId = null;
let allUsers = [];
let retailerMap = {};
let merchUserMap = {};
let activeZone = "All";
let searchQuery = "";
let mapActive = false;
let mapLimit = 10;
let userLocation = null;
let leafletMap = null;
let markersGroup = null;
let userMarker = null;
let dailyTaskLimit = 10;
let lastRenderedMenu = "";

// New Audit State
let selectedStore = null;
let currentAuditBrands = [];

// Phonebook and Task States
let allContacts = [];
let currentRemarkMode = 'audit'; // 'audit' or 'special-task'
let activeSpecialTask = null;
let directorySearchQuery = "";
let directorySelectedRetailer = "All";
let phonebookSearchQuery = "";
let currentMerchUser = null;
let currentReportTab = 'today';
let pageHistoryDepth = 0;

// Visit Settings State
let visitSettings = {
  frequency: 0,
  focusRetailers: [],
  focusStatus: [],
  focusRanks: [],
  avoidRetailers: []
};

// DOM Elements
const menuBtn = document.getElementById('menu-btn');
const refreshBtn = document.getElementById('refresh-btn');
const refreshIcon = document.getElementById('refresh-icon');
const drawer = document.getElementById('drawer');
const drawerOverlay = document.getElementById('drawer-overlay');
const menuButtons = document.querySelectorAll('.drawer-item, .footer-item');
const activeMenuLabel = document.getElementById('active-menu-label');
const activeMenuDetail = document.getElementById('active-menu-detail');
const installOptions = document.getElementById('install-options');
const headerBadge = document.getElementById('header-badge');
const drawerBadge = document.getElementById('drawer-badge');
const exitBtn = document.getElementById('exit-btn');

// Stores & Map view elements
const storesView = document.getElementById('stores-view');
const generalView = document.getElementById('general-view');
const toggleMapBtn = document.getElementById('toggle-map-btn');
const mapLimitContainer = document.getElementById('map-limit-container');
const mapContainer = document.getElementById('map-container');
const storesList = document.getElementById('stores-list');
const limitButtons = document.querySelectorAll('.limit-btn');
const storeSearchInput = document.getElementById('store-search-input');

// Life Cycle & Initialization
window.addEventListener('DOMContentLoaded', () => {
  // Setup drawer toggles
  menuBtn.addEventListener('click', toggleDrawer);
  drawerOverlay.addEventListener('click', closeDrawer);
  
  // Setup exit button
  exitBtn.addEventListener('click', () => {
    window.location.href = '../index.html';
  });

  // Setup exit modal buttons
  const exitModal = document.getElementById('exit-modal');
  const exitModalCancel = document.getElementById('exit-modal-cancel-btn');
  const exitModalYes = document.getElementById('exit-modal-yes-btn');

  if (exitModalCancel) {
    exitModalCancel.addEventListener('click', () => {
      if (exitModal) exitModal.style.display = 'none';
      // Re-push home state to stay in app
      history.pushState({ page: 'home', depth: 0 }, '');
      pageHistoryDepth = 0;
    });
  }

  if (exitModal) {
    exitModal.addEventListener('click', (e) => {
      if (e.target === exitModal) {
        exitModal.style.display = 'none';
        // Re-push home state to stay in app
        history.pushState({ page: 'home', depth: 0 }, '');
        pageHistoryDepth = 0;
      }
    });
  }

  if (exitModalYes) {
    exitModalYes.addEventListener('click', () => {
      window.close();
    });
  }

  // Setup refresh button (silently fetches in background)
  refreshBtn.addEventListener('click', () => {
    fetchDataSilently();
  });

  // Setup menu selection
  menuButtons.forEach(item => {
    // Skip exit button since it handles redirect separately
    if (item.id === 'exit-btn') return;

    item.addEventListener('click', () => {
      const menu = item.getAttribute('data-menu');
      switchMenu(menu, item);
    });
  });

  // Setup Map Toggle
  if (toggleMapBtn) {
    toggleMapBtn.addEventListener('click', toggleMap);
  }

  // Setup Map Limit Selectors
  limitButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      limitButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      mapLimit = parseInt(btn.getAttribute('data-limit')) || 10;
      if (mapActive && userLocation) {
        renderStoresList();
      }
    });
  });

  // Setup Search Input
  if (storeSearchInput) {
    storeSearchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value || "";
      dailyTaskLimit = 10; // Reset pagination limit on search change
      renderStoresList();
    });
  }

  // Setup Scroll Listener for Lazy Loading
  const mobileContent = document.querySelector('.mobile-content');
  if (mobileContent) {
    mobileContent.addEventListener('scroll', () => {
      const activeItem = document.querySelector('.drawer-item.active, .footer-item.active');
      const currentMenu = activeItem ? activeItem.getAttribute('data-menu') : 'daily-task';
      if (currentMenu === 'daily-task') {
        // If we scroll near the bottom of the container
        if (mobileContent.scrollTop + mobileContent.clientHeight >= mobileContent.scrollHeight - 60) {
          const loadMoreBtn = document.querySelector('.load-more-card');
          if (loadMoreBtn) {
            dailyTaskLimit += 10;
            renderStoresList();
          }
        }
      }
    });
  }

  // Hide Exit and Install items if PWA is installed/standalone
  checkPWADisplayMode();

  // Setup Preview Back Button
  const previewBackBtn = document.getElementById('preview-back-btn');
  if (previewBackBtn) {
    previewBackBtn.addEventListener('click', () => {
      history.back();
    });
  }

  // Setup Preview Actions (New Audit)
  const newAuditBtn = document.getElementById('new-audit-btn');
  if (newAuditBtn) {
    newAuditBtn.addEventListener('click', openNewAudit);
  }

  const auditBackBtn = document.getElementById('audit-back-btn');
  if (auditBackBtn) {
    auditBackBtn.addEventListener('click', () => {
      history.back();
    });
  }

  const addProductBtn = document.getElementById('add-product-btn');
  if (addProductBtn) {
    addProductBtn.addEventListener('click', openBrandSelectDrawer);
  }

  const drawerCloseBtn = document.getElementById('drawer-close-btn');
  if (drawerCloseBtn) {
    drawerCloseBtn.addEventListener('click', closeBrandSelectDrawer);
  }

  const brandSelectOverlay = document.getElementById('brand-select-overlay');
  if (brandSelectOverlay) {
    brandSelectOverlay.addEventListener('click', closeBrandSelectDrawer);
  }

  const drawerStepBackBtn = document.getElementById('drawer-step-back-btn');
  if (drawerStepBackBtn) {
    drawerStepBackBtn.addEventListener('click', showDrawerStepBrand);
  }

  const insertProductsBtn = document.getElementById('insert-products-btn');
  if (insertProductsBtn) {
    insertProductsBtn.addEventListener('click', insertProductsFromDrawer);
  }

  const auditNextBtn = document.getElementById('audit-next-btn');
  if (auditNextBtn) {
    auditNextBtn.addEventListener('click', validateAndGoToRemark);
  }

  const remarkBackBtn = document.getElementById('remark-back-btn');
  if (remarkBackBtn) {
    remarkBackBtn.addEventListener('click', () => {
      history.back();
    });
  }

  const auditSubmitBtn = document.getElementById('audit-submit-btn');
  if (auditSubmitBtn) {
    auditSubmitBtn.addEventListener('click', () => {
      if (currentRemarkMode === 'special-task') {
        submitSpecialTask();
      } else {
        submitAudit();
      }
    });
  }

  const notCarryCheckbox = document.getElementById('not-carry-checkbox');
  if (notCarryCheckbox) {
    notCarryCheckbox.addEventListener('change', () => {
      toggleNotCarryCheckbox();
    });
  }

  const remarkInput = document.getElementById('audit-remark-input');
  if (remarkInput) {
    remarkInput.addEventListener('focus', () => {
      setTimeout(() => {
        remarkInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    });
  }

  // Setup 4-digit PIN input controls with auto-next and auto-submit
  const digitInputs = document.querySelectorAll('.pin-digit-input');
  const auditPinInput = document.getElementById('audit-pin-input');

  digitInputs.forEach((input, index) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && index > 0) {
        digitInputs[index - 1].value = ''; // Clear previous and focus it
        digitInputs[index - 1].focus();
        updateCombinedPin();
      }
    });

    input.addEventListener('input', (e) => {
      let val = input.value.replace(/[^0-9]/g, '');
      input.value = val;

      if (val && index < digitInputs.length - 1) {
        digitInputs[index + 1].focus();
      }

      updateCombinedPin();
    });

    input.addEventListener('focus', () => {
      input.select();
    });
  });

  function updateCombinedPin() {
    const pin = Array.from(digitInputs).map(i => i.value).join('');
    if (auditPinInput) {
      auditPinInput.value = pin;
    }

    // Auto-submit when all 4 digits are completed
    if (pin.length === 4 && /^\d{4}$/.test(pin)) {
      if (currentRemarkMode === 'special-task') {
        submitSpecialTask();
      } else {
        submitAudit();
      }
    }
  }

  // Directory & Phonebook Listeners
  const dirRetailerSelect = document.getElementById('directory-retailer-select');
  if (dirRetailerSelect) {
    dirRetailerSelect.addEventListener('change', (e) => {
      directorySelectedRetailer = e.target.value;
      renderStoresDirectory();
    });
  }

  const dirSearchInput = document.getElementById('directory-search-input');
  if (dirSearchInput) {
    dirSearchInput.addEventListener('input', (e) => {
      directorySearchQuery = e.target.value || "";
      renderStoresDirectory();
    });
  }

  const pbSearchInput = document.getElementById('phonebook-search-input');
  if (pbSearchInput) {
    pbSearchInput.addEventListener('input', (e) => {
      phonebookSearchQuery = e.target.value || "";
      renderPhonebook();
    });
  }

  const addContactBtn = document.getElementById('add-contact-btn');
  if (addContactBtn) {
    addContactBtn.addEventListener('click', () => {
      const form = document.getElementById('add-contact-form');
      if (form) form.reset();
      
      const searchInput = document.getElementById('contact-store-search');
      if (searchInput) {
        searchInput.value = '';
        searchInput._selectedStoreId = '';
      }
      
      const addContactPage = document.getElementById('add-contact-page');
      if (addContactPage) {
        addContactPage.classList.add('active');
        pushPageState('add-contact');
      }
    });
  }

  const addContactBackBtn = document.getElementById('add-contact-back-btn');
  if (addContactBackBtn) {
    addContactBackBtn.addEventListener('click', () => {
      history.back();
    });
  }

  const latestAuditBackBtn = document.getElementById('latest-audit-back-btn');
  if (latestAuditBackBtn) {
    latestAuditBackBtn.addEventListener('click', () => {
      history.back();
    });
  }

  const submitNewAuditBtn = document.getElementById('submit-new-audit-btn');
  if (submitNewAuditBtn) {
    submitNewAuditBtn.addEventListener('click', () => {
      openNewAudit();
    });
  }

  setupSearchableDropdown();

  const addContactForm = document.getElementById('add-contact-form');
  if (addContactForm) {
    addContactForm.addEventListener('submit', (e) => {
      e.preventDefault();
      submitNewContact();
    });
  }

  // My Report event bindings
  const reportPinInput = document.getElementById('my-report-pin-input');
  if (reportPinInput) {
    reportPinInput.addEventListener('input', () => {
      reportPinInput.classList.remove('error');
    });
    reportPinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        verifyMyReportPin();
      }
    });
  }
  const reportPinSubmitBtn = document.getElementById('my-report-pin-submit-btn');
  if (reportPinSubmitBtn) {
    reportPinSubmitBtn.addEventListener('click', verifyMyReportPin);
  }
  const clockOutBtn = document.getElementById('report-clockout-btn');
  if (clockOutBtn) {
    clockOutBtn.addEventListener('click', clockOutMerch);
  }

  const toggleTodayBtn = document.getElementById('report-toggle-today-btn');
  if (toggleTodayBtn) {
    toggleTodayBtn.addEventListener('click', () => {
      currentReportTab = 'today';
      renderReportDashboard();
    });
  }
  const toggleWeekBtn = document.getElementById('report-toggle-week-btn');
  if (toggleWeekBtn) {
    toggleWeekBtn.addEventListener('click', () => {
      currentReportTab = 'week';
      renderReportDashboard();
    });
  }

  // Load from cache first
  loadCachedData();

  // Initial Sync UI check
  updateSyncUI();

  // Bind resubmit button click
  const resubmitBtn = document.getElementById('resubmit-btn');
  if (resubmitBtn) {
    resubmitBtn.addEventListener('click', retryFailedSyncs);
  }

  // Set the initial active view based on the active drawer/footer item
  const activeItem = document.querySelector('.drawer-item.active, .footer-item.active');
  if (activeItem) {
    const menu = activeItem.getAttribute('data-menu');
    switchMenu(menu, activeItem);
  }

  // Initial silent background fetch
  fetchDataSilently();


  // Set app version in footer
  const versionSpan = document.getElementById('app-version');
  if (versionSpan) {
    versionSpan.textContent = `Trial Version : ${APP_VERSION}`;
  }

  // Setup PO Request event listeners
  const poStoreSearch = document.getElementById('po-store-search');
  const poSearchResults = document.getElementById('po-store-search-results');
  const poSelectedStoreInfo = document.getElementById('po-selected-store-info');
  
  if (poStoreSearch && poSearchResults) {
    poStoreSearch.addEventListener('input', (e) => {
      const val = e.target.value.trim().toLowerCase();
      poSearchResults.innerHTML = '';
      
      if (!val) {
        poSearchResults.style.display = 'none';
        return;
      }
      
      const queryWords = val.split(/\s+/).filter(w => w.length > 0);
      
      // Filter stores
      const matches = allStores.filter(store => {
        const storeName = (store["Display Name"] || store.name || "").toLowerCase();
        const storeIdVal = (store.ID || store.id || "").toString().toLowerCase();
        const address = (store.Address || store.address || "").toLowerCase();
        const retailerId = store["Retailers ID"] || store.retailer_id || "";
        const retailerName = (retailerMap[retailerId.toString()] || retailerId || "").toLowerCase();
        
        const storeText = `${storeIdVal} ${retailerName} ${storeName} ${address}`;
        return queryWords.every(word => storeText.includes(word));
      });
      
      // Limit to 6 matches
      const displayMatches = matches.slice(0, 6);
      
      if (displayMatches.length === 0) {
        poSearchResults.innerHTML = `
          <div style="padding: 12px; text-align: center; color: #94A3B8; font-size: 12px; font-weight: 500;">
            No matching stores found
          </div>
        `;
        poSearchResults.style.display = 'block';
        return;
      }
      
      displayMatches.forEach(store => {
        const storeId = store.ID || store.id || "";
        const storeName = store["Display Name"] || store.name || "";
        const address = store.Address || store.address || "";
        const retailerId = store["Retailers ID"] || store.retailer_id || "";
        const retailerName = retailerMap[retailerId.toString()] || retailerId || "";
        
        const item = document.createElement('div');
        item.style.padding = '10px 12px';
        item.style.borderBottom = '1px solid #F1F5F9';
        item.style.cursor = 'pointer';
        item.style.fontSize = '12.5px';
        item.style.fontWeight = '600';
        item.style.color = '#1E293B';
        item.innerHTML = `
          <div style="font-weight: 700; color: #0F172A;">${retailerName} - ${storeName}</div>
          <div style="font-size: 10px; color: #64748B; margin-top: 2px;">${address}</div>
        `;
        
        item.addEventListener('click', () => {
          selectedPoStoreId = storeId;
          poStoreSearch.value = '';
          poSearchResults.style.display = 'none';
          
          if (poSelectedStoreInfo) {
            poSelectedStoreInfo.textContent = `${retailerName} - ${storeName}`;
            poSelectedStoreInfo.style.display = 'block';
          }
          
          // Populate product dropdown
          const pSelect = document.getElementById('po-product-select');
          if (pSelect) {
            pSelect.innerHTML = '<option value="">Select a Product</option>';
            const filteredProducts = allRetailersSku.filter(p => {
              const pRetId = (p["Retailer ID"] || p.retailer_id || p.Retailer_ID || p["Retailers ID"] || "").toString().trim();
              return pRetId === retailerId.toString().trim();
            });
            filteredProducts.forEach(p => {
              const sku = p["SKU Number"] || p.SKU || p.sku || "";
              const name = p["SKU Name"] || p["Display Name"] || p.name || "";
              if (sku) {
                const opt = document.createElement('option');
                opt.value = sku;
                opt.textContent = name ? `${sku} - ${name}` : sku;
                pSelect.appendChild(opt);
              }
            });
          }
        });
        poSearchResults.appendChild(item);
      });
      
      poSearchResults.style.display = 'block';
    });
    
    // Hide dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (e.target !== poStoreSearch && !poSearchResults.contains(e.target)) {
        poSearchResults.style.display = 'none';
      }
    });
  }

  const poProductSelect = document.getElementById('po-product-select');
  if (poProductSelect) {
    poProductSelect.addEventListener('change', (e) => {
      const sku = e.target.value;
      const product = allRetailersSku.find(p => (p["SKU Number"] || p.SKU || p.sku || "").toString() === sku);
      const uom = product ? (product.UOM || product.uom || "EA") : "EA";
      const pack = product ? (product.PACK || product.pack || product.Pack || "1") : "";
      const uomPackDisplay = document.getElementById('po-uom-pack-display');
      if (uomPackDisplay) {
        uomPackDisplay.value = uom || pack ? `${uom} ${pack}`.trim() : "";
      }

      // Rebuild Quantity options based on UOM
      const qtySelect = document.getElementById('po-qty-select');
      if (qtySelect) {
        qtySelect.innerHTML = '';
        if (uom === 'CT') {
          for (let i = 1; i <= 5; i++) {
            const opt = document.createElement('option');
            opt.value = i.toString();
            opt.textContent = i.toString();
            qtySelect.appendChild(opt);
          }
          qtySelect.value = '1';
        } else {
          for (let i = 10; i <= 30; i++) {
            const opt = document.createElement('option');
            opt.value = i.toString();
            opt.textContent = i.toString();
            qtySelect.appendChild(opt);
          }
          qtySelect.value = '10';
        }
      }
    });
  }

  const poAddProductBtn = document.getElementById('po-add-product-btn');
  if (poAddProductBtn) {
    poAddProductBtn.addEventListener('click', () => {
      const pSelect = document.getElementById('po-product-select');
      const qtySelect = document.getElementById('po-qty-select');
      
      if (!pSelect || !qtySelect) return;
      
      const sku = pSelect.value;
      const name = pSelect.options[pSelect.selectedIndex]?.text || '';
      const qty = parseInt(qtySelect.value) || 10;
      
      if (!sku) {
        showToast("Please select a product.", "error");
        return;
      }
      
      const product = allRetailersSku.find(p => (p["SKU Number"] || p.SKU || p.sku || "").toString() === sku);
      const uom = product ? (product.UOM || product.uom || "EA") : "EA";
      const pack = product ? (product.PACK || product.pack || product.Pack || "1") : "1";
      
      // Clean SKU name prefix if present
      let cleanName = name;
      if (name.startsWith(sku)) {
        cleanName = name.substring(sku.length).replace(/^[\s-]+/, '');
      }
      
      const existing = poCart.find(item => item.sku === sku);
      if (existing) {
        existing.qty += qty;
      } else {
        poCart.push({
          id: Date.now(),
          sku: sku,
          name: cleanName,
          uom: uom,
          pack: pack,
          qty: qty
        });
      }
      
      // Reset product select, and rebuild default qty selector (EA range: 10 to 30)
      pSelect.value = '';
      const uomPackDisplay = document.getElementById('po-uom-pack-display');
      if (uomPackDisplay) uomPackDisplay.value = '';
      
      qtySelect.innerHTML = '';
      for (let i = 10; i <= 30; i++) {
        const opt = document.createElement('option');
        opt.value = i.toString();
        opt.textContent = i.toString();
        qtySelect.appendChild(opt);
      }
      qtySelect.value = '10';
      
      renderPoCart();
      showToast("Product added to order.", "success");
    });
  }

  const poGenerateBtn = document.getElementById('po-generate-btn');
  if (poGenerateBtn) {
    poGenerateBtn.addEventListener('click', showPoAuthPage);
  }

  // Bind Custom PO Request PIN Page actions
  const poAuthBackBtn = document.getElementById('po-auth-back-btn');
  if (poAuthBackBtn) {
    poAuthBackBtn.addEventListener('click', () => {
      history.back();
    });
  }

  const poAuthSubmitBtn = document.getElementById('po-auth-submit-btn');
  if (poAuthSubmitBtn) {
    poAuthSubmitBtn.addEventListener('click', verifyPoAuthPin);
  }

  // Setup 4-digit PIN input controls with auto-next and auto-submit for PO Auth
  const poDigitInputs = document.querySelectorAll('.po-pin-digit-input');
  const poAuthPinInput = document.getElementById('po-auth-pin-input');

  poDigitInputs.forEach((input, index) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && index > 0) {
        poDigitInputs[index - 1].value = ''; // Clear previous and focus it
        poDigitInputs[index - 1].focus();
        updatePoCombinedPin();
      }
    });

    input.addEventListener('input', (e) => {
      let val = input.value.replace(/[^0-9]/g, '');
      input.value = val;

      if (val && index < poDigitInputs.length - 1) {
        poDigitInputs[index + 1].focus();
      }

      updatePoCombinedPin();
    });

    input.addEventListener('focus', () => {
      input.select();
    });
  });

  function updatePoCombinedPin() {
    const pin = Array.from(poDigitInputs).map(i => i.value).join('');
    if (poAuthPinInput) {
      poAuthPinInput.value = pin;
    }

    // Auto-submit when all 4 digits are completed
    if (pin.length === 4 && /^\d{4}$/.test(pin)) {
      verifyPoAuthPin();
    }
  }

  // Reset/Initialize home state to prevent accidental exit on physical back button
  history.replaceState({ page: 'entry', depth: -1 }, '');
  history.pushState({ page: 'home', depth: 0 }, '');
  pageHistoryDepth = 0;
});

function toggleDrawer() {
  drawer.classList.toggle('active');
  drawerOverlay.classList.toggle('active');
}

function closeDrawer() {
  drawer.classList.remove('active');
  drawerOverlay.classList.remove('active');
}

function switchMenu(menu, menuItem) {
  // Update active item styles in drawer
  menuButtons.forEach(item => item.classList.remove('active'));
  menuItem.classList.add('active');

  // Close drawer
  closeDrawer();

  // Map menu key to user-friendly label
  let menuLabel = "Daily Task";
  if (menu === 'special-task') menuLabel = "Special Task";
  else if (menu === 'latest-visit') menuLabel = "Latest Visit";
  else if (menu === 'po-request') menuLabel = "PO Request";
  else if (menu === 'stores-directory') menuLabel = "Stores Directory";
  else if (menu === 'phonebook') menuLabel = "Phonebook";
  else if (menu === 'my-report') menuLabel = "My Report";
  else if (menu === 'install-app') menuLabel = "Install App";

  // Update label text
  activeMenuLabel.textContent = menuLabel;

  // Reset search when switching menus
  if (storeSearchInput) {
    storeSearchInput.value = "";
  }
  searchQuery = "";
  dailyTaskLimit = 10;

  // Toggle maps state reset if switching away from Daily Task
  if (menu !== 'daily-task' && mapActive) {
    mapActive = false;
    if (toggleMapBtn) {
      toggleMapBtn.classList.remove('active');
      toggleMapBtn.classList.remove('loading-loc');
    }
    if (mapLimitContainer) mapLimitContainer.classList.add('hidden');
    if (mapContainer) mapContainer.classList.add('hidden');
    const loader = document.getElementById('map-loading-overlay');
    if (loader) loader.classList.add('hidden');
  }

  // Toggle parent scrolling for full-height internal scrolling tables
  const mobileContent = document.querySelector('.mobile-content');
  if (menu === 'stores-directory' || menu === 'phonebook' || menu === 'my-report' || menu === 'po-request') {
    if (mobileContent) mobileContent.style.overflowY = 'hidden';
  } else {
    if (mobileContent) mobileContent.style.overflowY = 'auto';
  }

  // Hide all main views first
  storesView.classList.add('hidden');
  generalView.classList.add('hidden');
  document.getElementById('po-request-view').classList.add('hidden');
  document.getElementById('stores-directory-view').classList.add('hidden');
  document.getElementById('phonebook-view').classList.add('hidden');
  document.getElementById('my-report-view').classList.add('hidden');

  const subheader = document.getElementById('daily-task-subheader');
  if (menu === 'daily-task' || menu === 'latest-visit' || menu === 'special-task') {
    storesView.classList.remove('hidden');
    
    if (menu === 'daily-task') {
      if (subheader) subheader.classList.remove('hidden');
      if (toggleMapBtn) toggleMapBtn.classList.remove('hidden');
    } else {
      if (subheader) subheader.classList.add('hidden');
      if (toggleMapBtn) toggleMapBtn.classList.add('hidden');
    }
    renderStoresList();
  } else if (menu === 'po-request') {
    if (subheader) subheader.classList.add('hidden');
    document.getElementById('po-request-view').classList.remove('hidden');
    initPoRequest();
  } else if (menu === 'stores-directory') {
    if (subheader) subheader.classList.add('hidden');
    document.getElementById('stores-directory-view').classList.remove('hidden');
    renderStoresDirectory();
  } else if (menu === 'phonebook') {
    if (subheader) subheader.classList.add('hidden');
    document.getElementById('phonebook-view').classList.remove('hidden');
    renderPhonebook();
  } else if (menu === 'my-report') {
    if (subheader) subheader.classList.add('hidden');
    document.getElementById('my-report-view').classList.remove('hidden');
    renderMyReport();
  } else {
    if (subheader) subheader.classList.add('hidden');
    generalView.classList.remove('hidden');
  }

  // Toggle blank body or detailed panels (Install App options)
  if (menu === 'install-app') {
    activeMenuDetail.classList.remove('hidden');
    installOptions.classList.remove('hidden');
    renderInstallOptions();
  } else {
    activeMenuDetail.classList.add('hidden');
    installOptions.classList.add('hidden');
  }
}

// Sync Queue / Failed submissions State
let failedSyncs = [];

function base64ToBlob(base64Str) {
  try {
    const parts = base64Str.split(';base64,');
    const contentType = parts[0].split(':')[1];
    const raw = window.atob(parts[1]);
    const rawLength = raw.length;
    const uInt8Array = new Uint8Array(rawLength);
    for (let i = 0; i < rawLength; ++i) {
      uInt8Array[i] = raw.charCodeAt(i);
    }
    return new Blob([uInt8Array], { type: contentType });
  } catch (e) {
    console.error("Failed to parse base64 to Blob:", e);
    return null;
  }
}

function updateSyncUI() {
  const resubmitBtn = document.getElementById('resubmit-btn');
  const refreshBtnEl = document.getElementById('refresh-btn');
  const failedSyncList = document.getElementById('failed-sync-list');

  if (!resubmitBtn || !refreshBtnEl || !failedSyncList) return;

  if (failedSyncs.length > 0) {
    refreshBtnEl.classList.add('hidden');
    resubmitBtn.classList.remove('hidden');

    failedSyncList.innerHTML = '';
    failedSyncs.forEach(item => {
      const el = document.createElement('div');
      el.className = 'failed-sync-item';
      
      const storeName = item.storeName || 'Unsaved Action';
      const reason = item.error || 'Failed sync';
      
      el.innerHTML = `
        <span class="failed-sync-store">${storeName}</span>
        <span class="failed-sync-reason">${reason}</span>
      `;
      failedSyncList.appendChild(el);
    });
    failedSyncList.classList.remove('hidden');
  } else {
    refreshBtnEl.classList.remove('hidden');
    resubmitBtn.classList.add('hidden');
    failedSyncList.innerHTML = '';
    failedSyncList.classList.add('hidden');
  }
}

function mergeFailedSyncs() {
  if (failedSyncs.length === 0) return;

  failedSyncs.forEach(item => {
    if (item.type === 'audit') {
      const p = item.payload;
      
      // Update Store Status
      const store = allStores.find(s => (s.ID || s.id || "").toString().trim() === p.storeId.trim());
      if (store) {
        store.Status = p.status;
      }

      // Add to Audit Logs
      const existsInLogs = allAuditLogs.some(log => (log.Timestamp || log.timestamp) === item.timestamp);
      if (!existsInLogs) {
        allAuditLogs.push({
          "Timestamp": item.timestamp,
          "Merch ID": p.merchId,
          "Retailer Stores ID": p.storeId,
          "Remark": p.remark,
          "Audit JSON": JSON.stringify(p.auditedSkus)
        });
      }

      // Add to Shelf Logs
      if (p.status !== 'Not Carry' && p.shelfLogs) {
        p.shelfLogs.forEach(brand => {
          const existsInShelf = allShelfLogs.some(sl => sl.Timestamp === item.timestamp && sl["Brands ID"] === brand.id);
          if (!existsInShelf) {
            allShelfLogs.push({
              "Timestamp": item.timestamp,
              "Merch ID": p.merchId,
              "Retailer Stores ID": p.storeId,
              "Brands ID": brand.id,
              "Image Link": brand.imgUrl || brand.base64,
              "Remark": brand.remark
            });
          }
        });
      }

      // Update Task status
      if (p.taskId) {
        const task = allTasks.find(t => {
          const taskStoreId = (t['Stores ID'] || t['stores id'] || t['StoresID'] || "").toString().trim();
          const taskAction = (t['Task Action'] || t['task action'] || t['TaskAction'] || "").toString().trim().toLowerCase();
          return taskStoreId === p.storeId.trim() && taskAction === 'visit';
        });
        if (task) {
          task['Task Log'] = JSON.stringify(p.taskLogs);
          task['Task Action'] = "Call";
        }
      }

    } else if (item.type === 'special-task') {
      const p = item.payload;
      const task = allTasks.find(t => (t['Created Date'] || t.CreatedDate) === p.taskCreatedDate);
      if (task) {
        task['Task Log'] = JSON.stringify(p.taskLogs);
        task['Task Action'] = "Call";
      }

    } else if (item.type === 'contact') {
      const p = item.payload;
      const existsInContacts = allContacts.some(c => c.Phone === p.Phone);
      if (!existsInContacts) {
        allContacts.push(p);
      }
    }
  });

  // Re-save merged datasets to localStorage so UI components read them properly
  localStorage.setItem('merch_stores', JSON.stringify(allStores));
  localStorage.setItem('merch_tasks', JSON.stringify(allTasks));
  localStorage.setItem('merch_audit_logs', JSON.stringify(allAuditLogs));
  localStorage.setItem('merch_shelf_logs', JSON.stringify(allShelfLogs));
  localStorage.setItem('merch_contacts', JSON.stringify(allContacts));
}

async function retryFailedSyncs() {
  const resubmitBtn = document.getElementById('resubmit-btn');
  if (!resubmitBtn || failedSyncs.length === 0) return;

  resubmitBtn.disabled = true;
  resubmitBtn.textContent = 'Syncing...';

  const itemsToSync = [...failedSyncs];
  let hasFailed = false;

  for (const item of itemsToSync) {
    try {
      if (item.type === 'audit') {
        const payload = item.payload;
        
        // 1. Upload images if they are base64
        const shelfUpdates = [];
        if (payload.shelfLogs && Array.isArray(payload.shelfLogs)) {
          for (const brand of payload.shelfLogs) {
            let finalUrl = brand.imgUrl || '';
            if (brand.base64 && brand.base64.startsWith('data:')) {
              const blob = base64ToBlob(brand.base64);
              if (blob) {
                const fileName = `shelf_${payload.storeId}_${brand.id}_${Date.now()}.jpg`;
                let uploadUrl = `${WORKER_URL}/api/upload?filename=${encodeURIComponent(fileName)}`;
                if (brand.oldImg) {
                  uploadUrl += `&deleteUrl=${encodeURIComponent(brand.oldImg)}`;
                }

                const uploadRes = await fetch(uploadUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': blob.type || 'image/jpeg' },
                  body: blob
                });

                if (uploadRes.ok) {
                  const uploadData = await uploadRes.json();
                  if (uploadData.success) {
                    finalUrl = uploadData.url;
                    brand.imgUrl = finalUrl;
                    
                    const cachedShelfLog = allShelfLogs.find(sl => sl.Timestamp === item.timestamp && sl["Brands ID"] === brand.id);
                    if (cachedShelfLog) {
                      cachedShelfLog["Image Link"] = finalUrl;
                    }
                  } else {
                    throw new Error("Image upload failed");
                  }
                } else {
                  throw new Error("Image upload HTTP error");
                }
              }
            }
            shelfUpdates.push({
              id: brand.id,
              imgUrl: finalUrl,
              remark: brand.remark
            });
          }
        }

        // 2. Perform writes
        await writeWithRetry({
          sheet: "Store_Retailer_DB",
          action: "update",
          data: {
            "ID": payload.storeId,
            "Status": payload.status
          }
        });

        await writeWithRetry({
          sheet: "Merch_Visit_Product_Audit_Logs",
          action: "upsert",
          data: {
            "ID": payload.auditId,
            "Timestamp": item.timestamp,
            "Merch ID": payload.merchId,
            "Retailer Stores ID": payload.storeId,
            "Remark": payload.remark,
            "Audit JSON": JSON.stringify(payload.auditedSkus)
          }
        });

        if (payload.status !== 'Not Carry') {
          for (const brand of shelfUpdates) {
            const shelfAuditId = `${payload.auditDateStr}_${payload.merchId}_${payload.storeId}_${brand.id}`;
            await writeWithRetry({
              sheet: "Merch_Visit_Shelf_Audit_Logs",
              action: "upsert",
              data: {
                "ID": shelfAuditId,
                "Timestamp": item.timestamp,
                "Merch ID": payload.merchId,
                "Retailer Stores ID": payload.storeId,
                "Brands ID": brand.id,
                "Image Link": brand.imgUrl,
                "Remark": brand.remark
              }
            });
          }
        }

        if (payload.taskId) {
          await writeWithRetry({
            sheet: "Stores_Task_Assigned",
            action: "update",
            data: {
              "Created Date": payload.taskCreatedDate,
              "Task Action": "Call",
              "Task Log": JSON.stringify(payload.taskLogs)
            }
          });
        }

      } else if (item.type === 'special-task') {
        const payload = item.payload;
        await writeWithRetry({
          sheet: "Stores_Task_Assigned",
          action: "update",
          data: {
            "Created Date": payload.taskCreatedDate,
            "Task Action": "Call",
            "Task Log": JSON.stringify(payload.taskLogs)
          }
        });

      } else if (item.type === 'contact') {
        const payload = item.payload;
        await writeWithRetry({
          sheet: "Contacts_Book",
          action: "insert",
          data: payload
        });
      } else if (item.type === 'po-request') {
        const payload = item.payload;
        await writeWithRetry({
          sheet: "Merch_PO_Request",
          action: "insert",
          data: {
            "ID": payload.poRequestId,
            "Timestamp": item.timestamp,
            "Store ID": payload.storeId,
            "Order": payload.orderString,
            "Merch ID": payload.merchId
          }
        });
      }

      failedSyncs = failedSyncs.filter(q => q.id !== item.id);
      localStorage.setItem('merch_failed_syncs', JSON.stringify(failedSyncs));
      localStorage.setItem('merch_shelf_logs', JSON.stringify(allShelfLogs));
    } catch (err) {
      console.error("Retry failed for item:", item, err);
      item.error = err.message || "Failed retry";
      localStorage.setItem('merch_failed_syncs', JSON.stringify(failedSyncs));
      hasFailed = true;
    }
  }

  resubmitBtn.disabled = false;
  resubmitBtn.textContent = 'Re-Submit';
  updateSyncUI();

  if (hasFailed) {
    showToast("Some submissions failed to sync. Please try again.", "error");
  } else {
    showToast("All submissions synced successfully!", "success");
    fetchDataSilently();
  }
}

function loadCachedData() {
  const cachedStores = localStorage.getItem('merch_stores');
  const cachedTasks = localStorage.getItem('merch_tasks');
  const cachedRetailers = localStorage.getItem('merch_retailers');

  if (cachedRetailers) {
    try {
      const retailers = JSON.parse(cachedRetailers);
      if (Array.isArray(retailers)) {
        processRetailersData(retailers);
      }
    } catch (e) {
      console.error('Failed to parse cached retailers:', e);
    }
  }

  const cachedUsers = localStorage.getItem('merch_users');
  if (cachedUsers) {
    try {
      const users = JSON.parse(cachedUsers);
      if (Array.isArray(users)) {
        processUsersData(users);
      }
    } catch (e) {
      console.error('Failed to parse cached users:', e);
    }
  }

  const cachedBrands = localStorage.getItem('merch_brands');
  if (cachedBrands) {
    try {
      const brands = JSON.parse(cachedBrands);
      if (Array.isArray(brands)) {
        allBrands = brands;
      }
    } catch (e) {
      console.error('Failed to parse cached brands:', e);
    }
  }

  const cachedProducts = localStorage.getItem('merch_products');
  if (cachedProducts) {
    try {
      const products = JSON.parse(cachedProducts);
      if (Array.isArray(products)) {
        allProducts = products;
      }
    } catch (e) {
      console.error('Failed to parse cached products:', e);
    }
  }

  const cachedRetailersSku = localStorage.getItem('merch_retailers_sku');
  if (cachedRetailersSku) {
    try {
      const retailersSku = JSON.parse(cachedRetailersSku);
      if (Array.isArray(retailersSku)) {
        allRetailersSku = retailersSku;
      }
    } catch (e) {
      console.error('Failed to parse cached retailers SKU:', e);
    }
  }

  const cachedShelfLogs = localStorage.getItem('merch_shelf_logs');
  if (cachedShelfLogs) {
    try {
      const shelfLogs = JSON.parse(cachedShelfLogs);
      if (Array.isArray(shelfLogs)) {
        allShelfLogs = shelfLogs;
      }
    } catch (e) {
      console.error('Failed to parse cached shelf logs:', e);
    }
  }

  if (cachedTasks) {
    try {
      const tasks = JSON.parse(cachedTasks);
      if (Array.isArray(tasks)) {
        processTasksData(tasks);
      }
    } catch (e) {
      console.error('Failed to parse cached tasks:', e);
    }
  }

  if (cachedStores) {
    try {
      const stores = JSON.parse(cachedStores);
      if (Array.isArray(stores)) {
        processStoresData(stores);
      }
    } catch (e) {
      console.error('Failed to parse cached stores:', e);
    }
  }

  const cachedLogs = localStorage.getItem('merch_audit_logs');
  if (cachedLogs) {
    try {
      const logs = JSON.parse(cachedLogs);
      if (Array.isArray(logs)) {
        const sixtyDaysAgo = Date.now() - (60 * 24 * 60 * 60 * 1000);
        allAuditLogs = logs.filter(log => {
          const logTime = parseTimestamp(log.Timestamp || log.timestamp);
          return logTime > 0 && logTime >= sixtyDaysAgo;
        });
      }
    } catch (e) {
      console.error('Failed to parse cached audit logs:', e);
    }
  }

  const cachedContacts = localStorage.getItem('merch_contacts');
  if (cachedContacts) {
    try {
      const contacts = JSON.parse(cachedContacts);
      if (Array.isArray(contacts)) {
        allContacts = contacts;
      }
    } catch (e) {
      console.error('Failed to parse cached contacts:', e);
    }
  }

  const cachedSettings = localStorage.getItem('merch_visit_setting');
  if (cachedSettings) {
    try {
      const settings = JSON.parse(cachedSettings);
      if (Array.isArray(settings)) {
        processSettingsData(settings);
      }
    } catch (e) {
      console.error('Failed to parse cached settings:', e);
    }
  }

  // Load failed syncs
  const cachedFailedSyncs = localStorage.getItem('merch_failed_syncs');
  if (cachedFailedSyncs) {
    try {
      failedSyncs = JSON.parse(cachedFailedSyncs);
      if (!Array.isArray(failedSyncs)) failedSyncs = [];
    } catch (e) {
      failedSyncs = [];
    }
  }

  // Merge failed syncs on top of loaded cached data
  mergeFailedSyncs();
}

async function fetchDataSilently() {
  if (isFetchingData) return;
  isFetchingData = true;
  
  const refreshIcon = document.getElementById('refresh-icon');
  if (refreshIcon) {
    refreshIcon.classList.add('spinning');
  }
  
  try {
    const [tasksRes, storesRes, retailersRes, logsRes, usersRes, brandsRes, productsRes, retailersSkuRes, shelfLogsRes, settingsRes, contactsRes] = await Promise.all([
      fetch(`${WORKER_URL}/api/app1/tasks?t=${Date.now()}`),
      fetch(`${WORKER_URL}/api/app1/store-retailer?t=${Date.now()}`),
      fetch(`${WORKER_URL}/api/app1/retailers?t=${Date.now()}`),
      fetch(`${WORKER_URL}/api/app1/Merch_Visit_Product_Audit_Logs?t=${Date.now()}`),
      fetch(`${WORKER_URL}/api/app1/users?t=${Date.now()}`),
      fetch(`${WORKER_URL}/api/app1/brands?t=${Date.now()}`),
      fetch(`${WORKER_URL}/api/app1/products?t=${Date.now()}`),
      fetch(`${WORKER_URL}/api/app1/retailers_sku?t=${Date.now()}`),
      fetch(`${WORKER_URL}/api/app1/Merch_Visit_Shelf_Audit_Logs?t=${Date.now()}`),
      fetch(`${WORKER_URL}/api/app1/Merch_Visit_Setting?t=${Date.now()}`),
      fetch(`${WORKER_URL}/api/app1/contacts?t=${Date.now()}`)
    ]);

    if (retailersRes.ok) {
      const retailers = await retailersRes.json();
      if (Array.isArray(retailers)) {
        localStorage.setItem('merch_retailers', JSON.stringify(retailers));
        processRetailersData(retailers);
      }
    }

    if (usersRes.ok) {
      const users = await usersRes.json();
      if (Array.isArray(users)) {
        localStorage.setItem('merch_users', JSON.stringify(users));
        processUsersData(users);
      }
    }

    if (brandsRes.ok) {
      const brands = await brandsRes.json();
      if (Array.isArray(brands)) {
        localStorage.setItem('merch_brands', JSON.stringify(brands));
        allBrands = brands;
      }
    }

    if (productsRes.ok) {
      const products = await productsRes.json();
      if (Array.isArray(products)) {
        localStorage.setItem('merch_products', JSON.stringify(products));
        allProducts = products;
      }
    }

    if (retailersSkuRes.ok) {
      const retailersSku = await retailersSkuRes.json();
      if (Array.isArray(retailersSku)) {
        localStorage.setItem('merch_retailers_sku', JSON.stringify(retailersSku));
        allRetailersSku = retailersSku;
      }
    }

    if (shelfLogsRes.ok) {
      const shelfLogs = await shelfLogsRes.json();
      if (Array.isArray(shelfLogs)) {
        localStorage.setItem('merch_shelf_logs', JSON.stringify(shelfLogs));
        allShelfLogs = shelfLogs;
      }
    }

    if (logsRes.ok) {
      const logs = await logsRes.json();
      if (Array.isArray(logs)) {
        const sixtyDaysAgo = Date.now() - (60 * 24 * 60 * 60 * 1000);
        const filteredLogs = logs.filter(log => {
          const logTime = parseTimestamp(log.Timestamp || log.timestamp);
          return logTime > 0 && logTime >= sixtyDaysAgo;
        });
        localStorage.setItem('merch_audit_logs', JSON.stringify(filteredLogs));
        allAuditLogs = filteredLogs;
      }
    }

    if (settingsRes.ok) {
      const settings = await settingsRes.json();
      if (Array.isArray(settings)) {
        localStorage.setItem('merch_visit_setting', JSON.stringify(settings));
        processSettingsData(settings);
      }
    }

    if (tasksRes.ok) {
      const tasks = await tasksRes.json();
      if (Array.isArray(tasks)) {
        localStorage.setItem('merch_tasks', JSON.stringify(tasks));
        processTasksData(tasks);
      }
    }

    if (storesRes.ok) {
      const stores = await storesRes.json();
      if (Array.isArray(stores)) {
        localStorage.setItem('merch_stores', JSON.stringify(stores));
        processStoresData(stores);
      }
    }

    if (contactsRes && contactsRes.ok) {
      const contacts = await contactsRes.json();
      if (Array.isArray(contacts)) {
        localStorage.setItem('merch_contacts', JSON.stringify(contacts));
        allContacts = contacts;
      }
    }

    // Merge failed syncs back into the freshly loaded datasets
    mergeFailedSyncs();

    // Re-render UI views based on the merged state
    updateStoreCount();
    renderStoresList();

    const activeItem = document.querySelector('.drawer-item.active, .footer-item.active');
    if (activeItem) {
      const menu = activeItem.getAttribute('data-menu');
      if (menu === 'phonebook') {
        renderPhonebook();
      } else if (menu === 'po-request') {
        initPoRequest();
      }
    }

    lastRefreshTime = Date.now();
  } catch (err) {
    console.error('Silent background fetch failed:', err);
  } finally {
    isFetchingData = false;
    updateSyncUI();
    const refreshIcon = document.getElementById('refresh-icon');
    if (refreshIcon) {
      refreshIcon.classList.remove('spinning');
    }
    updateRefreshButtonState();
  }
}

function updateRefreshButtonState() {
  const refreshBtnEl = document.getElementById('refresh-btn');
  if (!refreshBtnEl) return;
  
  const elapsed = Date.now() - lastRefreshTime;
  if (elapsed >= 60000) { // 1 minute
    refreshBtnEl.classList.add('needs-refresh');
  } else {
    refreshBtnEl.classList.remove('needs-refresh');
  }
}

function handleUserActivity() {
  if (isFetchingData) return;
  const elapsed = Date.now() - lastRefreshTime;
  if (elapsed >= 180000) { // 3 minutes
    console.log("3 minutes passed since last refresh. Triggering auto-refresh on user activity.");
    fetchDataSilently();
  }
}

// Bind activity listeners immediately
['mousemove', 'click', 'touchstart', 'scroll', 'keydown'].forEach(eventType => {
  window.addEventListener(eventType, handleUserActivity, { passive: true });
});

// Setup interval to check refresh status every second
setInterval(updateRefreshButtonState, 1000);

// Listen for PWA installation prompt
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  // If the user is currently on the install page, refresh it
  const activeItem = document.querySelector('.drawer-item.active, .footer-item.active');
  if (activeItem && activeItem.getAttribute('data-menu') === 'install-app') {
    renderInstallOptions();
  }
});

// Listen for successful PWA installation
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  const activeItem = document.querySelector('.drawer-item.active, .footer-item.active');
  if (activeItem && activeItem.getAttribute('data-menu') === 'install-app') {
    renderInstallOptions();
  }
  showToast("iB Merchandiser App installed successfully!", "success");
});

function renderInstallOptions() {
  const container = document.getElementById('install-options');
  if (!container) return;
  
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  
  if (isStandalone) {
    container.innerHTML = `
      <div class="install-card success">
        <div class="install-card-icon">🎉</div>
        <h3>App Already Installed</h3>
        <p>iB Merchandiser is already installed and running as a standalone app on your device.</p>
      </div>
    `;
    return;
  }
  
  if (deferredPrompt) {
    container.innerHTML = `
      <div class="install-card">
        <h3>Install PWA App</h3>
        <p>Install iB Merchandiser on your home screen for quick access, offline support, and full-screen experience.</p>
        <button class="install-btn" id="pwa-install-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;margin-right:8px;">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          Install App
        </button>
      </div>
    `;
    
    // Bind click listener
    const installBtn = document.getElementById('pwa-install-btn');
    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User PWA prompt response: ${outcome}`);
        deferredPrompt = null;
        renderInstallOptions();
      });
    }
    return;
  }
  
  if (isIOS) {
    container.innerHTML = `
      <div class="install-card ios">
        <h3>Install on iOS (Safari)</h3>
        <p>Follow these steps to add iB Merchandiser to your home screen:</p>
        <div class="ios-steps">
          <div class="ios-step">
            <span class="step-num">1</span>
            <span>Tap the <strong>Share</strong> button in Safari's bottom toolbar:</span>
            <div style="margin-top: 8px; text-align: center;">
              <svg viewBox="0 0 24 24" fill="none" stroke="#007AFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:28px;height:28px;display:inline-block;">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
                <polyline points="16 6 12 2 8 6"></polyline>
                <line x1="12" y1="2" x2="12" y2="15"></line>
              </svg>
            </div>
          </div>
          <div class="ios-step" style="margin-top: 16px;">
            <span class="step-num">2</span>
            <span>Scroll down and select <strong>"Add to Home Screen"</strong>:</span>
            <div style="margin-top: 8px; text-align: center;">
              <div style="display: inline-flex; align-items: center; justify-content: center; background: #E5E5EA; color: #000; font-size: 18px; font-weight: 500; width: 32px; height: 32px; border-radius: 8px; border: 1px solid #C7C7CC;">+</div>
            </div>
          </div>
        </div>
      </div>
    `;
    return;
  }
  
  // Fallback for non-supported browsers or manual installs
  container.innerHTML = `
    <div class="install-card fallback">
      <h3>Install App Manually</h3>
      <p>To add this app to your home screen:</p>
      <ul style="text-align: left; font-size: 13px; line-height: 1.6; padding-left: 20px; color: var(--text-secondary); margin-top: 10px;">
        <li>Open your browser settings menu (tap the <strong>three dots</strong> or lines icon in the top/bottom corner).</li>
        <li>Select <strong>"Add to Home Screen"</strong> or <strong>"Install App"</strong>.</li>
      </ul>
    </div>
  `;
}

function processRetailersData(retailers) {
  allRetailers = retailers;
  retailerMap = {};
  retailers.forEach(r => {
    const id = r.ID || r.id || "";
    const name = r["Display Name"] || r.name || "";
    if (id) {
      retailerMap[id.toString()] = name;
    }
  });
}

function processUsersData(users) {
  allUsers = users;
  merchUserMap = {};
  users.forEach(u => {
    const id = (u.ID || u.id || "").toString().trim();
    const name = (u.Name || u.name || "").toString().trim();
    if (id && name) {
      merchUserMap[id] = name;
    }
  });
}

function processSettingsData(settings) {
  // Reset settings to default
  visitSettings = {
    frequency: 0,
    focusRetailers: [],
    focusStatus: [],
    focusRanks: [],
    avoidRetailers: []
  };

  if (!Array.isArray(settings)) return;

  settings.forEach(row => {
    const idSetting = String(row['ID Setting'] || row['id_setting'] || row['IDSetting'] || '').trim().toLowerCase();
    const val = String(row.Value || row.value || '').trim();

    if (idSetting.includes('frequency')) {
      const num = parseInt(val);
      visitSettings.frequency = isNaN(num) ? 0 : num;
    } else if (idSetting.includes('focus retailers') || idSetting.includes('focus_retailer')) {
      visitSettings.focusRetailers = val ? val.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : [];
    } else if (idSetting.includes('focus status') || idSetting.includes('focus_status')) {
      visitSettings.focusStatus = val ? val.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
    } else if (idSetting.includes('focus rank') || idSetting.includes('focus_rank')) {
      visitSettings.focusRanks = val ? val.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
    } else if (idSetting.includes('avoid retailers') || idSetting.includes('avoid_retailer')) {
      visitSettings.avoidRetailers = val ? val.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : [];
    }
  });
  console.log('Processed Visit Settings:', visitSettings);
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

function getLatestVisitMap() {
  const map = {};
  if (Array.isArray(allAuditLogs)) {
    allAuditLogs.forEach(log => {
      const storeId = (log['Retailer Stores ID'] || log['retailer_store_id'] || log['RetailerStoresID'] || "").toString().trim();
      if (!storeId) return;
      const ts = log.Timestamp || log.timestamp;
      if (!ts) return;
      const timeMs = parseTimestamp(ts);
      if (!timeMs) return;
      if (!map[storeId] || timeMs > map[storeId]) {
        map[storeId] = timeMs;
      }
    });
  }
  return map;
}

function processTasksData(tasks) {
  allTasks = tasks;
  // 1. Filter tasks where Task Action is "Visit" (case-insensitive)
  const visitTasks = tasks.filter(t => {
    const actionVal = t['Task Action'] || t['task action'] || t['TaskAction'] || '';
    return String(actionVal).trim().toLowerCase() === 'visit';
  });

  // 2. Filter out completed tasks where Task Log contains "Visited" action
  const pendingTasks = visitTasks.filter(t => {
    const logVal = t['Task Log'] || t['task log'] || t['TaskLog'] || '[]';
    try {
      const logs = JSON.parse(logVal);
      if (Array.isArray(logs)) {
        return !logs.some(log => {
          const action = log['Action'] || log['action'] || '';
          return String(action).trim().toLowerCase() === 'visited';
        });
      }
    } catch (e) {
      // Fallback
    }
    return true;
  });

  const pendingCount = pendingTasks.length;
  updateBadges(pendingCount);
}

function updateBadges(count) {
  if (count > 0) {
    // Header Hamburger badge
    headerBadge.textContent = count;
    headerBadge.classList.remove('hidden');

    // Drawer Special Task badge
    drawerBadge.textContent = count;
    drawerBadge.classList.remove('hidden');
  } else {
    headerBadge.classList.add('hidden');
    drawerBadge.classList.add('hidden');
  }
}

function checkPWADisplayMode() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (isStandalone) {
    const installItem = document.querySelector('.footer-item[data-menu="install-app"]');
    if (installItem) installItem.classList.add('hidden');
    
    const divider = document.querySelector('.footer-divider');
    if (divider) divider.classList.add('hidden');
    
    const exitItem = document.getElementById('exit-btn');
    if (exitItem) exitItem.classList.add('hidden');
  }
}

function processStoresData(stores) {
  allStores = stores;
  renderZoneTabs();
  updateStoreCount();
  
  // Render stores list if currently on Daily Task or Latest Visit
  const activeItem = document.querySelector('.drawer-item.active, .footer-item.active');
  if (activeItem) {
    const menu = activeItem.getAttribute('data-menu');
    if (menu === 'daily-task' || menu === 'latest-visit') {
      renderStoresList();
    }
  }
}

function renderZoneTabs() {
  const zoneBar = document.getElementById('zone-bar');
  if (!zoneBar) return;

  const zones = new Set();
  allStores.forEach(store => {
    const zone = store.Zones || store.zones;
    if (zone && zone.trim()) {
      zones.add(zone.trim());
    }
  });

  const sortedZones = Array.from(zones).sort();

  let html = `<button class="zone-tab ${activeZone === 'All' ? 'active' : ''}" data-zone="All">All</button>`;
  sortedZones.forEach(zone => {
    html += `<button class="zone-tab ${activeZone === zone ? 'active' : ''}" data-zone="${zone}">${zone}</button>`;
  });
  zoneBar.innerHTML = html;
  const tabs = zoneBar.querySelectorAll('.zone-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeZone = tab.getAttribute('data-zone');
      dailyTaskLimit = 10; // Reset pagination limit on zone change
      updateStoreCount();
      renderStoresList();
    });
  });
}

function updateStoreCount() {
  const storeCountDisplay = document.getElementById('store-count-display');
  if (!storeCountDisplay) return;

  const latestVisitMap = getLatestVisitMap();
  const nowMs = Date.now();
  const freqMs = (visitSettings.frequency || 0) * 24 * 60 * 60 * 1000;

  // Compute pending special tasks store IDs
  const pendingSpecialTaskStoreIds = new Set();
  allTasks.forEach(task => {
    const actionVal = String(task['Task Action'] || task['task action'] || task['TaskAction'] || '').trim().toLowerCase();
    if (actionVal !== 'visit') return;
    
    const logVal = task['Task Log'] || task['task log'] || task['TaskLog'] || '[]';
    let isCompleted = false;
    try {
      const logs = JSON.parse(logVal);
      if (Array.isArray(logs)) {
        isCompleted = logs.some(log => {
          const action = log['Action'] || log['action'] || '';
          return String(action).trim().toLowerCase() === 'visited';
        });
      }
    } catch (e) {}
    
    if (!isCompleted) {
      const storeId = (task['Stores ID'] || task['stores id'] || task['StoresID'] || "").toString().trim();
      if (storeId) {
        pendingSpecialTaskStoreIds.add(storeId);
      }
    }
  });

  let filteredStores = allStores;
  if (activeZone !== 'All') {
    filteredStores = allStores.filter(store => {
      const zone = store.Zones || store.zones || '';
      return zone.trim().toLowerCase() === activeZone.trim().toLowerCase();
    });
  }

  // Apply Settings filters to pending store count
  filteredStores = filteredStores.filter(store => {
    const storeId = (store.ID || store.id || "").toString().trim();
    
    // If store has a pending special task, bypass settings filter
    if (pendingSpecialTaskStoreIds.has(storeId)) {
      return true;
    }
    
    // Visit Frequency Filter (hide recently visited stores)
    if (freqMs > 0) {
      const lastVisitTime = latestVisitMap[storeId];
      if (lastVisitTime && (nowMs - lastVisitTime <= freqMs)) {
        return false; // Visited within frequency -> hide
      }
    }
    
    // Focus Retailers
    if (visitSettings.focusRetailers.length > 0) {
      const retId = (store['Retailers ID'] || store.retailer_id || "").toString().trim().toUpperCase();
      if (!visitSettings.focusRetailers.includes(retId)) {
        return false;
      }
    }
    
    // Avoid Retailers
    if (visitSettings.avoidRetailers.length > 0) {
      const retId = (store['Retailers ID'] || store.retailer_id || "").toString().trim().toUpperCase();
      if (visitSettings.avoidRetailers.includes(retId)) {
        return false;
      }
    }
    
    // Focus Status
    if (visitSettings.focusStatus.length > 0) {
      const status = (store.Status || store.status || "").toString().trim().toLowerCase();
      if (!visitSettings.focusStatus.includes(status)) {
        return false;
      }
    }
    
    // Focus Rank
    if (visitSettings.focusRanks.length > 0) {
      const rank = (store['Store Rank'] || store.store_rank || store.rank || "").toString().trim().toLowerCase();
      if (!visitSettings.focusRanks.includes(rank)) {
        return false;
      }
    }
    
    return true;
  });

  storeCountDisplay.textContent = `Pending Visit: ${filteredStores.length}`;
}

// Map Action & Geolocation Toggling
function toggleMap() {
  if (mapActive) {
    // Close map
    mapActive = false;
    toggleMapBtn.classList.remove('active');
    toggleMapBtn.classList.remove('loading-loc');
    mapLimitContainer.classList.add('hidden');
    mapContainer.classList.add('hidden');
    
    // Hide overlay if it exists
    const loader = document.getElementById('map-loading-overlay');
    if (loader) {
      loader.classList.add('hidden');
    }
    
    // Clear map layers
    if (markersGroup) {
      markersGroup.clearLayers();
    }
    if (userMarker && leafletMap) {
      leafletMap.removeLayer(userMarker);
      userMarker = null;
    }
    
    renderStoresList();
  } else {
    // Open map
    if (!navigator.geolocation) {
      showToast("Geolocation is not supported by your browser", "error");
      return;
    }

    // Set map active & show container immediately
    mapActive = true;
    toggleMapBtn.classList.add('active');
    toggleMapBtn.classList.add('loading-loc');
    
    mapLimitContainer.classList.remove('hidden');
    mapContainer.classList.remove('hidden');

    // Create or show loading overlay
    let loader = document.getElementById('map-loading-overlay');
    if (!loader) {
      loader = document.createElement('div');
      loader.id = 'map-loading-overlay';
      loader.innerHTML = `
        <div class="loc-spinner-box">
          <svg class="loc-spinner spinning" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" opacity="0.25"></circle>
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round"></path>
          </svg>
          <span class="loc-loading-text">Getting your location...</span>
        </div>
      `;
      mapContainer.appendChild(loader);
    } else {
      loader.classList.remove('hidden');
    }

    initLeafletMap();
    renderStoresList();

    navigator.geolocation.getCurrentPosition(
      (position) => {
        // If user closed the map while it was loading, ignore
        if (!mapActive) return;

        userLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };

        toggleMapBtn.classList.remove('loading-loc');
        if (loader) {
          loader.classList.add('hidden');
        }

        // Re-center map to user's location
        if (leafletMap) {
          leafletMap.setView([userLocation.lat, userLocation.lng], 12);
        }

        renderStoresList();
      },
      (error) => {
        // If user closed the map while it was loading, ignore
        if (!mapActive) return;

        toggleMapBtn.classList.remove('loading-loc');
        toggleMapBtn.classList.remove('active');
        if (loader) {
          loader.classList.add('hidden');
        }
        mapActive = false;
        mapLimitContainer.classList.add('hidden');
        mapContainer.classList.add('hidden');

        let msg = "Error getting location.";
        if (error.code === error.PERMISSION_DENIED) msg = "Permission denied. Please enable location access.";
        else if (error.code === error.POSITION_UNAVAILABLE) msg = "Location unavailable.";
        else if (error.code === error.TIMEOUT) msg = "Request timed out.";
        showToast(msg, "error");

        renderStoresList();
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }
}

// Map Initialization
function initLeafletMap() {
  if (leafletMap) {
    setTimeout(() => {
      leafletMap.invalidateSize();
    }, 100);
    return;
  }

  const centerLat = userLocation ? userLocation.lat : 1.3521;
  const centerLng = userLocation ? userLocation.lng : 103.8198;

  leafletMap = L.map('map-view', {
    zoomControl: false,
    attributionControl: false
  }).setView([centerLat, centerLng], 12);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(leafletMap);

  markersGroup = L.featureGroup().addTo(leafletMap);

  // Invalidate size shortly after initialization to ensure proper tiles rendering
  setTimeout(() => {
    leafletMap.invalidateSize();
  }, 200);
}

// Render Stores List & Markers
function renderStoresList() {
  if (!storesList) return;

  const activeItem = document.querySelector('.drawer-item.active, .footer-item.active');
  const currentMenu = activeItem ? activeItem.getAttribute('data-menu') : 'daily-task';

  const mobileContent = document.querySelector('.mobile-content');
  const oldScrollTop = (mobileContent && lastRenderedMenu === currentMenu) ? mobileContent.scrollTop : 0;

  storesList.innerHTML = '';

  const latestVisitMap = getLatestVisitMap();
  const nowMs = Date.now();
  const freqMs = (visitSettings.frequency || 0) * 24 * 60 * 60 * 1000;

  // Compute pending special tasks store IDs
  const pendingSpecialTaskStoreIds = new Set();
  allTasks.forEach(task => {
    const actionVal = String(task['Task Action'] || task['task action'] || task['TaskAction'] || '').trim().toLowerCase();
    if (actionVal !== 'visit') return;
    
    const logVal = task['Task Log'] || task['task log'] || task['TaskLog'] || '[]';
    let isCompleted = false;
    try {
      const logs = JSON.parse(logVal);
      if (Array.isArray(logs)) {
        isCompleted = logs.some(log => {
          const action = log['Action'] || log['action'] || '';
          return String(action).trim().toLowerCase() === 'visited';
        });
      }
    } catch (e) {}
    
    if (!isCompleted) {
      const storeId = (task['Stores ID'] || task['stores id'] || task['StoresID'] || "").toString().trim();
      if (storeId) {
        pendingSpecialTaskStoreIds.add(storeId);
      }
    }
  });

  let filtered = [];

  if (currentMenu === 'latest-visit') {
    // 1. Latest Visit Mode: Keep only stores visited within range of frequency day
    filtered = allStores.filter(store => {
      const storeId = (store.ID || store.id || "").toString().trim();
      const lastVisitTime = latestVisitMap[storeId];
      
      if (!lastVisitTime) return false; // Never visited -> hide
      
      if (freqMs > 0 && (nowMs - lastVisitTime > freqMs)) {
        return false; // Visited outside the frequency window -> hide
      }
      
      return true;
    });
    
    // Sort by latest visit first (newest at top)
    filtered.sort((a, b) => {
      const storeIdA = (a.ID || a.id || "").toString().trim();
      const storeIdB = (b.ID || b.id || "").toString().trim();
      const timeA = latestVisitMap[storeIdA] || 0;
      const timeB = latestVisitMap[storeIdB] || 0;
      return timeB - timeA;
    });
  } else if (currentMenu === 'special-task') {
    // 2. Special Task Mode: Filter tasks where Task Action has value 'visit' / 'Visit' and is not yet complete
    filtered = allTasks.filter(task => {
      const actionVal = String(task['Task Action'] || task['task action'] || task['TaskAction'] || '').trim().toLowerCase();
      // Only keep tasks where action is 'visit'
      if (actionVal !== 'visit') return false;
      
      // Filter out completed tasks where Task Log contains "Visited" action
      const logVal = task['Task Log'] || task['task log'] || task['TaskLog'] || '[]';
      try {
        const logs = JSON.parse(logVal);
        if (Array.isArray(logs)) {
          return !logs.some(log => {
            const action = log['Action'] || log['action'] || '';
            return String(action).trim().toLowerCase() === 'visited';
          });
        }
      } catch (e) {}
      return true;
    });

    // Sort by longest pending on top (oldest Created Date first)
    filtered.sort((a, b) => {
      const timeA = parseTimestamp(a['Created Date'] || a['CreatedDate'] || a.timestamp || 0);
      const timeB = parseTimestamp(b['Created Date'] || b['CreatedDate'] || b.timestamp || 0);
      return timeA - timeB;
    });
  } else {
    // 3. Daily Task Mode: Apply zone and settings filters
    filtered = allStores;
    if (activeZone !== 'All') {
      filtered = allStores.filter(store => {
        const zone = store.Zones || store.zones || '';
        return zone.trim().toLowerCase() === activeZone.trim().toLowerCase();
      });
    }

    filtered = filtered.filter(store => {
      const storeId = (store.ID || store.id || "").toString().trim();
      
      // If store has a pending special task, bypass settings filter
      if (pendingSpecialTaskStoreIds.has(storeId)) {
        return true;
      }
      
      // Visit Frequency Filter (hide recently visited stores)
      if (freqMs > 0) {
        const lastVisitTime = latestVisitMap[storeId];
        if (lastVisitTime && (nowMs - lastVisitTime <= freqMs)) {
          return false; // Visited within frequency -> hide
        }
      }
      
      // Focus Retailers
      if (visitSettings.focusRetailers.length > 0) {
        const retId = (store['Retailers ID'] || store.retailer_id || "").toString().trim().toUpperCase();
        if (!visitSettings.focusRetailers.includes(retId)) {
          return false;
        }
      }
      
      // Avoid Retailers
      if (visitSettings.avoidRetailers.length > 0) {
        const retId = (store['Retailers ID'] || store.retailer_id || "").toString().trim().toUpperCase();
        if (visitSettings.avoidRetailers.includes(retId)) {
          return false;
        }
      }
      
      // Focus Status
      if (visitSettings.focusStatus.length > 0) {
        const status = (store.Status || store.status || "").toString().trim().toLowerCase();
        if (!visitSettings.focusStatus.includes(status)) {
          return false;
        }
      }
      
      // Focus Rank
      if (visitSettings.focusRanks.length > 0) {
        const rank = (store['Store Rank'] || store.store_rank || store.rank || "").toString().trim().toLowerCase();
        if (!visitSettings.focusRanks.includes(rank)) {
          return false;
        }
      }
      
      return true;
    });
  }

  // 4. Search query filter (applies to all menus)
  const query = searchQuery.trim().toLowerCase();
  if (query) {
    const queryWords = query.split(/\s+/).filter(w => w.length > 0);
    if (queryWords.length > 0) {
      filtered = filtered.filter(item => {
        if (currentMenu === 'special-task') {
          const storeId = (item['Stores ID'] || item['stores id'] || item['StoresID'] || "").toString().trim();
          const store = allStores.find(s => (s.ID || s.id || "").toString().trim() === storeId);
          const storeName = store ? (store["Display Name"] || store.name || "").toLowerCase() : "";
          const retailerId = store ? (store["Retailers ID"] || store.retailer_id || "") : "";
          const retailerName = store ? (retailerMap[retailerId.toString()] || retailerId || "").toLowerCase() : "";
          const address = store ? (store.Address || store.address || "").toLowerCase() : "";
          const taskDesc = (item['Task Description'] || item['task_description'] || "").toLowerCase();
          
          const text = `${storeName} ${retailerName} ${address} ${taskDesc}`;
          return queryWords.every(word => text.includes(word));
        } else {
          const storeName = (item["Display Name"] || item.name || "").toLowerCase();
          const retailerId = item["Retailers ID"] || item.retailer_id || "";
          const retailerName = (retailerMap[retailerId.toString()] || retailerId || "").toLowerCase();
          const address = (item.Address || item.address || "").toLowerCase();
          const zoneVal = (item.Zones || item.zones || "").toLowerCase();
          const idVal = (item.ID || item.id || "").toString().toLowerCase();

          const storeText = `${idVal} ${storeName} ${retailerName} ${address} ${zoneVal}`;
          return queryWords.every(word => storeText.includes(word));
        }
      });
    }
  }

  // 4. Proximity calculation & greedy nearest-neighbor routing chain (Daily Task only)
  if (mapActive && userLocation && currentMenu === 'daily-task') {
    const unvisited = [];
    const invalidCoords = [];
    
    filtered.forEach(store => {
      const locStr = store["Pin Locations"] || store.coords || store.Coords || store.location || store["Buyer Store Location"] || "";
      const loc = parseLocation(locStr);
      if (loc) {
        store._coords = loc;
        unvisited.push(store);
      } else {
        invalidCoords.push(store);
      }
    });

    const orderedRoute = [];
    let currentPos = userLocation;

    while (unvisited.length > 0 && orderedRoute.length < mapLimit) {
      let closestIdx = -1;
      let minDistance = Infinity;

      for (let i = 0; i < unvisited.length; i++) {
        const dist = calculateDistance(currentPos.lat, currentPos.lng, unvisited[i]._coords.lat, unvisited[i]._coords.lng);
        if (dist < minDistance) {
          minDistance = dist;
          closestIdx = i;
        }
      }

      if (closestIdx !== -1) {
        const closestStore = unvisited.splice(closestIdx, 1)[0];
        orderedRoute.push(closestStore);
        currentPos = closestStore._coords;
      } else {
        break;
      }
    }

    // Append invalid coordinate stores if we still have room under the limit
    if (orderedRoute.length < mapLimit && invalidCoords.length > 0) {
      const remainingSpace = mapLimit - orderedRoute.length;
      orderedRoute.push(...invalidCoords.slice(0, remainingSpace));
    }

    filtered = orderedRoute;

    updateMapMarkers(filtered);
  } else {
    // Clear map markers if map exists but is closed
    if (markersGroup) {
      markersGroup.clearLayers();
    }
    if (userMarker && leafletMap) {
      leafletMap.removeLayer(userMarker);
      userMarker = null;
    }
  }

  // 3. Render Store Cards
  if (filtered.length === 0) {
    storesList.innerHTML = `
      <div style="text-align: center; padding: 30px 20px; color: var(--text-muted); font-size: 13px; font-weight: 500;">
        No stores found.
      </div>
    `;
    if (mobileContent) {
      if (lastRenderedMenu === currentMenu) {
        mobileContent.scrollTop = oldScrollTop;
      } else {
        mobileContent.scrollTop = 0;
      }
    }
    lastRenderedMenu = currentMenu;
    return;
  }

  if (currentMenu === 'special-task') {
    filtered.forEach((task, index) => {
      const taskIdStr = (task.ID || task.id || task['Created Date'] || task.CreatedDate || "").toString();
      const storeId = (task['Stores ID'] || task['stores id'] || task['StoresID'] || "").toString().trim();
      const store = allStores.find(s => (s.ID || s.id || "").toString().trim() === storeId);
      if (!store) return;
      
      const storeName = store["Display Name"] || store.name || store["Buyer Store Name"] || "Unknown Store";
      const retailerId = store["Retailers ID"] || store.retailer_id || "";
      const retailerName = retailerMap[retailerId.toString()] || retailerId || "N/A";
      const address = store.Address || store.address || store["Buyer Store Address"] || store.location || "No Address Provided";
      const zoneVal = store.Zones || store.zones || "N/A";
      
      const statusVal = (store.Status || store.status || "").trim();
      let statusClass = "status-pending";
      let statusLabel = "Pending";
      if (statusVal.toLowerCase() === "carry") {
        statusClass = "status-carry";
        statusLabel = "Carry";
      } else if (statusVal.toLowerCase() === "not carry") {
        statusClass = "status-not-carry";
        statusLabel = "Not Carry";
      } else if (statusVal.toLowerCase() === "store closed") {
        statusClass = "status-closed";
        statusLabel = "Store Closed";
      }
      
      const rankVal = (store["Store Rank"] || store.store_rank || store.rank || "").toString().trim();
      let rankHtml = '';
      if (rankVal) {
        rankHtml = `<span class="store-badge rank-badge">Rank ${rankVal}</span>`;
      }
      
      const taskDesc = task['Task Description'] || task['task_description'] || '';
      
      const createdTime = parseTimestamp(task['Created Date'] || task['CreatedDate'] || task.timestamp);
      const timeAgo = formatTimeAgo(createdTime);
      
      const card = document.createElement('div');
      card.className = 'store-card special-task-card';
      card.innerHTML = `
        <div class="store-card-header" style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; width: 100%;">
          <div class="store-card-title-group">
            <div class="store-card-name">${storeName}</div>
            <div class="store-card-retailer">${retailerName}</div>
          </div>
          <div class="store-task-pending" style="color: #EF4444; font-size: 11px; font-weight: 600; white-space: nowrap; margin-left: auto; text-align: right;">${timeAgo}</div>
        </div>
        <div class="store-card-address">${address}</div>
        <div class="store-task-desc" style="font-size: 13px; font-weight: 600; color: var(--text-color); margin-top: 8px;">Task: ${taskDesc}</div>
        <div class="store-card-footer" style="margin-top: 12px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <span class="store-badge zone-badge">${zoneVal}</span>
            <span class="store-badge ${statusClass}">${statusLabel}</span>
            ${rankHtml}
          </div>
          <button class="complete-task-btn primary-btn" data-task-id="${taskIdStr}" style="padding: 6px 12px; font-size: 12px; border-radius: 6px; font-weight: 600; cursor: pointer; background: var(--app-color); color: white; border: none;">Complete Task</button>
        </div>
      `;
      storesList.appendChild(card);
    });

    // Bind click listeners for Complete Task Buttons
    const completeButtons = storesList.querySelectorAll('.complete-task-btn');
    completeButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const taskId = btn.getAttribute('data-task-id');
        openCompleteTaskRemark(taskId);
      });
    });
  } else {
    let storesToRender = filtered;
    let hasMore = false;
    if (currentMenu === 'daily-task' && !mapActive) {
      storesToRender = filtered.slice(0, dailyTaskLimit);
      hasMore = filtered.length > dailyTaskLimit;
    }

    storesToRender.forEach((store, index) => {
      const storeName = store["Display Name"] || store.name || store["Buyer Store Name"] || "Unknown Store";
      const retailerId = store["Retailers ID"] || store.retailer_id || "";
      const retailerName = retailerMap[retailerId.toString()] || retailerId || "N/A";
      const address = store.Address || store.address || store["Buyer Store Address"] || store.location || "No Address Provided";
      const zoneVal = store.Zones || store.zones || "N/A";
      
      const statusVal = (store.Status || store.status || "").trim();
      let statusClass = "status-pending";
      let statusLabel = "Pending";
      if (statusVal.toLowerCase() === "carry") {
        statusClass = "status-carry";
        statusLabel = "Carry";
      } else if (statusVal.toLowerCase() === "not carry") {
        statusClass = "status-not-carry";
        statusLabel = "Not Carry";
      } else if (statusVal.toLowerCase() === "store closed") {
        statusClass = "status-closed";
        statusLabel = "Store Closed";
      }

      const locStr = store["Pin Locations"] || store.coords || store.location || "";
      let navigateHtml = '';
      if (locStr) {
        const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(locStr.trim())}`;
        navigateHtml = `
          <a href="${googleMapsUrl}" target="_blank" class="store-navigate-btn" title="Navigate with Google Maps">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="navigate-icon">
              <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
            </svg>
          </a>
        `;
      }

      const storeIdStr = (store.ID || store.id || "").toString();
      const infoHtml = `
        <button class="store-info-btn" data-id="${storeIdStr}" title="View Store Audit Details">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="info-icon">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
        </button>
      `;

      let whatsappHtml = '';
      if (currentMenu === 'latest-visit') {
        whatsappHtml = `
          <button class="store-whatsapp-btn" data-id="${storeIdStr}" title="Share to WhatsApp" style="background: none; border: none; padding: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #25D366;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px;">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
            </svg>
          </button>
        `;
      }

      const rankVal = (store["Store Rank"] || store.store_rank || store.rank || "").toString().trim();
      let rankHtml = '';
      if (rankVal) {
        rankHtml = `<span class="store-badge rank-badge">Rank ${rankVal}</span>`;
      }

      const indexPrefix = mapActive ? `<span style="color: var(--app-color); font-weight: 800;">${index + 1}. </span>` : '';

      let lastVisitHtml = '';
      if (currentMenu === 'latest-visit') {
        const lastVisitTime = latestVisitMap[storeIdStr];
        if (lastVisitTime) {
          lastVisitHtml = `<span class="store-badge visit-badge" style="background-color: var(--app-bg-light); color: var(--app-color); border: 1px solid var(--app-color); font-size: 9.5px; font-weight: 500;">Visited: ${formatTimestamp(lastVisitTime).split(',')[0]}</span>`;
        }
      }

      const hasSpecialTask = pendingSpecialTaskStoreIds.has(storeIdStr.trim());
      let specialTaskBadgeHtml = '';
      if (hasSpecialTask) {
        specialTaskBadgeHtml = `<span class="store-badge special-task-badge" style="background: #FEE2E2; color: #EF4444; border: 1px solid #FECACA; font-weight: 600;">Special Task</span>`;
      }

      const card = document.createElement('div');
      card.className = `store-card ${hasSpecialTask ? 'has-special-task' : ''}`;
      card.innerHTML = `
        <div class="store-card-header">
          <div class="store-card-title-group">
            <div class="store-card-name">${indexPrefix}${storeName}</div>
            <div class="store-card-retailer">${retailerName}</div>
          </div>
          <div class="store-card-right-group">
            ${whatsappHtml}
            ${infoHtml}
            ${navigateHtml}
          </div>
        </div>
        <div class="store-card-address">${address}</div>
        <div class="store-card-footer">
          <span class="store-badge zone-badge">${zoneVal}</span>
          <span class="store-badge ${statusClass}">${statusLabel}</span>
          ${rankHtml}
          ${lastVisitHtml}
          ${specialTaskBadgeHtml}
        </div>
      `;
      storesList.appendChild(card);
    });

    const infoButtons = storesList.querySelectorAll('.store-info-btn');
    infoButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const storeId = btn.getAttribute('data-id');
        openStorePreview(storeId);
      });
    });

    const whatsappButtons = storesList.querySelectorAll('.store-whatsapp-btn');
    whatsappButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const storeId = btn.getAttribute('data-id');
        sharePastAuditToWhatsApp(storeId);
      });
    });

    if (hasMore) {
      const loadMoreCard = document.createElement('div');
      loadMoreCard.className = 'load-more-card';
      loadMoreCard.style.cssText = 'text-align: center; padding: 16px; margin: 12px 0 24px 0; background: var(--app-bg-light, #F8FAFC); border: 1px dashed var(--app-color, #6366F1); border-radius: 8px; color: var(--app-color, #6366F1); font-weight: 600; cursor: pointer; font-size: 13px;';
      loadMoreCard.innerHTML = 'Pull up or tap to load more stores...';
      loadMoreCard.addEventListener('click', () => {
        dailyTaskLimit += 10;
        renderStoresList();
      });
      storesList.appendChild(loadMoreCard);
    }
  }

  // Restore scroll position
  if (mobileContent) {
    if (lastRenderedMenu === currentMenu) {
      mobileContent.scrollTop = oldScrollTop;
    } else {
      mobileContent.scrollTop = 0;
    }
  }
  lastRenderedMenu = currentMenu;
}

// Map Markers Management
function updateMapMarkers(stores) {
  if (!leafletMap || !markersGroup) return;
  markersGroup.clearLayers();
  
  const points = [];

  // Compute pending special tasks store IDs locally for markers
  const pendingSpecialTaskStoreIds = new Set();
  allTasks.forEach(task => {
    const actionVal = String(task['Task Action'] || task['task action'] || task['TaskAction'] || '').trim().toLowerCase();
    if (actionVal !== 'visit') return;
    
    const logVal = task['Task Log'] || task['task log'] || task['TaskLog'] || '[]';
    let isCompleted = false;
    try {
      const logs = JSON.parse(logVal);
      if (Array.isArray(logs)) {
        isCompleted = logs.some(log => {
          const action = log['Action'] || log['action'] || '';
          return String(action).trim().toLowerCase() === 'visited';
        });
      }
    } catch (e) {}
    
    if (!isCompleted) {
      const storeId = (task['Stores ID'] || task['stores id'] || task['StoresID'] || "").toString().trim();
      if (storeId) {
        pendingSpecialTaskStoreIds.add(storeId);
      }
    }
  });

  // Add User Location Marker
  if (userLocation) {
    if (userMarker) {
      leafletMap.removeLayer(userMarker);
    }
    userMarker = L.marker([userLocation.lat, userLocation.lng], {
      icon: L.divIcon({
        className: 'user-location-marker',
        html: ''
      })
    }).bindPopup('<b>Your Location</b>').addTo(leafletMap);
    points.push([userLocation.lat, userLocation.lng]);
  }

  // Add Store Markers
  stores.forEach((store, index) => {
    const locStr = store["Pin Locations"] || store.coords || store.Coords || store.location || store["Buyer Store Location"] || "";
    const loc = parseLocation(locStr);
    if (loc) {
      const storeName = store["Display Name"] || store.name || store["Buyer Store Name"] || "Store";
      const storeIdStr = (store.ID || store.id || "").toString().trim();
      const hasSpecialTask = pendingSpecialTaskStoreIds.has(storeIdStr);
      const specialTaskMarkerText = hasSpecialTask ? " (Special Task)" : "";
      
      const marker = L.marker([loc.lat, loc.lng], {
        icon: L.divIcon({
          className: `numbered-marker ${hasSpecialTask ? 'special-task-marker' : ''}`,
          html: (index + 1).toString()
        })
      }).bindPopup(`<b>${index + 1}. ${storeName}${specialTaskMarkerText}</b>`);
      
      markersGroup.addLayer(marker);
      points.push([loc.lat, loc.lng]);
    }
  });

  // Fit bounds containing all markers
  if (points.length > 0) {
    leafletMap.fitBounds(points, { padding: [30, 30], maxZoom: 16 });
  }
}

// Proximity Calculations
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

function parseLocation(locStr) {
  try {
    if (!locStr) return null;
    const coords = locStr.split(',').map(c => parseFloat(c.trim()));
    if (coords.length >= 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
      return { lat: coords[0], lng: coords[1] };
    }
  } catch (e) {}
  return null;
}

// Format Unix timestamp or date strings into human-readable format
function formatTimestamp(ts) {
  if (!ts) return "N/A";
  
  const timeMs = parseTimestamp(ts);
  if (!timeMs) return String(ts);
  const date = new Date(timeMs);
  
  const day = date.getDate();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${year}, ${hours}:${minutes}`;
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return "";
  const diffMs = Date.now() - timestamp;
  if (diffMs < 0) return "just now";
  
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffYears = Math.floor(diffDays / 365);
  
  if (diffYears > 0) {
    return `${diffYears} year${diffYears > 1 ? 's' : ''} ago`;
  }
  if (diffDays > 0) {
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  }
  if (diffHours > 0) {
    return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  }
  if (diffMins > 0) {
    return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  }
  return "just now";
}

// Open Store Preview full height page
function openStorePreview(storeId) {
  const store = allStores.find(s => (s.ID || s.id || "").toString() === storeId);
  if (!store) return;
  selectedStore = store;
  
  const previewPage = document.getElementById('store-preview-page');
  if (!previewPage) return;
  
  const retailerId = store["Retailers ID"] || store.retailer_id || "";
  const retailerName = retailerMap[retailerId.toString()] || retailerId || "N/A";
  const storeName = store["Display Name"] || store.name || store["Buyer Store Name"] || "Unknown Store";
  const address = store.Address || store.address || store["Buyer Store Address"] || "No Address Provided";
  const zoneVal = store.Zones || store.zones || "N/A";
  
  // Status Badge
  const statusVal = (store.Status || store.status || "").trim();
  let statusClass = "status-pending";
  let statusLabel = "Pending";
  if (statusVal.toLowerCase() === "carry") {
    statusClass = "status-carry";
    statusLabel = "Carry";
  } else if (statusVal.toLowerCase() === "not carry") {
    statusClass = "status-not-carry";
    statusLabel = "Not Carry";
  } else if (statusVal.toLowerCase() === "store closed") {
    statusClass = "status-closed";
    statusLabel = "Store Closed";
  }

  const rankVal = (store["Store Rank"] || store.store_rank || store.rank || "").toString().trim();
  let rankHtml = '';
  if (rankVal) {
    rankHtml = `<span class="store-badge rank-badge">Rank ${rankVal}</span>`;
  }
  
  document.getElementById('preview-retailer').textContent = retailerName;
  document.getElementById('preview-store-name').textContent = storeName;
  document.getElementById('preview-address').textContent = address;
  
  document.getElementById('preview-badges').innerHTML = `
    <span class="store-badge zone-badge">${zoneVal}</span>
    <span class="store-badge ${statusClass}">${statusLabel}</span>
    ${rankHtml}
  `;
  
  // Build timeline
  const timelineItems = [];
  const storeTasks = allTasks.filter(t => (t['Stores ID'] || t['stores id'] || t['StoresID'] || "").toString() === storeId);
  
  storeTasks.forEach(t => {
    // Add the task itself
    const taskDesc = t['Task Description'] || t['task_description'] || t['task'] || '';
    const taskTime = t['Created Date'] || t['timestamp'] || t['CreatedDate'] || null;
    if (taskDesc) {
      timelineItems.push({
        type: 'task',
        description: taskDesc,
        timestamp: taskTime
      });
    }
  });

  // Fetch visit product audit logs for this store from the last 60 days
  const storeLogs = allAuditLogs.filter(l => (l['Retailer Stores ID'] || l['retailer_store_id'] || l['RetailerStoresID'] || "").toString() === storeId);
  storeLogs.forEach(log => {
    const merchId = (log['Merch ID'] || log['MerchID'] || log.merch_id || '').toString().trim();
    const merchName = merchUserMap[merchId] || merchId || 'Unknown Merchandiser';
    const remarkVal = (log.Remark || log.remark || '').toString().trim();
    const remarkText = remarkVal ? remarkVal : `No Remark from ${merchName}`;

    timelineItems.push({
      type: 'visit',
      visitBy: merchName,
      remark: remarkText,
      timestamp: log.Timestamp || log.timestamp || null
    });
  });
  
  // Sort timeline by timestamp descending (latest first)
  timelineItems.sort((a, b) => {
    const tA = parseTimestamp(a.timestamp);
    const tB = parseTimestamp(b.timestamp);
    return tB - tA;
  });
  
  // Display latest 10 records
  const latestItems = timelineItems.slice(0, 10);
  const logContainer = document.getElementById('preview-timeline-log');
  
  if (latestItems.length === 0) {
    logContainer.innerHTML = `
      <div style="text-align: center; padding: 20px 0; color: var(--text-muted); font-size: 12px; font-weight: 500;">
        No recent activity or tasks.
      </div>
    `;
  } else {
    let html = '<ul class="timeline-bullet-list">';
    latestItems.forEach(item => {
      if (item.type === 'visit') {
        html += `
          <li class="timeline-bullet-item">
            <span class="bullet-icon visit-bullet"></span>
            <div class="bullet-details">
              <div><strong>Visit by:</strong> ${item.visitBy}</div>
              <div><strong>Remark:</strong> ${item.remark || 'N/A'}</div>
              <div class="bullet-time">${formatTimestamp(item.timestamp)}</div>
            </div>
          </li>
        `;
      } else {
        html += `
          <li class="timeline-bullet-item">
            <span class="bullet-icon task-bullet"></span>
            <div class="bullet-details">
              <div><strong>Task Given:</strong> ${item.description}</div>
              <div class="bullet-time">${formatTimestamp(item.timestamp)}</div>
            </div>
          </li>
        `;
      }
    });
    html += '</ul>';
    logContainer.innerHTML = html;
  }
  
  // Render contacts for this store
  const storeContacts = allContacts.filter(c => {
    const gl = String(getContactGroupLink(c)).trim().toLowerCase();
    const idLink = String(getContactIdLink(c)).trim();
    return gl === "stores" && idLink === storeId.toString().trim();
  });
  
  const contactsContainer = document.getElementById('preview-contacts-list');
  if (contactsContainer) {
    if (storeContacts.length === 0) {
      contactsContainer.innerHTML = `
        <div style="text-align: center; padding: 20px 0; color: var(--text-muted); font-size: 12px; font-weight: 500;">
          No contacts for this store.
        </div>
      `;
    } else {
      let contactsHtml = '';
      storeContacts.forEach(c => {
        const name = c.Name || c.name || "";
        const pos = c.Position || c.position || "";
        const phone = getContactPhone(c);
        const gender = (c.Gender || c.gender || "").toString().trim().toLowerCase();
        const email = c.Email || c.email || "";
        
        let prefix = "";
        if (gender === 'male') {
          prefix = "Mr. ";
        } else if (gender === 'female') {
          prefix = "Ms. ";
        }
        
        contactsHtml += `
          <div class="preview-contact-card">
            <div class="contact-info">
              <div class="contact-name">${prefix}${name}</div>
              <div class="contact-position">${pos || 'No Position'}</div>
            </div>
            <div class="contact-actions">
              ${phone ? `
              <a href="tel:${phone}" class="contact-action-btn phone-btn" title="Call">
                <svg class="contact-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                </svg>
              </a>
              ` : ''}
              ${email ? `
              <a href="mailto:${email}" class="contact-action-btn email-btn" title="Email">
                <svg class="contact-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                  <polyline points="22,6 12,13 2,6"></polyline>
                </svg>
              </a>
              ` : ''}
            </div>
          </div>
        `;
      });
      contactsContainer.innerHTML = contactsHtml;
    }
  }

  // Reset view to Timeline default state
  const titleEl = document.getElementById('preview-timeline-title');
  const toggleBtn = document.getElementById('preview-toggle-view-btn');
  const contactIcon = document.getElementById('preview-toggle-icon-contact');
  const timelineIcon = document.getElementById('preview-toggle-icon-timeline');
  
  if (titleEl) titleEl.textContent = "Timeline";
  if (logContainer) logContainer.classList.remove('hidden');
  if (contactsContainer) contactsContainer.classList.add('hidden');
  if (contactIcon) contactIcon.classList.remove('hidden');
  if (timelineIcon) timelineIcon.classList.add('hidden');

  if (toggleBtn) {
    const newToggleBtn = toggleBtn.cloneNode(true);
    toggleBtn.parentNode.replaceChild(newToggleBtn, toggleBtn);
    
    newToggleBtn.addEventListener('click', () => {
      const isTimelineVisible = !logContainer.classList.contains('hidden');
      const curTitleEl = document.getElementById('preview-timeline-title');
      const curContactIcon = document.getElementById('preview-toggle-icon-contact');
      const curTimelineIcon = document.getElementById('preview-toggle-icon-timeline');
      
      if (isTimelineVisible) {
        // Switch to contacts
        if (curTitleEl) curTitleEl.textContent = "Contacts";
        if (logContainer) logContainer.classList.add('hidden');
        if (contactsContainer) contactsContainer.classList.remove('hidden');
        if (curContactIcon) curContactIcon.classList.add('hidden');
        if (curTimelineIcon) curTimelineIcon.classList.remove('hidden');
      } else {
        // Switch to timeline
        if (curTitleEl) curTitleEl.textContent = "Timeline";
        if (logContainer) logContainer.classList.remove('hidden');
        if (contactsContainer) contactsContainer.classList.add('hidden');
        if (curContactIcon) curContactIcon.classList.remove('hidden');
        if (curTimelineIcon) curTimelineIcon.classList.add('hidden');
      }
    });
  }

  previewPage.classList.add('active');
  pushPageState('store-preview');
}

// Preload old shelf image blob from R2/sheet in background to prevent CORS and delay issues during share
async function preloadOldImgBlob(brand) {
  if (!brand.oldImg || brand.oldImgBlob) return;
  try {
    const res = await fetch(brand.oldImg);
    if (res.ok) {
      const blob = await res.blob();
      brand.oldImgBlob = blob;
      console.log(`Preloaded old shelf image for brand ${brand.displayName}`);
    }
  } catch (e) {
    console.warn(`Failed to preload old shelf image for ${brand.displayName}:`, e);
  }
}

// Open New Audit flow page
// Open New Audit flow page
function openNewAudit() {
  if (!selectedStore) return;
  currentAuditBrands = [];
  
  // Close Latest Audit page if open
  const latestAuditPage = document.getElementById('latest-audit-page');
  if (latestAuditPage) latestAuditPage.classList.remove('active');
  
  const notCarryCheckbox = document.getElementById('not-carry-checkbox');
  const addProductBtn = document.getElementById('add-product-btn');
  
  const statusVal = (selectedStore.Status || selectedStore.status || "").trim().toLowerCase();
  const isNotCarry = statusVal === 'not carry';
  
  if (notCarryCheckbox) {
    notCarryCheckbox.checked = isNotCarry;
  }
  if (addProductBtn) {
    addProductBtn.disabled = isNotCarry;
    if (isNotCarry) {
      addProductBtn.classList.add('disabled-btn');
    } else {
      addProductBtn.classList.remove('disabled-btn');
    }
  }
  
  const auditStoreName = document.getElementById('audit-store-name');
  const auditStoreRetailer = document.getElementById('audit-store-retailer');
  
  if (auditStoreName) {
    auditStoreName.textContent = selectedStore["Display Name"] || selectedStore.name || "";
  }
  if (auditStoreRetailer) {
    const retailerId = selectedStore["Retailers ID"] || selectedStore.retailer_id || "";
    const retailerName = retailerMap[retailerId.toString()] || retailerId || "N/A";
    auditStoreRetailer.textContent = retailerName;
  }

  // Populate from old visit data (latest visit) if status is not "Not Carry"
  if (!isNotCarry) {
    const storeIdStr = (selectedStore.ID || selectedStore.id || "").toString();
    const storeLogs = allAuditLogs.filter(l => (l['Retailer Stores ID'] || l['retailer_store_id'] || l['RetailerStoresID'] || "").toString() === storeIdStr);
    
    // Sort descending by timestamp
    storeLogs.sort((a, b) => {
      const dateA = parseTimestamp(a.Timestamp || a.timestamp);
      const dateB = parseTimestamp(b.Timestamp || b.timestamp);
      return dateB - dateA;
    });
    
    const latestLog = storeLogs[0];
    if (latestLog) {
      const auditJsonStr = latestLog['Audit JSON'] || latestLog['audit_json'] || '[]';
      try {
        const parsedAudit = JSON.parse(auditJsonStr);
        if (Array.isArray(parsedAudit)) {
          // Group products by brand
          const brandGroups = {};
          
          parsedAudit.forEach(item => {
            const sku = item.sku;
            const qty = parseInt(item.qty) || 0;
            
            // Find product details
            const product = allProducts.find(p => (p.SKU || p.sku) === sku);
            if (product) {
              const brandId = product['Brands ID'] || product.brand_id;
              const brand = allBrands.find(b => b.ID === brandId);
              if (brand) {
                if (!brandGroups[brandId]) {
                  brandGroups[brandId] = {
                    id: brandId,
                    displayName: brand['Display Name'] || brand.name || brandId,
                    products: []
                  };
                }
                brandGroups[brandId].products.push({
                  sku: sku,
                  name: product['Display Name'] || product.name || sku,
                  checked: true,
                  qty: qty
                });
              }
            }
          });
          
          // Convert to array and look up shelf images
          for (const brandId in brandGroups) {
            const group = brandGroups[brandId];
            
            // Search for latest shelf image link and remark for this brand in allShelfLogs
            let oldImg = null;
            let oldRemark = "";
            const matchLogs = allShelfLogs.filter(l => 
              (l['Retailer Stores ID'] || l['retailer_store_id'] || "").toString() === storeIdStr &&
              (l['Brands ID'] || l['brand_id'] || "").toString() === brandId
            );
            if (matchLogs.length > 0) {
              matchLogs.sort((a, b) => {
                const dateA = parseTimestamp(a.Timestamp || a.timestamp);
                const dateB = parseTimestamp(b.Timestamp || b.timestamp);
                return dateB - dateA;
              });
              oldImg = matchLogs[0]['Image Link'] || matchLogs[0].image_link || null;
              oldRemark = matchLogs[0]['Remark'] || matchLogs[0].remark || "";
            }
            
            currentAuditBrands.push({
              id: group.id,
              displayName: group.displayName,
              oldImg: oldImg,
              remark: "",
              newFile: null,
              newBase64: null,
              products: group.products
            });
          }
        }
      } catch (e) {
        console.error("Failed to parse last audit JSON:", e);
      }
    }
  }
  
  // Trigger background image preloading for WhatsApp sharing
  currentAuditBrands.forEach(preloadOldImgBlob);
  
  renderAuditBrandsList();
  
  const auditPage = document.getElementById('audit-page');
  if (auditPage) {
    auditPage.classList.add('active');
    pushPageState('audit');
  }
}

// Render selected brands and products list
// Render selected brands and products list
function renderAuditBrandsList() {
  const auditBrandsList = document.getElementById('audit-brands-list');
  const auditEmptyState = document.getElementById('audit-empty-state');
  const notCarryCheckbox = document.getElementById('not-carry-checkbox');
  
  if (!auditBrandsList) return;
  auditBrandsList.innerHTML = '';
  
  if (currentAuditBrands.length === 0) {
    if (auditEmptyState) auditEmptyState.classList.remove('hidden');
  } else {
    if (auditEmptyState) {
      auditEmptyState.classList.add('hidden');
      if (notCarryCheckbox) notCarryCheckbox.checked = false;
    }
    
    currentAuditBrands.forEach(brand => {
      const card = document.createElement('div');
      card.className = 'brand-audit-card';
      
      // Image preview source
      let imgPreviewSrc = '';
      if (brand.newBase64) {
        imgPreviewSrc = brand.newBase64;
      } else if (brand.oldImg) {
        imgPreviewSrc = brand.oldImg;
      }
      
      let shelfImageHtml = '';
      if (imgPreviewSrc) {
        shelfImageHtml = `
          <div class="shelf-image-container has-image">
            <img src="${imgPreviewSrc}" class="shelf-image-preview-45" alt="Shelf Preview">
            <label class="shelf-replace-overlay-btn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px;margin-right:4px;"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
              <span>Replace Picture</span>
              <input type="file" class="shelf-file-input" accept="image/*" capture="environment" data-id="${brand.id}">
            </label>
          </div>
        `;
      } else {
        shelfImageHtml = `
          <div class="shelf-image-container no-image">
            <label class="shelf-snap-btn-container">
              <div class="shelf-snap-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="snap-camera-icon"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                <span>Upload Image</span>
              </div>
              <input type="file" class="shelf-file-input" accept="image/*" capture="environment" data-id="${brand.id}">
            </label>
          </div>
        `;
      }
      
      // Build products list HTML
      let productsHtml = '';
      brand.products.forEach((prod, pIdx) => {
        productsHtml += `
          <div class="product-audit-row" data-sku="${prod.sku}">
            <div class="product-audit-left">
              <button class="product-delete-btn" data-brand-id="${brand.id}" data-idx="${pIdx}" title="Remove Product" style="background:none;border:none;color:#EF4444;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:4px;margin-right:4px;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px;">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
              <span class="product-audit-name" title="${prod.name}">${prod.name}</span>
            </div>
            <div class="qty-adjuster">
              <button class="qty-btn qty-minus" data-brand-id="${brand.id}" data-idx="${pIdx}">-</button>
              <input type="text" inputmode="numeric" pattern="[0-9]*" class="qty-input" data-brand-id="${brand.id}" data-idx="${pIdx}" value="${prod.qty}">
              <button class="qty-btn qty-plus" data-brand-id="${brand.id}" data-idx="${pIdx}">+</button>
            </div>
          </div>
        `;
      });
      
      card.innerHTML = `
        <div class="brand-audit-header">
          <span class="brand-audit-title">${brand.displayName}</span>
          <button class="brand-delete-btn" data-id="${brand.id}" title="Remove Brand">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
        </div>
        
        ${shelfImageHtml}
        
        <div class="brand-audit-products">
          ${productsHtml}
        </div>

        <div class="brand-audit-remark" style="margin-top: 12px; padding-top: 12px; border-top: 1px dashed #E2E8F0;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <label style="display: block; font-size: 11px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; margin: 0;">Brand Remark (Mandatory)</label>
            <button type="button" class="clear-remark-btn" data-id="${brand.id}" style="background: none; border: none; color: #EF4444; font-size: 11px; font-weight: 600; cursor: pointer; padding: 2px 6px; border-radius: 4px; transition: background 0.2s;" onmouseover="this.style.background='#FEE2E2'" onmouseout="this.style.background='none'">Clear</button>
          </div>
          <textarea class="brand-remark-input" data-id="${brand.id}" placeholder="Enter remark for ${brand.displayName} here..." rows="2" style="width: 100%; font-size: 12px; padding: 8px; border: 1px solid #CBD5E1; border-radius: 6px; box-sizing: border-box; outline: none; resize: none; font-family: inherit;">${brand.remark || ''}</textarea>
          <div class="remark-badges-container" style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;">
            <span class="remark-badge" data-id="${brand.id}" data-text="Stock Semua Okey" style="cursor: pointer; font-size: 11px; padding: 4px 8px; background: #F1F5F9; color: #475569; border-radius: 4px; border: 1px solid #E2E8F0; transition: all 0.2s;" onmouseover="this.style.background='#E2E8F0'; this.style.color='#1E293B'" onmouseout="this.style.background='#F1F5F9'; this.style.color='#475569'">Stock Semua Okey</span>
            <span class="remark-badge" data-id="${brand.id}" data-text="Dah submit order baru" style="cursor: pointer; font-size: 11px; padding: 4px 8px; background: #F1F5F9; color: #475569; border-radius: 4px; border: 1px solid #E2E8F0; transition: all 0.2s;" onmouseover="this.style.background='#E2E8F0'; this.style.color='#1E293B'" onmouseout="this.style.background='#F1F5F9'; this.style.color='#475569'">Dah submit order baru</span>
            <span class="remark-badge" data-id="${brand.id}" data-text="1 item Out of Stock" style="cursor: pointer; font-size: 11px; padding: 4px 8px; background: #F1F5F9; color: #475569; border-radius: 4px; border: 1px solid #E2E8F0; transition: all 0.2s;" onmouseover="this.style.background='#E2E8F0'; this.style.color='#1E293B'" onmouseout="this.style.background='#F1F5F9'; this.style.color='#475569'">1 item Out of Stock</span>
            <span class="remark-badge" data-id="${brand.id}" data-text="store nak return product" style="cursor: pointer; font-size: 11px; padding: 4px 8px; background: #F1F5F9; color: #475569; border-radius: 4px; border: 1px solid #E2E8F0; transition: all 0.2s;" onmouseover="this.style.background='#E2E8F0'; this.style.color='#1E293B'" onmouseout="this.style.background='#F1F5F9'; this.style.color='#475569'">store nak return product</span>
            <span class="remark-badge" data-id="${brand.id}" data-text="Dah adjust rak eye level" style="cursor: pointer; font-size: 11px; padding: 4px 8px; background: #F1F5F9; color: #475569; border-radius: 4px; border: 1px solid #E2E8F0; transition: all 0.2s;" onmouseover="this.style.background='#E2E8F0'; this.style.color='#1E293B'" onmouseout="this.style.background='#F1F5F9'; this.style.color='#475569'">Dah adjust rak eye level</span>
          </div>
        </div>
      `;
      
      auditBrandsList.appendChild(card);
    });
    
    // Bind Delete Brand handlers
    auditBrandsList.querySelectorAll('.brand-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const brandId = btn.getAttribute('data-id');
        removeBrandFromAudit(brandId);
      });
    });
    
    // Bind Image Upload handlers
    auditBrandsList.querySelectorAll('.shelf-file-input').forEach(input => {
      input.addEventListener('change', (e) => {
        const brandId = input.getAttribute('data-id');
        handleShelfImageUpload(e, brandId);
      });
    });

    // Bind Product Delete button handlers
    auditBrandsList.querySelectorAll('.product-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const brandId = btn.getAttribute('data-brand-id');
        const idx = parseInt(btn.getAttribute('data-idx'));
        const brand = currentAuditBrands.find(b => b.id === brandId);
        if (brand && brand.products[idx]) {
          brand.products.splice(idx, 1);
          // If no products left, remove the brand card entirely
          if (brand.products.length === 0) {
            currentAuditBrands = currentAuditBrands.filter(b => b.id !== brandId);
          }
          renderAuditBrandsList();
        }
      });
    });
    
    // Bind Qty adjusters
    auditBrandsList.querySelectorAll('.qty-minus').forEach(btn => {
      btn.addEventListener('click', () => {
        const brandId = btn.getAttribute('data-brand-id');
        const idx = parseInt(btn.getAttribute('data-idx'));
        const brand = currentAuditBrands.find(b => b.id === brandId);
        if (brand && brand.products[idx]) {
          if (brand.products[idx].qty > 0) {
            brand.products[idx].qty--;
            renderAuditBrandsList();
          }
        }
      });
    });
    
    auditBrandsList.querySelectorAll('.qty-plus').forEach(btn => {
      btn.addEventListener('click', () => {
        const brandId = btn.getAttribute('data-brand-id');
        const idx = parseInt(btn.getAttribute('data-idx'));
        const brand = currentAuditBrands.find(b => b.id === brandId);
        if (brand && brand.products[idx]) {
          brand.products[idx].qty++;
          renderAuditBrandsList();
        }
      });
    });

    // Bind Qty inputs directly for keyboard typing and scroll-into-view
    auditBrandsList.querySelectorAll('.qty-input').forEach(input => {
      input.addEventListener('input', (e) => {
        // Restrict to digits only
        let val = e.target.value.replace(/[^0-9]/g, '');
        e.target.value = val;
        
        const brandId = input.getAttribute('data-brand-id');
        const idx = parseInt(input.getAttribute('data-idx'));
        const brand = currentAuditBrands.find(b => b.id === brandId);
        if (brand && brand.products[idx]) {
          brand.products[idx].qty = parseInt(val) || 0;
        }
      });
      
      input.addEventListener('focus', () => {
        setTimeout(() => {
          input.select();
          input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
      });
      
      input.addEventListener('blur', (e) => {
        if (!e.target.value.trim()) {
          e.target.value = '0';
          const brandId = input.getAttribute('data-brand-id');
          const idx = parseInt(input.getAttribute('data-idx'));
          const brand = currentAuditBrands.find(b => b.id === brandId);
          if (brand && brand.products[idx]) {
            brand.products[idx].qty = 0;
          }
        }
      });
    });

    // Bind Brand Remark inputs
    auditBrandsList.querySelectorAll('.brand-remark-input').forEach(textarea => {
      textarea.addEventListener('input', () => {
        const brandId = textarea.getAttribute('data-id');
        const brand = currentAuditBrands.find(b => b.id === brandId);
        if (brand) {
          brand.remark = textarea.value;
        }
      });
      textarea.addEventListener('focus', () => {
        setTimeout(() => {
          textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
      });
    });

    // Bind Clear Remark buttons
    auditBrandsList.querySelectorAll('.clear-remark-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const brandId = btn.getAttribute('data-id');
        const textarea = auditBrandsList.querySelector(`.brand-remark-input[data-id="${brandId}"]`);
        if (textarea) {
          textarea.value = '';
          textarea.dispatchEvent(new Event('input'));
          textarea.focus();
        }
      });
    });

    // Bind Brand Remark pre-text badges
    auditBrandsList.querySelectorAll('.remark-badge').forEach(badge => {
      badge.addEventListener('click', () => {
        const brandId = badge.getAttribute('data-id');
        const text = badge.getAttribute('data-text');
        const textarea = auditBrandsList.querySelector(`.brand-remark-input[data-id="${brandId}"]`);
        if (textarea) {
          if (textarea.value.trim() === '') {
            textarea.value = text;
          } else {
            textarea.value = textarea.value.trim() + ', ' + text;
          }
          textarea.dispatchEvent(new Event('input'));
        }
      });
    });
  }
}

// Remove brand card from audit list
function removeBrandFromAudit(brandId) {
  currentAuditBrands = currentAuditBrands.filter(b => b.id !== brandId);
  renderAuditBrandsList();
}

// Compress and resize image client-side before upload
function compressImage(file, maxWidth, maxHeight, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Resize if width or height exceeds maximums
        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Convert canvas back to blob
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('Canvas compression returned empty blob'));
            return;
          }
          const ext = file.name.split('.').pop() || 'jpg';
          const name = file.name || 'image.jpg';
          const compressedFile = new File([blob], name, {
            type: 'image/jpeg',
            lastModified: Date.now()
          });
          const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
          resolve({
            base64: compressedBase64,
            file: compressedFile
          });
        }, 'image/jpeg', quality);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}

// Handle file input for brand card (with compression & resize)
async function handleShelfImageUpload(e, brandId) {
  const file = e.target.files[0];
  if (!file) return;
  
  const brand = currentAuditBrands.find(b => b.id === brandId);
  if (!brand) return;
  
  showToast("Processing and compressing photo...", "info");
  
  try {
    // Resize image to max 1600x1600 resolution and 80% JPEG quality
    // This results in files typically around 200KB - 400KB (perfectly in the user's ideal 500KB range)
    const result = await compressImage(file, 1600, 1600, 0.80);
    brand.newBase64 = result.base64;
    brand.newFile = result.file;
    renderAuditBrandsList();
    showToast("Photo processed successfully!", "success");
  } catch (error) {
    console.error("Image compression failed, using original file:", error);
    showToast("Failed to compress image. Using original photo.", "warning");
    
    // Fallback: Use original file directly
    const reader = new FileReader();
    reader.onload = (event) => {
      brand.newBase64 = event.target.result;
      brand.newFile = file;
      renderAuditBrandsList();
    };
    reader.readAsDataURL(file);
  }
}

// Handle "This store not carry our products." toggle
function toggleNotCarryCheckbox() {
  const chk = document.getElementById('not-carry-checkbox');
  const addProductBtn = document.getElementById('add-product-btn');
  if (chk) {
    if (chk.checked) {
      currentAuditBrands = [];
      renderAuditBrandsList();
      if (addProductBtn) {
        addProductBtn.disabled = true;
        addProductBtn.classList.add('disabled-btn');
      }
    } else {
      if (addProductBtn) {
        addProductBtn.disabled = false;
        addProductBtn.classList.remove('disabled-btn');
      }
    }
  }
}

// Open Brand selector bottom drawer
let currentSelectedBrandId = null;

function openBrandSelectDrawer() {
  const drawer = document.getElementById('brand-select-drawer');
  const overlay = document.getElementById('brand-select-overlay');
  
  if (!drawer || !overlay) return;
  
  showDrawerStepBrand();
  
  // Render Brands List inside Step 1
  const brandGrid = document.getElementById('brand-selection-grid');
  if (brandGrid) {
    brandGrid.innerHTML = '';
    // Show all brands so that the user can select an already-added brand to add more products
    const availableBrands = allBrands;
    
    if (availableBrands.length === 0) {
      brandGrid.innerHTML = `
        <div style="grid-column: span 2; text-align: center; padding: 20px 0; color: var(--text-muted); font-size: 13px; font-weight: 500;">
          No brands found in database.
        </div>
      `;
    } else {
      availableBrands.forEach(brand => {
        const card = document.createElement('div');
        card.className = 'brand-select-card';
        card.textContent = brand["Display Name"] || brand.name || brand.ID;
        card.addEventListener('click', () => {
          selectBrandInDrawer(brand.ID, brand["Display Name"] || brand.name || brand.ID);
        });
        brandGrid.appendChild(card);
      });
    }
  }
  
  drawer.classList.add('active');
  overlay.classList.add('active');
}

function closeBrandSelectDrawer() {
  const drawer = document.getElementById('brand-select-drawer');
  const overlay = document.getElementById('brand-select-overlay');
  if (drawer) drawer.classList.remove('active');
  if (overlay) overlay.classList.remove('active');
}

function showDrawerStepBrand() {
  document.getElementById('drawer-step-brand').classList.remove('hidden');
  document.getElementById('drawer-step-products').classList.add('hidden');
  currentSelectedBrandId = null;
}

function selectBrandInDrawer(brandId, brandName) {
  currentSelectedBrandId = brandId;
  const stepBrand = document.getElementById('drawer-step-brand');
  const stepProducts = document.getElementById('drawer-step-products');
  const label = document.getElementById('selected-brand-label');
  const prodList = document.getElementById('product-selection-list');
  
  if (!stepBrand || !stepProducts || !label || !prodList) return;
  
  label.textContent = brandName;
  
  // Find products currently on the card for this brand
  const existingBrand = currentAuditBrands.find(b => b.id === brandId);
  const existingSkus = existingBrand ? existingBrand.products.map(p => p.sku) : [];
  
  // Render products for this brand
  prodList.innerHTML = '';
  const brandProducts = allProducts.filter(p => (p["Brands ID"] || p.brand_id) === brandId);
  
  if (brandProducts.length === 0) {
    prodList.innerHTML = `
      <div style="text-align: center; padding: 20px 0; color: var(--text-muted); font-size: 13px; font-weight: 500;">
        No products found under this brand.
      </div>
    `;
  } else {
    brandProducts.forEach(prod => {
      const isChecked = existingSkus.includes(prod.SKU || prod.sku);
      const row = document.createElement('div');
      row.className = 'product-select-row';
      row.innerHTML = `
        <input type="checkbox" class="drawer-prod-checkbox" data-sku="${prod.SKU || prod.sku}" ${isChecked ? 'checked' : ''}>
        <span class="product-select-name">${prod["Display Name"] || prod.name || prod.SKU}</span>
      `;
      row.addEventListener('click', (e) => {
        if (e.target.tagName !== 'INPUT') {
          const chk = row.querySelector('input');
          if (chk) chk.checked = !chk.checked;
        }
      });
      prodList.appendChild(row);
    });
  }
  
  stepBrand.classList.add('hidden');
  stepProducts.classList.remove('hidden');
}

// Insert selected brand and products from selector drawer into audit state
function insertProductsFromDrawer() {
  if (!currentSelectedBrandId) return;
  
  const checkboxes = document.querySelectorAll('.drawer-prod-checkbox:checked');
  if (checkboxes.length === 0) {
    // If they deselect all products in the drawer, remove the brand card entirely
    const existingBrandIndex = currentAuditBrands.findIndex(b => b.id === currentSelectedBrandId);
    if (existingBrandIndex !== -1) {
      currentAuditBrands.splice(existingBrandIndex, 1);
      closeBrandSelectDrawer();
      renderAuditBrandsList();
      return;
    }
    showToast("Please select at least one product to insert.", "error");
    return;
  }
  
  const brand = allBrands.find(b => b.ID === currentSelectedBrandId);
  if (!brand) return;
  
  const brandName = brand["Display Name"] || brand.name || brand.ID;
  
  // Get checked SKUs and their product names
  const selectedProducts = [];
  checkboxes.forEach(chk => {
    const sku = chk.getAttribute('data-sku');
    const pInfo = allProducts.find(p => (p.SKU || p.sku) === sku);
    selectedProducts.push({
      sku: sku,
      name: pInfo ? (pInfo["Display Name"] || pInfo.name) : sku
    });
  });
  
  // Check if brand already exists in currentAuditBrands
  const existingBrand = currentAuditBrands.find(b => b.id === currentSelectedBrandId);
  
  if (existingBrand) {
    // Update existing brand card products
    const newProductsList = [];
    
    selectedProducts.forEach(selProd => {
      // If it already existed on the card, preserve its quantity
      const match = existingBrand.products.find(ep => ep.sku === selProd.sku);
      const qty = match ? match.qty : 0;
      
      newProductsList.push({
        sku: selProd.sku,
        name: selProd.name,
        qty: qty
      });
    });
    
    existingBrand.products = newProductsList;
  } else {
    // Create new brand card
    // Search for old shelf image link and remark for this store and brand in allShelfLogs
    let oldImg = null;
    let oldRemark = "";
    if (selectedStore) {
      const storeIdStr = (selectedStore.ID || selectedStore.id || "").toString();
      const matchLogs = allShelfLogs.filter(l => 
        (l['Retailer Stores ID'] || l['retailer_store_id'] || "").toString() === storeIdStr &&
        (l['Brands ID'] || l['brand_id'] || "").toString() === currentSelectedBrandId
      );
      if (matchLogs.length > 0) {
        matchLogs.sort((a, b) => parseTimestamp(b.Timestamp || b.timestamp) - parseTimestamp(a.Timestamp || a.timestamp));
        oldImg = matchLogs[0]['Image Link'] || matchLogs[0].image_link || null;
        oldRemark = matchLogs[0]['Remark'] || matchLogs[0].remark || "";
      }
    }
    
    const products = selectedProducts.map(p => ({
      sku: p.sku,
      name: p.name,
      qty: 0
    }));
    
    const newBrand = {
      id: currentSelectedBrandId,
      displayName: brandName,
      oldImg: oldImg,
      remark: "",
      newFile: null,
      newBase64: null,
      products: products
    };
    currentAuditBrands.push(newBrand);
    preloadOldImgBlob(newBrand);
  }
  
  closeBrandSelectDrawer();
  renderAuditBrandsList();
}

// Next button validations
function clearAuditPin() {
  const auditPinInput = document.getElementById('audit-pin-input');
  if (auditPinInput) {
    auditPinInput.value = '';
    auditPinInput.classList.remove('error');
  }
  const digitInputs = document.querySelectorAll('.pin-digit-input');
  digitInputs.forEach(input => {
    input.value = '';
    input.classList.remove('error');
  });
  if (digitInputs[0]) {
    setTimeout(() => {
      digitInputs[0].focus();
    }, 200);
  }
}

function validateAndGoToRemark() {
  const notCarryCheckbox = document.getElementById('not-carry-checkbox');
  
  if (currentAuditBrands.length === 0) {
    if (!notCarryCheckbox || !notCarryCheckbox.checked) {
      showToast("Please add products or select 'This store not carry our products' to proceed.", "error");
      return;
    }
  } else {
    // Validate shelf images and remarks are present for all brands
    for (let i = 0; i < currentAuditBrands.length; i++) {
      const brand = currentAuditBrands[i];
      if (!brand.oldImg && !brand.newBase64) {
        showToast(`Please upload/replace a shelf image for ${brand.displayName}. Shelf images are mandatory.`, "error");
        return;
      }
      if (!brand.remark || !brand.remark.trim()) {
        showToast(`Please enter a remark for ${brand.displayName}. Remarks are mandatory.`, "error");
        return;
      }
    }
  }
  
  currentRemarkMode = 'audit';
  const remarkHeaderTitle = document.querySelector('#remark-page .preview-header-title');
  if (remarkHeaderTitle) remarkHeaderTitle.textContent = "Authentication";
  
  const auditSubmitBtn = document.getElementById('audit-submit-btn');
  if (auditSubmitBtn) auditSubmitBtn.textContent = "Submit Audit";
  
  // Conditionally hide remark input container for audits
  const remarkGroup = document.getElementById('audit-remark-group');
  if (remarkGroup) remarkGroup.classList.add('hidden');
  
  // Initialize remark inputs
  const remarkInput = document.getElementById('audit-remark-input');
  if (remarkInput) remarkInput.value = '';
  clearAuditPin();
  
  const remarkPage = document.getElementById('remark-page');
  if (remarkPage) {
    remarkPage.classList.add('active');
    pushPageState('remark');
  }
}

// Resilient background write with retries
async function writeWithRetry(payload, retries = 3, delay = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${WORKER_URL}/api/app1/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const result = await res.json();
        return result;
      }
      throw new Error(`Write failed with status ${res.status}`);
    } catch (e) {
      console.warn(`Attempt ${i + 1} failed: ${e.message}. Retrying...`);
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// Final Submit
async function submitAudit() {
  const pinInput = document.getElementById('audit-pin-input');
  
  if (!pinInput || !pinInput.value.trim() || pinInput.value.length < 4) {
    showToast("Please enter a 4-digit PIN.", "error");
    return;
  }
  
  const notCarryCheckbox = document.getElementById('not-carry-checkbox');
  const isNotCarry = notCarryCheckbox && notCarryCheckbox.checked;
  const remark = isNotCarry ? "Not Carry" : currentAuditBrands.map(b => `${b.displayName}: ${(b.remark || "").trim()}`).join(" | ");
  
  const enteredPin = parseInt(pinInput.value.trim());
  
  // Verify PIN against allUsers (Merch_Users)
  const matchedUser = allUsers.find(u => parseInt(u.PIN || u.pin) === enteredPin);
  if (!matchedUser) {
    const digitInputs = document.querySelectorAll('.pin-digit-input');
    digitInputs.forEach(input => input.classList.add('error'));
    showToast("Incorrect PIN. Please enter a valid merchandiser PIN.", "error");
    setTimeout(() => {
      digitInputs.forEach(input => input.classList.remove('error'));
      clearAuditPin();
    }, 300);
    return;
  }
  
  const merchId = (matchedUser.ID || matchedUser.id || "Unknown").toString().trim();
  const storeIdStr = (selectedStore.ID || selectedStore.id || "").toString().trim();
  
  // Find matching Visit task for this store and update it locally
  const storeIdStrTrim = storeIdStr.trim();
  const matchingTask = allTasks.find(t => {
    const taskStoreId = (t['Stores ID'] || t['stores id'] || t['StoresID'] || "").toString().trim();
    const taskAction = (t['Task Action'] || t['task action'] || t['TaskAction'] || "").toString().trim().toLowerCase();
    
    // Check if the store ID matches and the action is 'visit'
    if (taskStoreId !== storeIdStrTrim || taskAction !== 'visit') return false;
    
    // Check if it is not already completed
    const logVal = t['Task Log'] || t['task log'] || t['TaskLog'] || '[]';
    try {
      const logs = JSON.parse(logVal);
      if (Array.isArray(logs)) {
        return !logs.some(log => {
          const action = log['Action'] || log['action'] || '';
          return String(action).trim().toLowerCase() === 'visited';
        });
      }
    } catch (e) {}
    return true;
  });

  let taskLogs = [];
  if (matchingTask) {
    const logVal = matchingTask['Task Log'] || matchingTask['task log'] || matchingTask['TaskLog'] || '[]';
    try {
      taskLogs = JSON.parse(logVal);
      if (!Array.isArray(taskLogs)) {
        taskLogs = [];
      }
    } catch (e) {
      taskLogs = [];
    }
    
    const merchName = matchedUser.Name || matchedUser.name || "Merch Name";
    taskLogs.push({
      "Action": "Visited",
      "Remark": remark,
      "Action by": merchName,
      "Timestamp": Date.now()
    });
    
    const taskLogString = JSON.stringify(taskLogs);
    matchingTask['Task Log'] = taskLogString;
    if (matchingTask['task log']) matchingTask['task log'] = taskLogString;
    if (matchingTask['TaskLog']) matchingTask['TaskLog'] = taskLogString;
    
    matchingTask['Task Action'] = "Call";
    if (matchingTask['task action']) matchingTask['task action'] = "Call";
    if (matchingTask['TaskAction']) matchingTask['TaskAction'] = "Call";
    
    localStorage.setItem('merch_tasks', JSON.stringify(allTasks));
    processTasksData(allTasks);
  }
  
  // Locally update status instantly
  const newStatus = isNotCarry ? 'Not Carry' : 'Carry';
  
  selectedStore.Status = newStatus;
  
  // Save locally in allStores
  localStorage.setItem('merch_stores', JSON.stringify(allStores));
  
  // Collect audited SKU quantities
  const auditedSkus = [];
  if (!isNotCarry) {
    currentAuditBrands.forEach(b => {
      b.products.forEach(p => {
        auditedSkus.push({ sku: p.sku, qty: parseInt(p.qty) || 0 });
      });
    });
  }
  
  // Save the new audit log locally immediately so it registers as visited instantly
  const newAuditLog = {
    "Timestamp": Date.now(),
    "Merch ID": merchId,
    "Retailer Stores ID": storeIdStr,
    "Remark": remark,
    "Audit JSON": JSON.stringify(auditedSkus)
  };
  
  allAuditLogs.push(newAuditLog);
  localStorage.setItem('merch_audit_logs', JSON.stringify(allAuditLogs));
  
  // Push new shelf logs locally immediately using local base64/existing URLs for instant sharing
  if (!isNotCarry) {
    const now = Date.now();
    currentAuditBrands.forEach(brand => {
      const imgData = brand.newBase64 || brand.oldImg || "";
      if (imgData) {
        allShelfLogs.push({
          "Timestamp": now,
          "Merch ID": merchId,
          "Retailer Stores ID": storeIdStr,
          "Brands ID": brand.id,
          "Image Link": imgData,
          "Remark": (brand.remark || "").trim()
        });
      }
    });
    localStorage.setItem('merch_shelf_logs', JSON.stringify(allShelfLogs));
  }
  
  // Update view silently
  updateStoreCount();
  renderStoresList();

  // Close all screens immediately
  closeAllSubpages();
  // No navigation needed, user remains on the previous page
  
  showToast("Audit submitted! Syncing in background.", "success");
  
  const submitTime = Date.now();
  const productAuditDateStr = formatDateYYYYMMDD(submitTime);
  const productAuditId = `${productAuditDateStr}_${merchId}_${storeIdStr}`;
  const taskCreatedDate = matchingTask ? (matchingTask['Created Date'] || matchingTask.CreatedDate) : null;

  // Build queue payload
  const auditPayload = {
    storeId: storeIdStr,
    status: newStatus,
    auditDateStr: productAuditDateStr,
    auditId: productAuditId,
    merchId: merchId,
    remark: remark,
    auditedSkus: auditedSkus,
    taskId: matchingTask ? matchingTask.ID || matchingTask.id || taskCreatedDate : null,
    taskCreatedDate: taskCreatedDate,
    taskLogs: taskLogs,
    shelfLogs: currentAuditBrands.map(brand => ({
      id: brand.id,
      displayName: brand.displayName,
      base64: brand.newBase64 || '',
      imgUrl: brand.oldImg || '',
      remark: (brand.remark || "").trim()
    }))
  };

  const queueItem = {
    id: 'audit_' + submitTime + '_' + Math.random().toString(36).substring(2, 7),
    type: 'audit',
    storeName: selectedStore["Display Name"] || selectedStore.name || `Store #${storeIdStr}`,
    timestamp: submitTime,
    payload: auditPayload,
    error: 'Pending sync...'
  };

  failedSyncs.push(queueItem);
  localStorage.setItem('merch_failed_syncs', JSON.stringify(failedSyncs));
  updateSyncUI();

  // Silent background sync
  (async () => {
    try {
      const shelfUpdates = [];
      
      // 1. Upload new shelf images to R2
      for (const brand of auditPayload.shelfLogs) {
        let finalUrl = brand.imgUrl || '';
        if (brand.base64 && brand.base64.startsWith('data:')) {
          const blob = base64ToBlob(brand.base64);
          if (blob) {
            const fileName = `shelf_${storeIdStr}_${brand.id}_${Date.now()}.jpg`;
            let uploadUrl = `${WORKER_URL}/api/upload?filename=${encodeURIComponent(fileName)}`;
            if (brand.imgUrl) {
              uploadUrl += `&deleteUrl=${encodeURIComponent(brand.imgUrl)}`;
            }
            
            const uploadRes = await fetch(uploadUrl, {
              method: 'POST',
              headers: { 'Content-Type': blob.type || 'image/jpeg' },
              body: blob
            });
            
            if (uploadRes.ok) {
              const uploadData = await uploadRes.json();
              if (uploadData.success) {
                finalUrl = uploadData.url;
                brand.imgUrl = finalUrl;
                
                const cachedShelfLog = allShelfLogs.find(sl => sl.Timestamp === queueItem.timestamp && sl["Brands ID"] === brand.id);
                if (cachedShelfLog) {
                  cachedShelfLog["Image Link"] = finalUrl;
                }
              }
            }
          }
        }
        
        shelfUpdates.push({
          id: brand.id,
          imgUrl: finalUrl,
          remark: brand.remark
        });
      }
      
      // Write A: Update store status in Store_Retailer_DB
      await writeWithRetry({
        sheet: "Store_Retailer_DB",
        action: "update",
        data: {
          "ID": storeIdStr,
          "Status": newStatus
        }
      });
      
      // Write B: Insert audit logs to Merch_Visit_Product_Audit_Logs (for both Carry and Not Carry)
      await writeWithRetry({
        sheet: "Merch_Visit_Product_Audit_Logs",
        action: "upsert",
        data: {
          "ID": productAuditId,
          "Timestamp": submitTime,
          "Merch ID": merchId,
          "Retailer Stores ID": storeIdStr,
          "Remark": remark,
          "Audit JSON": JSON.stringify(auditedSkus)
        }
      });
      
      // Write C: Insert shelf images to Merch_Visit_Shelf_Audit_Logs (if Carry)
      if (!isNotCarry) {
        for (const brand of shelfUpdates) {
          const shelfAuditId = `${productAuditDateStr}_${merchId}_${storeIdStr}_${brand.id}`;

          await writeWithRetry({
            sheet: "Merch_Visit_Shelf_Audit_Logs",
            action: "upsert",
            data: {
              "ID": shelfAuditId,
              "Timestamp": submitTime,
              "Merch ID": merchId,
              "Retailer Stores ID": storeIdStr,
              "Brands ID": brand.id,
              "Image Link": brand.imgUrl,
              "Remark": brand.remark
            }
          });
        }
      }
      
      // Write D: Update task log in Stores_Task_Assigned to mark visited
      if (matchingTask) {
        await writeWithRetry({
          sheet: "Stores_Task_Assigned",
          action: "update",
          data: {
            "Created Date": taskCreatedDate,
            "Task Action": "Call",
            "Task Log": JSON.stringify(taskLogs)
          }
        });
      }
      
      // Success! Remove from sync queue
      failedSyncs = failedSyncs.filter(q => q.id !== queueItem.id);
      localStorage.setItem('merch_failed_syncs', JSON.stringify(failedSyncs));
      localStorage.setItem('merch_shelf_logs', JSON.stringify(allShelfLogs));
      updateSyncUI();
      
      console.log("Silent background submission finished successfully.");
      fetchDataSilently();
    } catch (e) {
      console.error("Background sync failed after retries:", e);
      queueItem.error = e.message || 'Background sync failed';
      localStorage.setItem('merch_failed_syncs', JSON.stringify(failedSyncs));
      updateSyncUI();
    }
  })();
}

function openLatestAudit() {
  if (!selectedStore) return;
  
  const latestAuditPage = document.getElementById('latest-audit-page');
  if (!latestAuditPage) return;
  
  const storeIdStr = (selectedStore.ID || selectedStore.id || "").toString();
  const storeName = selectedStore["Display Name"] || selectedStore.name || "";
  const retailerId = selectedStore["Retailers ID"] || selectedStore.retailer_id || "";
  const retailerName = retailerMap[retailerId.toString()] || retailerId || "N/A";
  
  document.getElementById('latest-audit-store-name').textContent = storeName;
  document.getElementById('latest-audit-store-retailer').textContent = retailerName;
  
  const latestAuditBrandsList = document.getElementById('latest-audit-brands-list');
  if (latestAuditBrandsList) {
    latestAuditBrandsList.innerHTML = '';
    
    const storeLogs = allAuditLogs.filter(l => (l['Retailer Stores ID'] || l['retailer_store_id'] || l['RetailerStoresID'] || "").toString() === storeIdStr);
    
    storeLogs.sort((a, b) => {
      const dateA = parseTimestamp(a.Timestamp || a.timestamp);
      const dateB = parseTimestamp(b.Timestamp || b.timestamp);
      return dateB - dateA;
    });
    
    const latestLog = storeLogs[0];
    let hasProducts = false;
    
    if (latestLog) {
      const auditJsonStr = latestLog['Audit JSON'] || latestLog['audit_json'] || '[]';
      try {
        const parsedAudit = JSON.parse(auditJsonStr);
        if (Array.isArray(parsedAudit) && parsedAudit.length > 0) {
          hasProducts = true;
          const brandGroups = {};
          
          parsedAudit.forEach(item => {
            const sku = item.sku;
            const qty = parseInt(item.qty) || 0;
            
            const product = allProducts.find(p => (p.SKU || p.sku) === sku);
            if (product) {
              const brandId = product['Brands ID'] || product.brand_id;
              const brand = allBrands.find(b => b.ID === brandId);
              if (brand) {
                if (!brandGroups[brandId]) {
                  brandGroups[brandId] = {
                    id: brandId,
                    displayName: brand['Display Name'] || brand.name || brandId,
                    products: []
                  };
                }
                brandGroups[brandId].products.push({
                  sku: sku,
                  name: product['Display Name'] || product.name || sku,
                  qty: qty
                });
              }
            }
          });
          
          for (const brandId in brandGroups) {
            const group = brandGroups[brandId];
            
            let oldImg = null;
            const matchLogs = allShelfLogs.filter(l => 
              (l['Retailer Stores ID'] || l['retailer_store_id'] || "").toString() === storeIdStr &&
              (l['Brands ID'] || l['brand_id'] || "").toString() === brandId
            );
            if (matchLogs.length > 0) {
              matchLogs.sort((a, b) => parseTimestamp(b.Timestamp || b.timestamp) - parseTimestamp(a.Timestamp || a.timestamp));
              oldImg = matchLogs[0]['Image Link'] || matchLogs[0].image_link || null;
            }
            
            const card = document.createElement('div');
            card.className = 'brand-audit-card';
            
            let shelfImageHtml = '';
            if (oldImg) {
              shelfImageHtml = `
                <div class="shelf-image-container has-image">
                  <img src="${oldImg}" class="shelf-image-preview-45" alt="Shelf Preview">
                </div>
              `;
            } else {
              shelfImageHtml = `
                <div class="shelf-image-container no-image" style="background: #F1F5F9; border: 1px dashed #CBD5E1; height: 120px; display: flex; align-items: center; justify-content: center; color: #94A3B8;">
                  <span>No image uploaded</span>
                </div>
              `;
            }
            
            let productsHtml = '';
            group.products.forEach(prod => {
              productsHtml += `
                <div class="product-audit-row" style="padding: 6px 0; border-bottom: 1px solid #F1F5F9; display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 12px; color: var(--text-color);">${prod.name}</span>
                  <span style="font-size: 12px; font-weight: bold; color: var(--text-color); margin-right: 10px;">Qty: ${prod.qty}</span>
                </div>
              `;
            });
            
            card.innerHTML = `
              <div class="brand-audit-header" style="padding-bottom: 8px; border-bottom: 1px solid #E2E8F0; margin-bottom: 8px; font-weight: bold; font-size: 13px; color: var(--text-color);">
                ${group.displayName}
              </div>
              ${shelfImageHtml}
              <div class="brand-audit-products" style="margin-top: 10px;">
                ${productsHtml}
              </div>
            `;
            latestAuditBrandsList.appendChild(card);
          }
        }
      } catch (e) {
        console.error("Failed to parse last audit JSON:", e);
      }
    }
    
    if (!hasProducts) {
      latestAuditBrandsList.innerHTML = `
        <div style="text-align: center; padding: 40px 20px; color: var(--text-muted); font-size: 13px; font-weight: 500;">
          No previous audit data found for this store.
        </div>
      `;
    }
  }
  
  latestAuditPage.classList.add('active');
  pushPageState('latest-audit');
}

function populateDirectoryRetailers() {
  const select = document.getElementById('directory-retailer-select');
  if (!select) return;
  
  const currentSel = select.value;
  select.innerHTML = '<option value="All">All Retailers</option>';
  
  const retailerIds = new Set();
  allStores.forEach(s => {
    const retId = s["Retailers ID"] || s.retailer_id;
    if (retId) retailerIds.add(retId.toString().trim());
  });
  
  Array.from(retailerIds).sort().forEach(retId => {
    const name = retailerMap[retId] || retId;
    const opt = document.createElement('option');
    opt.value = retId;
    opt.textContent = name;
    select.appendChild(opt);
  });
  
  if (Array.from(select.options).some(o => o.value === currentSel)) {
    select.value = currentSel;
  }
}

function renderStoresDirectory() {
  populateDirectoryRetailers();
  
  const tbody = document.getElementById('directory-table-body');
  const footer = document.getElementById('directory-footer');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  let filtered = allStores;
  
  if (directorySelectedRetailer !== 'All') {
    filtered = filtered.filter(s => {
      const retId = (s["Retailers ID"] || s.retailer_id || "").toString().trim();
      return retId === directorySelectedRetailer;
    });
  }
  
  const query = directorySearchQuery.trim().toLowerCase();
  if (query) {
    const queryWords = query.split(/\s+/).filter(w => w.length > 0);
    if (queryWords.length > 0) {
      filtered = filtered.filter(store => {
        const storeName = (store["Display Name"] || store.name || "").toLowerCase();
        const address = (store.Address || store.address || "").toLowerCase();
        const storeIdVal = (store.ID || store.id || "").toString().toLowerCase();
        const retailerId = store["Retailers ID"] || store.retailer_id || "";
        const retailerName = (retailerMap[retailerId.toString()] || retailerId || "").toLowerCase();
        
        const storeText = `${storeIdVal} ${retailerName} ${storeName} ${address}`;
        return queryWords.every(word => storeText.includes(word));
      });
    }
  }
  
  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="2" style="text-align: center; padding: 20px; color: #94A3B8;">
          No stores match the criteria.
        </td>
      </tr>
    `;
    if (footer) footer.textContent = 'Total Results: 0';
    return;
  }
  
  filtered.forEach(store => {
    const storeName = store["Display Name"] || store.name || "Unknown Store";
    const storeIdStr = (store.ID || store.id || "").toString();
    const retailerId = store["Retailers ID"] || store.retailer_id || "";
    const retailerName = retailerMap[retailerId.toString()] || retailerId || "";
    const shortRetailer = retailerName.trim().substring(0, 5);
    const displayName = shortRetailer ? `${shortRetailer} - ${storeName}` : storeName;
    const locStr = store["Pin Locations"] || store.coords || store.Coords || store.location || store["Buyer Store Location"] || "";
    
    let navigateHtml = '';
    if (locStr) {
      const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(locStr.trim())}`;
      navigateHtml = `
        <a href="${googleMapsUrl}" target="_blank" class="dir-store-navigate-btn" title="Navigate with Google Maps" style="background: none; border: none; padding: 4px; cursor: pointer; color: var(--app-color); display: inline-flex; align-items: center; justify-content: center; vertical-align: middle; margin-right: 4px; text-decoration: none;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
            <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
          </svg>
        </a>
      `;
    }
    
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid #E2E8F0';
    
    tr.innerHTML = `
      <td style="padding: 8px 4px; color: #1E293B;">
        ${displayName}
      </td>
      <td style="padding: 8px 4px; text-align: right; white-space: nowrap;">
        ${navigateHtml}
        <button class="dir-store-info-btn" data-id="${storeIdStr}" style="background: none; border: none; padding: 4px; cursor: pointer; color: var(--app-color); vertical-align: middle;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  
  tbody.querySelectorAll('.dir-store-info-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const storeId = btn.getAttribute('data-id');
      openStorePreview(storeId);
    });
  });
  
  if (footer) {
    footer.textContent = `Total Results: ${filtered.length}`;
  }
}

// PO Request Functions
function initPoRequest() {
  const poStoreSearch = document.getElementById('po-store-search');
  const poSelectedStoreInfo = document.getElementById('po-selected-store-info');
  const pSelect = document.getElementById('po-product-select');
  
  if (!poStoreSearch) return;
  
  if (!selectedPoStoreId) {
    poStoreSearch.value = '';
    if (poSelectedStoreInfo) {
      poSelectedStoreInfo.textContent = '';
      poSelectedStoreInfo.style.display = 'none';
    }
    if (pSelect) {
      pSelect.innerHTML = '<option value="">Select a Product</option>';
    }
    const uomPackDisplay = document.getElementById('po-uom-pack-display');
    if (uomPackDisplay) uomPackDisplay.value = '';
    
    // Reset quantity options to default (EA range: 10 to 30)
    const qtySelect = document.getElementById('po-qty-select');
    if (qtySelect) {
      qtySelect.innerHTML = '';
      for (let i = 10; i <= 30; i++) {
        const opt = document.createElement('option');
        opt.value = i.toString();
        opt.textContent = i.toString();
        qtySelect.appendChild(opt);
      }
      qtySelect.value = '10';
    }
  } else {
    // Restore display of selected store
    const store = allStores.find(s => (s.ID || s.id || "").toString() === selectedPoStoreId.toString());
    if (store) {
      const storeName = store["Display Name"] || store.name || "";
      const retailerId = store["Retailers ID"] || store.retailer_id || "";
      const retailerName = retailerMap[retailerId.toString()] || retailerId || "";
      if (poSelectedStoreInfo) {
        poSelectedStoreInfo.textContent = `${retailerName} - ${storeName}`;
        poSelectedStoreInfo.style.display = 'block';
      }
      
      // Restore products
      if (pSelect) {
        const currentVal = pSelect.value;
        pSelect.innerHTML = '<option value="">Select a Product</option>';
        const filteredProducts = allRetailersSku.filter(p => {
          const pRetId = (p["Retailer ID"] || p.retailer_id || p.Retailer_ID || p["Retailers ID"] || "").toString().trim();
          return pRetId === retailerId.toString().trim();
        });
        filteredProducts.forEach(p => {
          const sku = p["SKU Number"] || p.SKU || p.sku || "";
          const name = p["SKU Name"] || p["Display Name"] || p.name || "";
          if (sku) {
            const opt = document.createElement('option');
            opt.value = sku;
            opt.textContent = name ? `${sku} - ${name}` : sku;
            pSelect.appendChild(opt);
          }
        });
        
        const qtySelect = document.getElementById('po-qty-select');
        if (currentVal && Array.from(pSelect.options).some(o => o.value === currentVal)) {
          pSelect.value = currentVal;
          
          // Restore UOM/Pack display
          const product = allRetailersSku.find(p => (p["SKU Number"] || p.SKU || p.sku || "").toString() === currentVal);
          const uom = product ? (product.UOM || product.uom || "EA") : "EA";
          const pack = product ? (product.PACK || product.pack || product.Pack || "1") : "";
          const uomPackDisplay = document.getElementById('po-uom-pack-display');
          if (uomPackDisplay) {
            uomPackDisplay.value = uom || pack ? `${uom} ${pack}`.trim() : "";
          }
          
          // Restore quantity options based on UOM
          if (qtySelect) {
            qtySelect.innerHTML = '';
            if (uom === 'CT') {
              for (let i = 1; i <= 5; i++) {
                const opt = document.createElement('option');
                opt.value = i.toString();
                opt.textContent = i.toString();
                qtySelect.appendChild(opt);
              }
              qtySelect.value = '1';
            } else {
              for (let i = 10; i <= 30; i++) {
                const opt = document.createElement('option');
                opt.value = i.toString();
                opt.textContent = i.toString();
                qtySelect.appendChild(opt);
              }
              qtySelect.value = '10';
            }
          }
        } else {
          const uomPackDisplay = document.getElementById('po-uom-pack-display');
          if (uomPackDisplay) uomPackDisplay.value = '';
          
          // Rebuild default qty options
          if (qtySelect) {
            qtySelect.innerHTML = '';
            for (let i = 10; i <= 30; i++) {
              const opt = document.createElement('option');
              opt.value = i.toString();
              opt.textContent = i.toString();
              qtySelect.appendChild(opt);
            }
            qtySelect.value = '10';
          }
        }
      }
    }
  }
  
  renderPoCart();
}

function renderPoCart() {
  const cartBody = document.getElementById('po-cart-body');
  if (!cartBody) return;
  
  if (poCart.length === 0) {
    cartBody.innerHTML = `
      <tr>
        <td colspan="3" style="text-align: center; padding: 16px; color: #94A3B8; font-weight: 500;">No items added to order yet.</td>
      </tr>
    `;
    return;
  }
  
  cartBody.innerHTML = poCart.map(item => `
    <tr style="border-bottom: 1px solid #E2E8F0;">
      <td style="padding: 10px 8px; color: #1E293B; font-weight: 600; line-height: 1.3;">
        <div>${item.sku}</div>
        <div style="font-size: 10px; color: #64748B; font-weight: 500; margin-top: 2px;">${item.name}</div>
      </td>
      <td style="padding: 10px 8px; text-align: right; font-weight: 700; color: #0F172A; white-space: nowrap;">
        ${item.uom} ${item.pack} x ${item.qty}
      </td>
      <td style="padding: 10px 8px; text-align: right; width: 32px;">
        <button class="po-remove-item-btn" data-id="${item.id}" style="background: none; border: none; color: #EF4444; cursor: pointer; padding: 4px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </td>
    </tr>
  `).join('');
  
  cartBody.querySelectorAll('.po-remove-item-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.getAttribute('data-id'));
      poCart = poCart.filter(item => item.id !== id);
      renderPoCart();
      showToast("Product removed from order.", "info");
    });
  });
}

function showPoAuthPage() {
  if (!selectedPoStoreId) {
    showToast("Please search and select a store.", "error");
    return;
  }
  if (poCart.length === 0) {
    showToast("Please add at least one product to the order.", "error");
    return;
  }
  
  const poAuthPage = document.getElementById('po-auth-page');
  if (poAuthPage) {
    poAuthPage.classList.add('active');
    pushPageState('po-auth');
  }
  
  // Clear all 4 digit inputs and focus the first one
  const poDigitInputs = document.querySelectorAll('.po-pin-digit-input');
  poDigitInputs.forEach(input => {
    input.value = '';
    input.classList.remove('error');
  });
  const poAuthPinInput = document.getElementById('po-auth-pin-input');
  if (poAuthPinInput) poAuthPinInput.value = '';
  
  if (poDigitInputs.length > 0) {
    setTimeout(() => poDigitInputs[0].focus(), 300);
  }
}

function verifyPoAuthPin() {
  const pinInput = document.getElementById('po-auth-pin-input');
  const poDigitInputs = document.querySelectorAll('.po-pin-digit-input');
  if (!pinInput) return;
  const enteredPin = parseInt(pinInput.value.trim());
  
  if (isNaN(enteredPin) || pinInput.value.trim().length < 4) {
    poDigitInputs.forEach(input => input.classList.add('error'));
    showToast("Please enter a 4-digit PIN.", "error");
    setTimeout(() => poDigitInputs.forEach(input => input.classList.remove('error')), 300);
    return;
  }
  
  const matchedUser = allUsers.find(u => parseInt(u.PIN || u.pin) === enteredPin);
  if (!matchedUser) {
    poDigitInputs.forEach(input => input.classList.add('error'));
    showToast("Incorrect PIN. Please try again.", "error");
    setTimeout(() => {
      poDigitInputs.forEach(input => {
        input.classList.remove('error');
        input.value = '';
      });
      pinInput.value = '';
      if (poDigitInputs.length > 0) poDigitInputs[0].focus();
    }, 300);
    return;
  }
  
  // Close the full-height page
  closeAllSubpages();
  
  const merchId = (matchedUser.ID || matchedUser.id || "Unknown").toString().trim();
  generatePoPdfAndShare(merchId);
}

async function generatePoPdfAndShare(merchId) {
  const poGenerateBtn = document.getElementById('po-generate-btn');
  
  if (!selectedPoStoreId) {
    showToast("Please search and select a store.", "error");
    return;
  }
  if (poCart.length === 0) {
    showToast("Please add at least one product to the order.", "error");
    return;
  }
  
  const storeId = selectedPoStoreId;
  const store = allStores.find(s => (s.ID || s.id || "").toString() === storeId.toString());
  const retailerId = store ? store["Retailers ID"] || store.retailer_id || "" : "";
  const retailerName = retailerMap[retailerId.toString()] || retailerId || "";
  const shortRetailer = retailerName.trim().substring(0, 5);
  
  const rawStoreName = store ? store["Display Name"] || store.name || "" : "Unknown Store";
  const displayStoreName = shortRetailer ? `${shortRetailer} - ${rawStoreName}` : rawStoreName;
  const storeAddress = store ? store.Address || store.address || "" : "";
  
  // Disable button and show spinner
  const originalHtml = poGenerateBtn.innerHTML;
  poGenerateBtn.disabled = true;
  poGenerateBtn.style.opacity = '0.7';
  poGenerateBtn.innerHTML = `
    <svg class="spinning" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;">
      <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.2)"></circle>
      <path d="M12 2a10 10 0 0 1 10 10"></path>
    </svg>
    <span>Sharing PDF...</span>
  `;
  
  showToast("Generating PO PDF...", "info");
  
  // Pre-load and convert logo to grayscale data URL
  let logoDataUrl = null;
  try {
    const logoImg = new Image();
    logoImg.src = 'logo.png';
    await new Promise((resolve, reject) => {
      logoImg.onload = resolve;
      logoImg.onerror = reject;
    });
    const canvas = document.createElement('canvas');
    canvas.width = logoImg.width;
    canvas.height = logoImg.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(logoImg, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;
      for (let j = 0; j < data.length; j += 4) {
        const r = data[j];
        const g = data[j+1];
        const b = data[j+2];
        const a = data[j+3];
        // If transparent, make it white
        if (a < 10) {
          data[j] = 255;
          data[j+1] = 255;
          data[j+2] = 255;
        } else {
          const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
          // Threshold at 180 (values below are black, above are white)
          const val = brightness < 180 ? 0 : 255;
          data[j] = val;
          data[j+1] = val;
          data[j+2] = val;
        }
      }
      ctx.putImageData(imgData, 0, 0);
      logoDataUrl = canvas.toDataURL('image/png');
    }
  } catch (e) {
    console.warn("Failed to load or convert logo image:", e);
  }
  
  try {
    const poRequestId = `${Date.now()}_${storeId}`;
    const dateStr = new Date().toLocaleDateString('en-GB'); // dd/mm/yyyy
    
    // Find merchandiser name
    const merchUser = allUsers.find(u => (u.ID || u.id || "").toString().trim() === merchId.toString().trim());
    const merchName = merchUser ? (merchUser.Name || merchUser.name || "Merchandiser") : "Merchandiser";
    
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: [100, 297] });
    
    // 1. Center logo 1:1 ratio grayscale
    let y = 6;
    if (logoDataUrl) {
      doc.addImage(logoDataUrl, 'PNG', 42, y, 16, 16);
      y += 26; // Move down below logo (extra padding added)
    } else {
      y += 6;
    }
    
    // 2. Title: Purchase Order Request
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text('Purchase Order Request', 50, y, { align: 'center' });
    y += 5;
    
    // 3. Sub Text: HSG Global Pte. Ltd.
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text('HSG Global Pte. Ltd.', 50, y, { align: 'center' });
    y += 9;
    
    // 4. Left & Right Columns metadata
    doc.setFontSize(7.5);
    doc.text(`POR ID : ${poRequestId}`, 10, y);
    doc.text(`Date : ${dateStr}`, 90, y, { align: 'right' });
    y += 4;
    
    doc.text(`Request by : ${merchName}`, 10, y);
    doc.text('Contact : sales@hsg-global.com', 90, y, { align: 'right' });
    y += 6; // space a bit
    
    // 5. Black bar full width: Store Display Name
    doc.setFillColor(15, 23, 42); // Navy/Black bar
    doc.rect(10, y, 80, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(displayStoreName, 50, y + 5.5, { align: 'center' });
    
    // Reset colors
    doc.setTextColor(15, 23, 42);
    y += 8 + 6; // space a bit
    
    // 6. List of order
    for (let i = 0; i < poCart.length; i++) {
      const item = poCart[i];
      
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(item.sku, 10, y);
      
      doc.setFontSize(9);
      let qtyStr = `${item.uom} ${item.pack} x ${item.qty}`;
      doc.text(qtyStr, 90, y, { align: 'right' });
      
      y += 4.5;
      
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      const splitName = doc.splitTextToSize(item.name, 80);
      doc.text(splitName, 10, y);
      
      y += (splitName.length * 3) + 1;
      
      try {
        const canvas = document.createElement('canvas');
        JsBarcode(canvas, item.sku, {
          format: "CODE39",
          width: 2,
          height: 20,
          displayValue: false,
          margin: 0
        });
        const imgData = canvas.toDataURL("image/png");
        doc.addImage(imgData, 'PNG', 10, y, 80, 10);
      } catch (e) {
        console.error("Barcode generation failed for " + item.sku, e);
      }
      
      y += 14;
      
      if (y > 255 && i < poCart.length - 1) {
        doc.addPage();
        y = 15;
      } else if (i < poCart.length - 1) {
        // Draw dashed separator line
        doc.setDrawColor(203, 213, 225); // light gray (#CBD5E1)
        doc.setLineDash([2, 2]); // dashed style
        doc.line(10, y, 90, y);
        doc.setLineDash([]); // reset to solid line
        y += 8; // add padding after the separator
      }
    }
    
    // 7. Black bar full width contain total qty list
    y += 4;
    doc.setFillColor(15, 23, 42);
    doc.rect(10, y, 80, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    const totalQty = poCart.reduce((sum, item) => sum + (parseInt(item.pack || 1) * item.qty), 0);
    const summaryText = `Total: ${poCart.length} SKU(s)   |   Total Qty: ${totalQty}`;
    doc.text(summaryText, 50, y + 5.5, { align: 'center' });
    
    // Reset colors
    doc.setTextColor(15, 23, 42);
    y += 8 + 6;
    
    // 8. size 7.5 footer HSG Global Pte Ltd
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text('HSG Global Pte Ltd', 50, y, { align: 'center' });
    
    const pdfBlob = doc.output('blob');
    
    // Sync PO Request to Google Sheets (Merch_PO_Request)
    const orderString = JSON.stringify(poCart.map(item => ({ sku: item.sku, qty: item.qty })));
    
    writeWithRetry({
      sheet: "Merch_PO_Request",
      action: "insert",
      data: {
        "ID": poRequestId,
        "Timestamp": Date.now(),
        "Store ID": storeId,
        "Order": orderString,
        "Merch ID": merchId
      }
    }).catch(err => {
      console.error("Failed to sync PO Request to Google Sheets:", err);
      // Save locally in failedSyncs to retry later
      const queueItem = {
        id: 'po_request_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        type: 'po_request',
        storeName: displayStoreName,
        timestamp: Date.now(),
        payload: {
          poRequestId,
          storeId,
          orderString,
          merchId
        },
        error: 'Pending sync...'
      };
      failedSyncs.push(queueItem);
      localStorage.setItem('merch_failed_syncs', JSON.stringify(failedSyncs));
      updateSyncUI();
    });

    const displayDate = new Date().toLocaleDateString('en-GB').replace(/\//g, '-');
    const fileName = `PO_Request_${displayStoreName.replace(/[^a-z0-9]/gi, '_')}_${displayDate}.pdf`;
    
    const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });
    
    if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
      showToast("Opening share menu...", "success");
      await navigator.share({
        files: [pdfFile],
        title: `PO Request - ${displayStoreName}`,
        text: `Here is the PO Request for ${displayStoreName}`
      });
    } else {
      // Fallback: download PDF
      doc.save(fileName);
      showToast("Direct sharing not supported. PDF downloaded instead.", "success");
    }
    
    // Clear cart and reset form after success
    poCart = [];
    renderPoCart();
    selectedPoStoreId = null;
    const poStoreSearch = document.getElementById('po-store-search');
    if (poStoreSearch) poStoreSearch.value = '';
    const poSelectedStoreInfo = document.getElementById('po-selected-store-info');
    if (poSelectedStoreInfo) {
      poSelectedStoreInfo.textContent = '';
      poSelectedStoreInfo.style.display = 'none';
    }
    const pSelect = document.getElementById('po-product-select');
    if (pSelect) pSelect.innerHTML = '<option value="">Select a Product</option>';
    
  } catch (error) {
    console.error("Failed to generate and share PO PDF:", error);
    showToast("Failed to generate or share PDF: " + error.message, "error");
  } finally {
    poGenerateBtn.disabled = false;
    poGenerateBtn.style.opacity = '1';
    poGenerateBtn.innerHTML = originalHtml;
  }
}

function getContactPhone(c) {
  return c.Phone || c.phone || c["Phone Number"] || c["phone_number"] || c["phone number"] || "";
}
function getContactGroupLink(c) {
  return c["Group Link"] || c["group_link"] || c["group link"] || c.groupLink || "";
}
function getContactIdLink(c) {
  return c["ID Link"] || c["id_link"] || c["id link"] || c.idLink || c["Stores ID"] || c["stores_id"] || "";
}

function renderPhonebook() {
  const tbody = document.getElementById('phonebook-table-body');
  const footer = document.getElementById('phonebook-footer');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  // Filter contacts where Group Link === "Stores" (case-insensitive)
  let filtered = allContacts.filter(c => {
    const gl = String(getContactGroupLink(c)).trim().toLowerCase();
    return gl === "stores";
  });
  
  const query = phonebookSearchQuery.trim().toLowerCase();
  if (query) {
    const queryWords = query.split(/\s+/).filter(w => w.length > 0);
    if (queryWords.length > 0) {
      filtered = filtered.filter(c => {
        const name = (c.Name || c.name || "").toLowerCase();
        const pos = (c.Position || c.position || "").toLowerCase();
        const phone = String(getContactPhone(c)).toLowerCase();
        const email = (c.Email || c.email || "").toLowerCase();
        
        const storeId = String(getContactIdLink(c)).trim();
        const store = allStores.find(s => (s.ID || s.id || "").toString().trim() === storeId);
        const storeDisplayName = store ? (store["Display Name"] || store.name || "").toLowerCase() : "";
        const retailerId = store ? (store["Retailers ID"] || store.retailer_id || "") : "";
        const retailerName = retailerId ? (retailerMap[retailerId.toString()] || retailerId).toLowerCase() : "";
        const storeInfoText = retailerName ? `${retailerName} | ${storeDisplayName}` : storeDisplayName;
        
        const contactText = `${name} ${pos} ${phone} ${email} ${storeInfoText}`;
        return queryWords.every(word => contactText.includes(word));
      });
    }
  }
  
  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="2" style="text-align: center; padding: 20px; color: #94A3B8;">
          No contacts found.
        </td>
      </tr>
    `;
    if (footer) footer.textContent = 'Total Contacts: 0';
    return;
  }
  
  filtered.forEach(c => {
    const name = c.Name || c.name || "";
    const pos = c.Position || c.position || "";
    const phone = getContactPhone(c);
    const gender = (c.Gender || c.gender || "").toString().trim().toLowerCase();
    const email = c.Email || c.email || "";
    const storeId = String(getContactIdLink(c)).trim();
    
    let prefix = "";
    if (gender === 'male') {
      prefix = "Mr. ";
    } else if (gender === 'female') {
      prefix = "Ms. ";
    }
    
    const store = allStores.find(s => (s.ID || s.id || "").toString().trim() === storeId);
    const storeDisplayName = store ? (store["Display Name"] || store.name || `Store ${storeId}`) : `Store ID: ${storeId}`;
    const retailerId = store ? (store["Retailers ID"] || store.retailer_id || "") : "";
    const retailerName = retailerId ? (retailerMap[retailerId.toString()] || retailerId) : "";
    const storeInfoText = retailerName ? `${retailerName} | ${storeDisplayName}` : storeDisplayName;
    
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid #E2E8F0';
    
    tr.innerHTML = `
      <td style="padding: 8px 4px; color: #1E293B;">
        <div style="font-weight: 600;">${prefix}${name} (${pos})</div>
        <div style="font-size: 9.5px; color: #64748B; margin-top: 2px;">${storeInfoText}</div>
      </td>
      <td style="padding: 8px 4px; text-align: right; color: #1E293B; vertical-align: top;">
        <div style="font-weight: 600;">${phone}</div>
        <div style="font-size: 9.5px; color: #64748B; margin-top: 2px;">${email || 'N/A'}</div>
      </td>
    `;
    tbody.appendChild(tr);
  });
  
  if (footer) {
    footer.textContent = `Total Contacts: ${filtered.length}`;
  }
}

function setupSearchableDropdown() {
  const searchInput = document.getElementById('contact-store-search');
  const select = document.getElementById('contact-store-select');
  if (!searchInput || !select) return;
  
  searchInput._selectedStoreId = "";
  
  function filterOptions() {
    const val = searchInput.value.toLowerCase().trim();
    select.innerHTML = '';
    
    if (!val) {
      select.style.display = 'none';
      return;
    }
    
    const matches = allStores.filter(store => {
      const storeId = (store.ID || store.id || "").toString().toLowerCase();
      const storeName = (store["Display Name"] || store.name || "").toLowerCase();
      return storeId.includes(val) || storeName.includes(val);
    });
    
    if (matches.length === 0) {
      select.style.display = 'none';
      return;
    }
    
    matches.forEach(store => {
      const id = (store.ID || store.id || "").toString();
      const name = store["Display Name"] || store.name || "";
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = `[${id}] ${name}`;
      select.appendChild(opt);
    });
    
    select.style.display = 'block';
  }
  
  searchInput.addEventListener('input', filterOptions);
  searchInput.addEventListener('focus', filterOptions);
  
  document.addEventListener('click', (e) => {
    if (e.target !== searchInput && e.target !== select) {
      select.style.display = 'none';
    }
  });
  
  select.addEventListener('change', () => {
    const opt = select.options[select.selectedIndex];
    if (opt) {
      searchInput.value = opt.textContent;
      searchInput._selectedStoreId = opt.value;
      select.style.display = 'none';
    }
  });
}

async function submitNewContact() {
  const searchInput = document.getElementById('contact-store-search');
  const storeId = searchInput._selectedStoreId;
  const name = document.getElementById('contact-name').value.trim();
  const position = document.getElementById('contact-position').value.trim();
  const phone = document.getElementById('contact-phone').value.trim();
  const gender = document.getElementById('contact-gender').value;
  const email = document.getElementById('contact-email').value.trim();
  
  const validStore = allStores.find(s => (s.ID || s.id || "").toString().trim() === storeId);
  if (!validStore) {
    showToast("Please select a valid store from the dropdown suggestions.", "error");
    return;
  }
  
  const exists = allContacts.some(c => {
    const existingPhone = String(getContactPhone(c)).trim();
    return existingPhone === phone;
  });
  if (exists) {
    showToast("Error: A contact with this phone number already exists in the Phonebook.", "error");
    return;
  }
  
  const newContact = {
    "Phone": phone,
    "Position": position,
    "Name": name,
    "Email": email || "",
    "Gender": gender,
    "Group Link": "Stores",
    "ID Link": storeId
  };
  
  allContacts.push(newContact);
  localStorage.setItem('merch_contacts', JSON.stringify(allContacts));
  
  document.getElementById('add-contact-page').classList.remove('active');
  renderPhonebook();
  
  showToast("Contact saved! Syncing in background.", "success");
  
  const queueItem = {
    id: 'contact_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    type: 'contact',
    storeName: `Contact: ${name}`,
    timestamp: Date.now(),
    payload: newContact,
    error: 'Pending sync...'
  };

  failedSyncs.push(queueItem);
  localStorage.setItem('merch_failed_syncs', JSON.stringify(failedSyncs));
  updateSyncUI();

  (async () => {
    try {
      await writeWithRetry({
        sheet: "Contacts_Book",
        action: "insert",
        data: newContact
      });
      failedSyncs = failedSyncs.filter(q => q.id !== queueItem.id);
      localStorage.setItem('merch_failed_syncs', JSON.stringify(failedSyncs));
      updateSyncUI();
      console.log("Contact inserted to Contacts_Book sheet successfully.");
      fetchDataSilently();
    } catch (e) {
      console.error("Failed to sync contact in background:", e);
      queueItem.error = e.message || 'Sync failed';
      localStorage.setItem('merch_failed_syncs', JSON.stringify(failedSyncs));
      updateSyncUI();
    }
  })();
}

function openCompleteTaskRemark(taskId) {
  const task = allTasks.find(t => (t.ID || t.id || t['Created Date'] || t.CreatedDate || "").toString() === taskId);
  if (!task) return;
  activeSpecialTask = task;
  currentRemarkMode = 'special-task';
  
  const remarkHeaderTitle = document.querySelector('#remark-page .preview-header-title');
  if (remarkHeaderTitle) remarkHeaderTitle.textContent = "Complete Task";
  
  const auditSubmitBtn = document.getElementById('audit-submit-btn');
  if (auditSubmitBtn) auditSubmitBtn.textContent = "Submit Task";
  
  const remarkGroup = document.getElementById('audit-remark-group');
  if (remarkGroup) remarkGroup.classList.remove('hidden');
  
  const remarkInput = document.getElementById('audit-remark-input');
  const pinInput = document.getElementById('audit-pin-input');
  if (remarkInput) remarkInput.value = '';
  if (pinInput) {
    pinInput.value = '';
    pinInput.classList.remove('error');
  }
  
  const remarkPage = document.getElementById('remark-page');
  if (remarkPage) {
    remarkPage.classList.add('active');
    pushPageState('remark');
  }
}

async function submitSpecialTask() {
  if (!activeSpecialTask) return;
  
  const remarkInput = document.getElementById('audit-remark-input');
  const pinInput = document.getElementById('audit-pin-input');
  
  if (!remarkInput || !remarkInput.value.trim()) {
    showToast("Please enter a remark.", "error");
    return;
  }
  
  if (!pinInput || !pinInput.value.trim() || pinInput.value.length < 4) {
    showToast("Please enter a 4-digit PIN.", "error");
    return;
  }
  
  const remark = remarkInput.value.trim();
  const enteredPin = parseInt(pinInput.value.trim());
  
  const matchedUser = allUsers.find(u => parseInt(u.PIN || u.pin) === enteredPin);
  if (!matchedUser) {
    const digitInputs = document.querySelectorAll('.pin-digit-input');
    digitInputs.forEach(input => input.classList.add('error'));
    showToast("Incorrect PIN. Please enter a valid merchandiser PIN.", "error");
    setTimeout(() => {
      digitInputs.forEach(input => input.classList.remove('error'));
      clearAuditPin();
    }, 300);
    return;
  }
  
  const merchName = matchedUser.Name || matchedUser.name || "Merch Name";
  const taskId = (activeSpecialTask.ID || activeSpecialTask.id || activeSpecialTask['Created Date'] || activeSpecialTask.CreatedDate || "").toString();
  
  let taskLogs = [];
  const logVal = activeSpecialTask['Task Log'] || activeSpecialTask['task log'] || activeSpecialTask['TaskLog'] || '[]';
  try {
    taskLogs = JSON.parse(logVal);
    if (!Array.isArray(taskLogs)) {
      taskLogs = [];
    }
  } catch (e) {
    taskLogs = [];
  }
  
  taskLogs.push({
    "Action": "Visited",
    "Remark": remark,
    "Action by": merchName,
    "Timestamp": Date.now()
  });
  
  const taskLogString = JSON.stringify(taskLogs);
  activeSpecialTask['Task Log'] = taskLogString;
  if (activeSpecialTask['task log']) activeSpecialTask['task log'] = taskLogString;
  if (activeSpecialTask['TaskLog']) activeSpecialTask['TaskLog'] = taskLogString;
  
  activeSpecialTask['Task Action'] = "Call";
  if (activeSpecialTask['task action']) activeSpecialTask['task action'] = "Call";
  if (activeSpecialTask['TaskAction']) activeSpecialTask['TaskAction'] = "Call";
  
  localStorage.setItem('merch_tasks', JSON.stringify(allTasks));
  processTasksData(allTasks);
  
  closeAllSubpages();
  renderStoresList();
  
  setTimeout(() => {
    showToast("Task completed! Syncing in background.", "success");
  }, 50);
  
  const taskStoreId = (activeSpecialTask['Stores ID'] || activeSpecialTask.StoresID || "").toString().trim();
  const taskStore = allStores.find(s => (s.ID || s.id || "").toString().trim() === taskStoreId);
  const storeDisplayName = taskStore ? (taskStore["Display Name"] || taskStore.name) : `Task #${taskStoreId}`;

  const queueItem = {
    id: 'task_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    type: 'special-task',
    storeName: `Task: ${storeDisplayName}`,
    timestamp: Date.now(),
    payload: {
      taskCreatedDate: activeSpecialTask['Created Date'] || activeSpecialTask.CreatedDate,
      taskLogs: taskLogs
    },
    error: 'Pending sync...'
  };

  failedSyncs.push(queueItem);
  localStorage.setItem('merch_failed_syncs', JSON.stringify(failedSyncs));
  updateSyncUI();

  (async () => {
    try {
      await writeWithRetry({
        sheet: "Stores_Task_Assigned",
        action: "update",
        data: {
          "Created Date": queueItem.payload.taskCreatedDate,
          "Task Action": "Call",
          "Task Log": JSON.stringify(queueItem.payload.taskLogs)
        }
      });
      failedSyncs = failedSyncs.filter(q => q.id !== queueItem.id);
      localStorage.setItem('merch_failed_syncs', JSON.stringify(failedSyncs));
      updateSyncUI();
      console.log("Special task updated in sheet successfully.");
      fetchDataSilently();
    } catch (e) {
      console.error("Failed to sync special task completion in background:", e);
      queueItem.error = e.message || 'Sync failed';
      localStorage.setItem('merch_failed_syncs', JSON.stringify(failedSyncs));
      updateSyncUI();
    }
  })();
}

// Show forced PWA update overlay
function showUpdatePrompt(worker) {
  let overlay = document.getElementById('update-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'update-overlay';
    overlay.className = 'update-overlay';
    overlay.innerHTML = `
      <div class="update-dialog">
        <div class="update-icon-wrapper">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:32px;height:32px;">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
          </svg>
        </div>
        <div class="update-title">New Version Available!</div>
        <div class="update-description">
          A new version of the merchandiser app has been downloaded. Please update now to load the latest features and fixes.
        </div>
        <button id="update-confirm-btn" class="update-btn-primary">Update Now</button>
      </div>
    `;
    document.body.appendChild(overlay);
    
    document.getElementById('update-confirm-btn').addEventListener('click', () => {
      // Send skip waiting message
      worker.postMessage({ type: 'SKIP_WAITING', action: 'skipWaiting' });
      // Disable button and show updating state
      const btn = document.getElementById('update-confirm-btn');
      btn.disabled = true;
      btn.textContent = 'Updating...';
    });
  }
  
  setTimeout(() => {
    overlay.classList.add('active');
  }, 100);
}

// Custom Toast Notification System
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  
  const toast = document.createElement('div');
  toast.className = `toast-message ${type}`;
  
  let iconSvg = '';
  const msgLower = message.toLowerCase();
  if (type === 'success' || msgLower.includes('success') || msgLower.includes('submitted') || msgLower.includes('saved') || msgLower.includes('completed')) {
    toast.classList.add('success');
    iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="toast-icon success-icon"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
  } else if (type === 'error' || msgLower.includes('error') || msgLower.includes('fail') || msgLower.includes('incorrect') || msgLower.includes('denied') || msgLower.includes('mandatory')) {
    toast.classList.add('error');
    iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="toast-icon error-icon"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
  } else {
    toast.classList.add('info');
    iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="toast-icon info-icon"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
  }
  
  toast.innerHTML = `
    ${iconSvg}
    <span class="toast-text">${message}</span>
  `;
  
  container.appendChild(toast);
  
  // Trigger transition
  toast.offsetHeight;
  toast.classList.add('visible');
  
  // Auto remove after 3.5 seconds
  setTimeout(() => {
    toast.classList.remove('visible');
    const onTransitionEnd = () => {
      toast.remove();
      toast.removeEventListener('transitionend', onTransitionEnd);
    };
    toast.addEventListener('transitionend', onTransitionEnd);
  }, 3500);
}

// Override window.alert to automatically use our beautiful top toasts
window.alert = function(msg) {
  showToast(msg);
};

// WhatsApp re-sharing of past audits from the Latest Visit page
// WhatsApp re-sharing of past audits from the Latest Visit page
async function sharePastAuditToWhatsApp(storeIdStr) {
  const store = allStores.find(s => (s.ID || s.id || "").toString() === storeIdStr);
  if (!store) return;
  
  const storeName = store["Display Name"] || store.name || store["Buyer Store Name"] || "Unknown Store";
  const retailerId = store["Retailers ID"] || store.retailer_id || "";
  const retailerName = retailerMap[retailerId.toString()] || retailerId || "N/A";
  const status = store.Status || store.status || "Pending";
  
  // Find all shelf logs for this store
  const storeShelfLogs = allShelfLogs.filter(l => 
    (l['Retailer Stores ID'] || l['retailer_store_id'] || "").toString().trim() === storeIdStr.trim()
  );

  // Find latest audit log
  const storeLogs = allAuditLogs.filter(l => (l['Retailer Stores ID'] || l['retailer_store_id'] || l['RetailerStoresID'] || "").toString() === storeIdStr);
  if (storeLogs.length === 0 && storeShelfLogs.length === 0) {
    showToast("No audit logs found for this store.", "error");
    return;
  }
  
  let remark = "N/A";
  let formattedTime = "";
  if (storeLogs.length > 0) {
    storeLogs.sort((a, b) => parseTimestamp(b.Timestamp || b.timestamp) - parseTimestamp(a.Timestamp || a.timestamp));
    const latestLog = storeLogs[0];
    remark = latestLog.Remark || latestLog.remark || "N/A";
    const timestamp = parseTimestamp(latestLog.Timestamp || latestLog.timestamp);
    formattedTime = formatTimestamp(timestamp);
  } else if (storeShelfLogs.length > 0) {
    storeShelfLogs.sort((a, b) => parseTimestamp(b.Timestamp || b.timestamp) - parseTimestamp(a.Timestamp || a.timestamp));
    const timestamp = parseTimestamp(storeShelfLogs[0].Timestamp || storeShelfLogs[0].timestamp);
    formattedTime = formatTimestamp(timestamp);
  }

  // Find matching shelf logs (get the latest date from shelf logs for this store, and return all on that date)
  let matchShelfLogs = [];
  if (storeShelfLogs.length > 0) {
    storeShelfLogs.sort((a, b) => parseTimestamp(b.Timestamp || b.timestamp) - parseTimestamp(a.Timestamp || a.timestamp));
    const latestTS = parseTimestamp(storeShelfLogs[0].Timestamp || storeShelfLogs[0].timestamp);
    const latestShelfDateStr = formatDateYYYYMMDD(latestTS);
    
    matchShelfLogs = storeShelfLogs.filter(l => {
      const t = parseTimestamp(l.Timestamp || l.timestamp);
      return formatDateYYYYMMDD(t) === latestShelfDateStr;
    });
  }

  let shareText = `*${storeName}*\n`;
  shareText += `${retailerName} - ${status}\n`;
  shareText += `${formattedTime}\n\n`;

  if (matchShelfLogs.length > 0) {
    matchShelfLogs.forEach(log => {
      const brandId = log['Brands ID'] || log.brand_id;
      const brand = allBrands.find(b => (b.ID || b.id || "").toString() === (brandId || "").toString());
      const brandName = brand ? brand['Display Name'] || brand.name : `Brand ${brandId}`;
      const brandRemark = log.Remark || log.remark || "N/A";
      shareText += `*${brandName}*\n${brandRemark}\n\n`;
    });
  } else {
    shareText += `*Remark:*\n${remark}\n\n`;
  }
  shareText = shareText.trim();

  // UI Setup for Bottom Drawer
  const overlay = document.getElementById('whatsapp-prep-overlay');
  const drawer = document.getElementById('whatsapp-prep-drawer');
  const statusText = document.getElementById('whatsapp-prep-status');
  const progressBar = document.getElementById('whatsapp-prep-progress-bar');
  const cancelBtn = document.getElementById('whatsapp-prep-cancel-btn');
  const sendBtn = document.getElementById('whatsapp-prep-send-btn');

  if (!overlay || !drawer || !statusText || !progressBar || !cancelBtn || !sendBtn) {
    console.error("WhatsApp prep UI components not found in DOM");
    return;
  }

  // Initial State & Details Populating
  const storeNameEl = document.getElementById('whatsapp-prep-store-name');
  const retailerNameEl = document.getElementById('whatsapp-prep-retailer-name');
  const remarkEl = document.getElementById('whatsapp-prep-remark');
  const imagesListEl = document.getElementById('whatsapp-prep-images-list');
  const imagesSectionEl = document.getElementById('whatsapp-prep-images-section');

  if (storeNameEl) storeNameEl.textContent = storeName;
  if (retailerNameEl) retailerNameEl.textContent = retailerName;
  if (remarkEl) remarkEl.textContent = remark;
  
  if (imagesListEl) {
    imagesListEl.innerHTML = '';
    if (matchShelfLogs.length === 0) {
      if (imagesSectionEl) imagesSectionEl.classList.add('hidden');
    } else {
      if (imagesSectionEl) imagesSectionEl.classList.remove('hidden');
      matchShelfLogs.forEach((log, idx) => {
        const imgUrl = log['Image Link'] || log.image_link;
        if (imgUrl) {
          const thumbWrapper = document.createElement('div');
          thumbWrapper.style.cssText = 'flex-shrink: 0; width: 56px; aspect-ratio: 4 / 5; border-radius: 6px; border: 1px solid #E2E8F0; overflow: hidden; background: #F8FAFC; display: flex; align-items: center; justify-content: center;';
          
          const img = document.createElement('img');
          img.src = imgUrl;
          img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
          
          thumbWrapper.appendChild(img);
          imagesListEl.appendChild(thumbWrapper);
        }
      });
    }
  }

  statusText.textContent = "Preparing report...";
  progressBar.style.width = "0%";
  sendBtn.disabled = true;
  sendBtn.style.opacity = "0.5";
  sendBtn.style.cursor = "not-allowed";

  // Open Drawer
  overlay.classList.add('active');
  drawer.classList.add('active');

  // Cancel Handler State
  let isCancelled = false;
  
  const closePrepDrawer = () => {
    overlay.classList.remove('active');
    drawer.classList.remove('active');
  };

  // Bind Cancel button
  const handleCancel = () => {
    isCancelled = true;
    closePrepDrawer();
  };
  
  cancelBtn.onclick = handleCancel;
  overlay.onclick = handleCancel; // clicking backdrop cancels too

  // Gather photos
  const filesToShare = [];
  const N = matchShelfLogs.length;

  if (N === 0) {
    // If no photos, instantly complete
    if (!isCancelled) {
      statusText.textContent = "Complete";
      progressBar.style.width = "100%";
      sendBtn.disabled = false;
      sendBtn.style.opacity = "1";
      sendBtn.style.cursor = "pointer";
    }
  } else {
    // Perform sequential downloads
    for (let i = 0; i < N; i++) {
      if (isCancelled) return;

      const log = matchShelfLogs[i];
      const imgUrl = log['Image Link'] || log.image_link;
      const brandId = log['Brands ID'] || log.brand_id || 'shelf';
      const brand = allBrands.find(b => (b.ID || b.id || "").toString() === brandId.toString());
      const brandName = brand ? brand['Display Name'] || brand.name : `shelf ${i + 1}`;
      
      // Update UI: Show download progress (lowercase to match user requirement "download shelf 1, downloading shelf 2...")
      statusText.textContent = `Downloading ${brandName.toLowerCase()}...`;
      progressBar.style.width = `${Math.round((i / N) * 90)}%`;

      if (imgUrl) {
        try {
          let blob;
          if (typeof imgUrl === 'string' && imgUrl.startsWith('data:')) {
            // Convert data URL to Blob directly
            const arr = imgUrl.split(',');
            const mime = arr[0].match(/:(.*?);/)[1];
            const bstr = atob(arr[1]);
            let n = bstr.length;
            const u8arr = new Uint8Array(n);
            while (n--) {
              u8arr[n] = bstr.charCodeAt(n);
            }
            blob = new Blob([u8arr], { type: mime });
          } else {
            let fetchUrl = imgUrl;
            if (typeof imgUrl === 'string' && !imgUrl.startsWith('blob:') && !imgUrl.startsWith(WORKER_URL)) {
              fetchUrl = `${WORKER_URL}/api/proxy?url=${encodeURIComponent(imgUrl)}`;
            }
            
            const res = await fetch(fetchUrl);
            if (res.ok) {
              blob = await res.blob();
            }
          }
          
          if (blob) {
            let ext = 'jpg';
            if (typeof imgUrl === 'string' && !imgUrl.startsWith('data:')) {
              ext = imgUrl.split('.').pop().split('?')[0] || 'jpg';
            }
            const cleanName = brandName.replace(/[^a-zA-Z0-9]/g, '_');
            const file = new File([blob], `${cleanName}_shelf.${ext}`, { type: blob.type || 'image/jpeg' });
            filesToShare.push(file);
          }
        } catch (e) {
          console.warn(`Failed to fetch past shelf image for ${brandName}:`, e);
        }
      }
    }

    if (!isCancelled) {
      statusText.textContent = "Complete";
      progressBar.style.width = "100%";
      sendBtn.disabled = false;
      sendBtn.style.opacity = "1";
      sendBtn.style.cursor = "pointer";
    }
  }

  // Bind Send button click
  sendBtn.onclick = async () => {
    if (isCancelled) return;
    
    closePrepDrawer();

    let shared = false;
    if (navigator.share) {
      try {
        if (filesToShare.length > 0 && navigator.canShare && navigator.canShare({ files: filesToShare })) {
          await navigator.share({
            files: filesToShare,
            text: shareText,
            title: `Audit - ${storeName}`
          });
          shared = true;
        } else {
          await navigator.share({
            text: shareText,
            title: `Audit - ${storeName}`
          });
          shared = true;
        }
      } catch (shareErr) {
        console.log("Web Share failed or cancelled:", shareErr);
      }
    }

    // Always trigger downloads for the files if sharing was not supported, failed, or cancelled
    if (!shared && filesToShare.length > 0) {
      filesToShare.forEach(file => {
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
      showToast("Downloaded shelf images. Redirecting to WhatsApp...", "success");
    }

    if (!shared || !navigator.share) {
      const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
      window.open(waUrl, '_blank');
    }
  };
}

// My Report Page Implementation
function renderMyReport() {
  const pinContainer = document.getElementById('my-report-pin-container');
  const dashboard = document.getElementById('my-report-dashboard');
  const pinInput = document.getElementById('my-report-pin-input');
  
  if (currentMerchUser === null) {
    if (pinContainer) pinContainer.classList.remove('hidden');
    if (dashboard) dashboard.classList.add('hidden');
    if (pinInput) {
      pinInput.value = '';
      pinInput.classList.remove('error');
    }
  } else {
    if (pinContainer) pinContainer.classList.add('hidden');
    if (dashboard) dashboard.classList.remove('hidden');
    renderReportDashboard();
  }
}

function verifyMyReportPin() {
  const pinInput = document.getElementById('my-report-pin-input');
  if (!pinInput) return;
  const enteredPin = parseInt(pinInput.value.trim());
  
  if (isNaN(enteredPin) || pinInput.value.trim().length < 4) {
    pinInput.classList.add('error');
    showToast("Please enter a 4-digit PIN.", "error");
    setTimeout(() => pinInput.classList.remove('error'), 300);
    return;
  }
  
  const matchedUser = allUsers.find(u => parseInt(u.PIN || u.pin) === enteredPin);
  if (!matchedUser) {
    pinInput.classList.add('error');
    showToast("Incorrect PIN. Please try again.", "error");
    setTimeout(() => pinInput.classList.remove('error'), 300);
    return;
  }
  
  currentMerchUser = matchedUser;
  renderMyReport();
}

function renderReportDashboard() {
  if (!currentMerchUser) return;
  const merchId = (currentMerchUser.ID || currentMerchUser.id || "").toString().trim();
  
  // Filter all logs by this merchandiser
  const merchLogs = allAuditLogs.filter(log => {
    const mId = (log['Merch ID'] || log['MerchID'] || log.merch_id || '').toString().trim();
    return mId === merchId;
  });
  
  const todayStr = formatDateDMY(Date.now());
  const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  
  // Stats
  const visitsToday = merchLogs.filter(log => {
    const timeMs = parseTimestamp(log.Timestamp || log.timestamp);
    return timeMs && formatDateDMY(timeMs) === todayStr;
  }).length;
  
  const visitsThisWeek = merchLogs.filter(log => {
    const timeMs = parseTimestamp(log.Timestamp || log.timestamp);
    return timeMs && timeMs >= oneWeekAgo;
  }).length;
  
  document.getElementById('report-stat-today').textContent = visitsToday;
  document.getElementById('report-stat-week').textContent = visitsThisWeek;
  
  // Active toggle button styles
  const todayBtn = document.getElementById('report-toggle-today-btn');
  const weekBtn = document.getElementById('report-toggle-week-btn');
  if (currentReportTab === 'today') {
    if (todayBtn) {
      todayBtn.style.background = '#FFF';
      todayBtn.style.color = 'var(--text-primary)';
    }
    if (weekBtn) {
      weekBtn.style.background = 'transparent';
      weekBtn.style.color = 'var(--text-secondary)';
    }
  } else {
    if (weekBtn) {
      weekBtn.style.background = '#FFF';
      weekBtn.style.color = 'var(--text-primary)';
    }
    if (todayBtn) {
      todayBtn.style.background = 'transparent';
      todayBtn.style.color = 'var(--text-secondary)';
    }
  }
  
  // Filter logs for the table list
  let displayLogs = [];
  if (currentReportTab === 'today') {
    displayLogs = merchLogs.filter(log => {
      const timeMs = parseTimestamp(log.Timestamp || log.timestamp);
      return timeMs && formatDateDMY(timeMs) === todayStr;
    });
  } else {
    displayLogs = merchLogs.filter(log => {
      const timeMs = parseTimestamp(log.Timestamp || log.timestamp);
      return timeMs && timeMs >= oneWeekAgo;
    });
  }
  
  // Sort logs by timestamp descending (newest visit first)
  displayLogs.sort((a, b) => parseTimestamp(b.Timestamp || b.timestamp) - parseTimestamp(a.Timestamp || a.timestamp));
  
  const tbody = document.getElementById('report-table-body');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  if (displayLogs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="2" style="text-align: center; padding: 30px 10px; color: #94A3B8;">
          No visits recorded for ${currentReportTab === 'today' ? 'today' : 'this week'}.
        </td>
      </tr>
    `;
    return;
  }
  
  displayLogs.forEach(log => {
    const storeId = (log['Retailer Stores ID'] || log['retailer_store_id'] || log['RetailerStoresID'] || "").toString().trim();
    const store = allStores.find(s => (s.ID || s.id || "").toString().trim() === storeId);
    const storeDisplayName = store ? (store["Display Name"] || store.name || `Store ${storeId}`) : `Store ID: ${storeId}`;
    const retailerId = store ? (store["Retailers ID"] || store.retailer_id || "") : "";
    const retailerName = retailerId ? (retailerMap[retailerId.toString()] || retailerId) : "Unknown Retailer";
    
    const logTimeMs = parseTimestamp(log.Timestamp || log.timestamp);
    const timeStr = formatTimeHM(logTimeMs);
    const dateStr = formatDateDMY(logTimeMs);
    
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid #E2E8F0';
    tr.innerHTML = `
      <td style="padding: 10px 4px; color: #1E293B;">
        <div style="font-weight: 600;">${retailerName}</div>
        <div style="font-size: 9.5px; color: #64748B; margin-top: 1px;">${storeDisplayName}</div>
      </td>
      <td style="padding: 10px 4px; text-align: right; color: #1E293B; vertical-align: top; width: 110px;">
        <div style="font-weight: 600;">${timeStr}</div>
        <div style="font-size: 9.5px; color: #64748B; margin-top: 1px;">${dateStr}</div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function clockOutMerch() {
  if (!currentMerchUser) return;
  const merchId = (currentMerchUser.ID || currentMerchUser.id || "").toString().trim();
  const todayStr = formatDateDMY(Date.now());
  
  // Get all visits today by this merchandiser
  const todayLogs = allAuditLogs.filter(log => {
    const mId = (log['Merch ID'] || log['MerchID'] || log.merch_id || '').toString().trim();
    const timeMs = parseTimestamp(log.Timestamp || log.timestamp);
    return mId === merchId && timeMs && formatDateDMY(timeMs) === todayStr;
  });
  
  const totalVisits = todayLogs.length;
  
  // Group by retailer
  const retailerCounts = {};
  todayLogs.forEach(log => {
    const storeId = (log['Retailer Stores ID'] || log['retailer_store_id'] || log['RetailerStoresID'] || "").toString().trim();
    const store = allStores.find(s => (s.ID || s.id || "").toString().trim() === storeId);
    const retailerId = store ? (store["Retailers ID"] || store.retailer_id || "") : "";
    const retailerName = retailerId ? (retailerMap[retailerId.toString()] || retailerId) : "Unknown Retailer";
    
    retailerCounts[retailerName] = (retailerCounts[retailerName] || 0) + 1;
  });
  
  // Compile WhatsApp message
  let message = `*My Merch Report*\n`;
  message += `Total visit ${totalVisits} store..\n`;
  
  Object.keys(retailerCounts).forEach(retailerName => {
    // Truncate to 10 characters
    let truncatedName = retailerName.trim();
    if (truncatedName.length > 10) {
      truncatedName = truncatedName.substring(0, 10).trim() + "...";
    }
    const qty = retailerCounts[retailerName];
    message += `${truncatedName} ...... ${qty}\n`;
  });
  
  message += `\n${todayStr}`;
  
  // Reset session
  currentMerchUser = null;
  renderMyReport();
  
  // Open WhatsApp
  const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;
  window.open(waUrl, '_blank');
}

function formatDateDMY(timeMs) {
  if (!timeMs) return "";
  const date = new Date(timeMs);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatDateYYYYMMDD(timeMs) {
  if (!timeMs) return "";
  const date = new Date(timeMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function formatTimeHM(timeMs) {
  if (!timeMs) return "";
  const date = new Date(timeMs);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

// History Navigation Helpers
function pushPageState(pageId) {
  const depth = pageHistoryDepth + 1;
  history.pushState({ page: pageId, depth: depth }, '');
  pageHistoryDepth = depth;
  console.log(`[Navigation] Pushed page: ${pageId}, depth: ${pageHistoryDepth}`);
}

function closeAllSubpages() {
  if (pageHistoryDepth > 0) {
    console.log(`[Navigation] Closing all subpages, going back ${pageHistoryDepth} steps.`);
    const steps = -pageHistoryDepth;
    pageHistoryDepth = 0;
    history.go(steps);
  }
}

window.addEventListener('popstate', (event) => {
  const state = event.state;
  const oldDepth = pageHistoryDepth;
  pageHistoryDepth = state && state.depth ? state.depth : 0;
  console.log(`[Navigation] Popstate triggered. State:`, state, `New depth: ${pageHistoryDepth}, Old depth: ${oldDepth}`);
  
  const remarkPage = document.getElementById('remark-page');
  const auditPage = document.getElementById('audit-page');
  const latestAuditPage = document.getElementById('latest-audit-page');
  const previewPage = document.getElementById('store-preview-page');
  const addContactPage = document.getElementById('add-contact-page');
  const poAuthPage = document.getElementById('po-auth-page');
 
  const setPageActive = (el, active) => {
    if (el) {
      if (active) el.classList.add('active');
      else el.classList.remove('active');
    }
  };
 
  // Handle the exit boundary state
  if (state && state.page === 'entry') {
    if (oldDepth === 0) {
      // Check current tab
      const activeItem = document.querySelector('.drawer-item.active, .footer-item.active');
      const currentTab = activeItem ? activeItem.getAttribute('data-menu') : 'daily-task';
 
      if (currentTab === 'daily-task') {
        // Show custom exit modal
        const exitModal = document.getElementById('exit-modal');
        if (exitModal) exitModal.style.display = 'flex';
      } else {
        // Switch back to daily-task tab
        const dailyTaskBtn = document.querySelector('.footer-item[data-menu="daily-task"], .drawer-item[data-menu="daily-task"]');
        if (dailyTaskBtn) {
          switchMenu('daily-task', dailyTaskBtn);
        }
        // Re-push home state to stay in app
        history.pushState({ page: 'home', depth: 0 }, '');
        pageHistoryDepth = 0;
      }
    } else {
      // Silently restore home view
      setPageActive(remarkPage, false);
      setPageActive(auditPage, false);
      setPageActive(latestAuditPage, false);
      setPageActive(previewPage, false);
      setPageActive(addContactPage, false);
      setPageActive(poAuthPage, false);
      history.pushState({ page: 'home', depth: 0 }, '');
      pageHistoryDepth = 0;
    }
    return;
  }
 
  if (!state) {
    // Proceed back past entry: route to daily-task or show exit modal
    const activeItem = document.querySelector('.drawer-item.active, .footer-item.active');
    const currentTab = activeItem ? activeItem.getAttribute('data-menu') : 'daily-task';
 
    if (currentTab === 'daily-task') {
      const exitModal = document.getElementById('exit-modal');
      if (exitModal) exitModal.style.display = 'flex';
    } else {
      const dailyTaskBtn = document.querySelector('.footer-item[data-menu="daily-task"], .drawer-item[data-menu="daily-task"]');
      if (dailyTaskBtn) {
        switchMenu('daily-task', dailyTaskBtn);
      }
      history.pushState({ page: 'home', depth: 0 }, '');
      pageHistoryDepth = 0;
    }
  } else {
    const page = state.page;
    if (page === 'store-preview') {
      setPageActive(previewPage, true);
      setPageActive(auditPage, false);
      setPageActive(latestAuditPage, false);
      setPageActive(remarkPage, false);
      setPageActive(addContactPage, false);
      setPageActive(poAuthPage, false);
    } else if (page === 'audit') {
      setPageActive(previewPage, true);
      setPageActive(auditPage, true);
      setPageActive(latestAuditPage, false);
      setPageActive(remarkPage, false);
      setPageActive(addContactPage, false);
      setPageActive(poAuthPage, false);
    } else if (page === 'latest-audit') {
      setPageActive(previewPage, true);
      setPageActive(auditPage, false);
      setPageActive(latestAuditPage, true);
      setPageActive(remarkPage, false);
      setPageActive(addContactPage, false);
      setPageActive(poAuthPage, false);
    } else if (page === 'remark') {
      setPageActive(previewPage, true);
      setPageActive(auditPage, true);
      setPageActive(latestAuditPage, false);
      setPageActive(remarkPage, true);
      setPageActive(addContactPage, false);
      setPageActive(poAuthPage, false);
    } else if (page === 'add-contact') {
      setPageActive(previewPage, false);
      setPageActive(auditPage, false);
      setPageActive(latestAuditPage, false);
      setPageActive(remarkPage, false);
      setPageActive(addContactPage, true);
      setPageActive(poAuthPage, false);
    } else if (page === 'po-auth') {
      setPageActive(previewPage, false);
      setPageActive(auditPage, false);
      setPageActive(latestAuditPage, false);
      setPageActive(remarkPage, false);
      setPageActive(addContactPage, false);
      setPageActive(poAuthPage, true);
    } else if (page === 'home') {
      setPageActive(previewPage, false);
      setPageActive(auditPage, false);
      setPageActive(latestAuditPage, false);
      setPageActive(remarkPage, false);
      setPageActive(addContactPage, false);
      setPageActive(poAuthPage, false);
    }
  }
});
