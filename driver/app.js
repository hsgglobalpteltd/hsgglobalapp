// Desktop Redirect Check (Mobile-only check matching Merchandiser App)
if (window.innerWidth > 600) {
  window.location.href = '../index.html';
}

const WORKER_URL = 'https://ib.hsgglobalpteltd.workers.dev';
const APP_VERSION = "26.0.1";

// App State
let allOrders = [];
let activeTab = 'Route Map'; // 'Route Map', 'Delivery Order', 'Return Order', 'Complete'
let activeDeliverOrderTab = 'inprogress'; // 'inprogress' | 'pending'
let activeReturnOrderTab = 'inprogress';  // 'inprogress' | 'pending'
let currentWhatsAppShareUrls = [];
let searchQuery = '';
let isFetchingData = false;
let lastRefreshTime = Date.now();
let toastTimeout = null;
let allProducts = [];
let allBrands = [];

// Leaflet Map state variables
let mapInstance = null;
let markersGroup = null;
let selectedOrderOnMap = null;
let isMapFullscreen = false;

let allUsers = [];
let currentOrder = null;
let authPendingAction = null;
let loadingGoodsOrderId = null;
let tickedSKUs = new Set();
let currentUnloadOrder = null;
let unloadPhotoFile = null;
let returnPaperPhotoFile = null;
let unloadModalMode = "unload"; // "unload" | "pick_return" | "unpick_return"

// Deliver Page state variables
let currentDeliverOrder = null;
let currentDeliverIsReturn = false;
let deliverSignedPhotoFile = null;
let deliverSupportingPhotoFiles = []; // up to 5 files
let deliverItemTicks = new Set();
let deliverItemQtys = {};
let deliverItemRemarks = {};

// ON Mode Timeline state variables
let activeTimelineStart = 'warehouse'; // 'warehouse' | 'mylocation'
let driverLatLng = [1.3197, 103.8962]; // Warehouse coordinates as default

// Format appointment timestamp to dd/mm/yyyy hh:mm format (Adhering to project rules)
function formatAppointment(timestamp) {
  if (!timestamp) return 'N/A';
  const ts = Number(timestamp);
  if (isNaN(ts) || ts <= 0) return timestamp;
  const d = new Date(ts);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

// Safely parse JSON array of image URLs or fallback to a single string
function parseDOImageUrls(val) {
  if (!val) return [];
  const clean = String(val).trim();
  if (!clean) return [];
  if (clean.startsWith('[') && clean.endsWith(']')) {
    try {
      const arr = JSON.parse(clean);
      if (Array.isArray(arr)) {
        return arr.filter(url => url && String(url).trim() !== '');
      }
    } catch (_) {}
  }
  return [clean];
}

// Format Unix Timestamp (milliseconds) to dd/mm/yyyy hh:mm format (Adhering to project date rules)
function formatTimestamp(ts) {
  if (!ts) return '';
  const date = new Date(Number(ts));
  if (isNaN(date.getTime())) return ts; // Return as-is if parsing fails
  
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

// Life Cycle & Initialization
window.addEventListener('DOMContentLoaded', () => {
  // Bind Drawer open/close actions
  const menuBtn = document.getElementById('menu-btn');
  const drawerOverlay = document.getElementById('drawer-overlay');
  
  if (menuBtn) menuBtn.addEventListener('click', toggleDrawer);
  if (drawerOverlay) drawerOverlay.addEventListener('click', closeDrawer);
  
  // Bind Drawer menu items
  const drawerItems = document.querySelectorAll('.drawer-item');
  drawerItems.forEach(item => {
    item.addEventListener('click', () => {
      const menuSelection = item.getAttribute('data-menu');
      switchPage(menuSelection);
      closeDrawer();
    });
  });

  // Bind Expandable Search Bar controls (only active/visible on Complete page)
  const searchContainer = document.getElementById('search-bar-container');
  const searchToggleBtn = document.getElementById('search-toggle-btn');
  const searchInput = document.getElementById('order-search-input');
  const searchClearBtn = document.getElementById('search-clear-btn');

  if (searchToggleBtn && searchContainer && searchInput) {
    searchToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!searchContainer.classList.contains('expanded')) {
        searchContainer.classList.add('expanded');
        setTimeout(() => searchInput.focus(), 100);
      } else {
        collapseSearch();
      }
    });

    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value || '';
      if (searchQuery.length > 0) {
        if (searchClearBtn) searchClearBtn.classList.remove('hidden');
      } else {
        if (searchClearBtn) searchClearBtn.classList.add('hidden');
      }
      renderActivePage();
    });

    if (searchClearBtn) {
      searchClearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        searchInput.value = '';
        searchQuery = '';
        searchClearBtn.classList.add('hidden');
        searchInput.focus();
        renderActivePage();
      });
    }

    // Collapse search if user clicks outside the search container and input is empty
    document.addEventListener('click', (e) => {
      if (searchContainer.classList.contains('expanded') && !searchContainer.contains(e.target)) {
        if (searchInput.value.trim() === '') {
          collapseSearch();
        }
      }
    });
  }

  // Bind Refresh button
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      fetchData();
    });
  }

  // Bind Drawer Refresh button
  const drawerRefreshBtn = document.getElementById('drawer-refresh-btn');
  if (drawerRefreshBtn) {
    drawerRefreshBtn.addEventListener('click', () => {
      fetchData();
    });
  }

  // Auto-refresh every 60 seconds (directly fetching from GAS)
  setInterval(() => {
    fetchData();
  }, 60000);

  // Bind Exit button inside Drawer
  const exitBtn = document.getElementById('exit-btn');
  const exitModal = document.getElementById('exit-modal');
  const exitModalCancel = document.getElementById('exit-modal-cancel-btn');
  const exitModalYes = document.getElementById('exit-modal-yes-btn');

  if (exitBtn) {
    exitBtn.addEventListener('click', () => {
      closeDrawer();
      if (exitModal) exitModal.style.display = 'flex';
    });
  }

  if (exitModalCancel) {
    exitModalCancel.addEventListener('click', () => {
      if (exitModal) exitModal.style.display = 'none';
    });
  }

  if (exitModalYes) {
    exitModalYes.addEventListener('click', () => {
      window.location.href = '../index.html'; // Go back to mobile dashboard
    });
  }

  // Bind Auth Page Back Button
  const authBackBtn = document.getElementById('auth-back-btn');
  if (authBackBtn) {
    authBackBtn.addEventListener('click', closeAuthPage);
  }

  // Bind Logout Button
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      clearCachedAuth();
      showToast("Logged out successfully", "success");
      toggleDrawer();
    });
  }

  // Bind PIN inputs digit behavior
  bindAuthPinInputs();

  // Update drawer logout button state on boot
  updateDrawerLogoutButton();

  // Bind Lightbox modal
  const lightboxModal = document.getElementById('lightbox-modal');
  if (lightboxModal) {
    lightboxModal.addEventListener('click', hideLightbox);
  }
  const lightboxCloseBtn = document.getElementById('lightbox-close-btn');
  if (lightboxCloseBtn) {
    lightboxCloseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      hideLightbox();
    });
  }

  // Bind Logs Page Back Button
  const logsBackBtn = document.getElementById('logs-back-btn');
  if (logsBackBtn) {
    logsBackBtn.addEventListener('click', closeLogsPage);
  }

  // Display version number
  const versionSpan = document.getElementById('app-version');
  if (versionSpan) {
    versionSpan.textContent = `Trial Version : ${APP_VERSION}`;
  }

  // Load from cache first, then fetch live data
  // Load from cache first
  loadCachedData();

  // Load cached users immediately from localStorage so PIN screen has it
  const cachedUsers = localStorage.getItem('driver_users');
  if (cachedUsers) {
    try {
      allUsers = JSON.parse(cachedUsers);
    } catch (e) {
      allUsers = [];
    }
  }

  fetchSupportData();
  fetchData();

  // Set initial page view
  switchPage(activeTab);

  // Initialize job toggle switch
  initJobToggle();

  // Bind Unload & Return Proof Modal events
  bindUnloadProofModal();

  // Bind Deliver Page events
  bindDeliverPageEvents();

  // Enforce mandatory login on app open
  if (!isSessionAuthenticated()) {
    setTimeout(() => {
      openAuthPage(true);
    }, 500);
  }
});

function toggleDrawer() {
  const drawer = document.getElementById('drawer');
  const drawerOverlay = document.getElementById('drawer-overlay');
  if (drawer && drawerOverlay) {
    drawer.classList.toggle('active');
    drawerOverlay.classList.toggle('active');
  }
}

function closeDrawer() {
  const drawer = document.getElementById('drawer');
  const drawerOverlay = document.getElementById('drawer-overlay');
  if (drawer && drawerOverlay) {
    drawer.classList.remove('active');
    drawerOverlay.classList.remove('active');
  }
}

// Handle routing/switching pages
// Handle routing/switching pages
function switchPage(pageName) {
  activeTab = pageName;
  if (pageName !== 'Route Map') {
    clearMapOrderDetails();
  }

  // Update active Drawer menu item states
  const drawerItems = document.querySelectorAll('.drawer-item');
  drawerItems.forEach(item => {
    const menuVal = item.getAttribute('data-menu');
    if (menuVal === pageName) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Update header title of the active section
  const menuLabel = document.getElementById('active-menu-label');
  if (menuLabel) {
    menuLabel.textContent = pageName;
  }

  // Show/Hide page views based on active tab selection
  const blankPageView = document.getElementById('blank-page-view');
  const mapPageView = document.getElementById('map-page-container');
  const ordersListView = document.getElementById('orders-list');
  const deliverOrderPageView = document.getElementById('deliver-order-page-view');
  const returnOrderPageView = document.getElementById('return-order-page-view');
  const searchContainer = document.getElementById('search-bar-container');
  const subheaderBar = document.getElementById('subheader-bar');
  const contentHeaderRow = document.getElementById('content-header-row');
  const mobileContent = document.querySelector('.mobile-content');

  collapseSearch(false);

  // Hide all view containers first
  if (blankPageView) blankPageView.classList.add('hidden');
  if (mapPageView) mapPageView.classList.add('hidden');
  if (ordersListView) ordersListView.classList.add('hidden');
  if (deliverOrderPageView) deliverOrderPageView.classList.add('hidden');
  if (returnOrderPageView) returnOrderPageView.classList.add('hidden');
  if (searchContainer) searchContainer.classList.add('hidden');
  if (subheaderBar) subheaderBar.style.display = 'none';

  if (pageName === 'Complete') {
    if (mobileContent) mobileContent.classList.remove('map-active');
    if (contentHeaderRow) contentHeaderRow.classList.remove('hidden');
    if (ordersListView) ordersListView.classList.remove('hidden');
    if (searchContainer) searchContainer.classList.remove('hidden');
    if (subheaderBar) subheaderBar.style.display = 'flex';
  } else if (pageName === 'Route Map') {
    if (mobileContent) mobileContent.classList.add('map-active');
    if (contentHeaderRow) contentHeaderRow.classList.add('hidden');
    if (mapPageView) mapPageView.classList.remove('hidden');
    
    // Initialize or refresh Leaflet map
    setTimeout(() => {
      initMap();
    }, 100);
  } else if (pageName === 'Delivery Order') {
    if (mobileContent) mobileContent.classList.remove('map-active');
    if (contentHeaderRow) contentHeaderRow.classList.remove('hidden');
    if (deliverOrderPageView) deliverOrderPageView.classList.remove('hidden');
  } else if (pageName === 'Return Order') {
    if (mobileContent) mobileContent.classList.remove('map-active');
    if (contentHeaderRow) contentHeaderRow.classList.remove('hidden');
    if (returnOrderPageView) returnOrderPageView.classList.remove('hidden');
  } else {
    if (mobileContent) mobileContent.classList.remove('map-active');
    if (contentHeaderRow) contentHeaderRow.classList.remove('hidden');
    if (blankPageView) {
      blankPageView.classList.remove('hidden');
      blankPageView.textContent = pageName; // Dynamic title set in center
    }
  }

  renderActivePage();
}

function renderActivePage() {
  if (activeTab === 'Complete') {
    renderOrdersList();
  } else if (activeTab === 'Route Map') {
    renderMapPins();
    renderOnModeList();
  } else if (activeTab === 'Delivery Order') {
    renderDeliverOrderPage();
  } else if (activeTab === 'Return Order') {
    renderReturnOrderPage();
  }
  updateJobToggleDisabledState();
}

function setDeliverOrderTab(tab) {
  activeDeliverOrderTab = tab;
  renderDeliverOrderPage();
}

function setReturnOrderTab(tab) {
  activeReturnOrderTab = tab;
  renderReturnOrderPage();
}

window.setDeliverOrderTab = setDeliverOrderTab;
window.setReturnOrderTab = setReturnOrderTab;

function renderJobCardHTML(order, statusText) {
  const mark = order.Mark || "-";
  const postcode = order.Poscode || "N/A";
  const zone = getZoneFromPostcode(postcode);
  const doNum = order.ID || order.id || "UNKNOWN";
  const deliverTo = order.Deliver_To || order.deliver_to || order.DeliverTo || "N/A";
  const deliverToTrunc = deliverTo.length > 22 ? deliverTo.substring(0, 22) + "..." : deliverTo;
  
  // Badge for order type
  const typeClean = (order.Type || 'Normal').trim().toUpperCase();
  let typeBadgeHtml = `<span style="font-size: 9px; font-weight: 750; background-color: #F1F5F9; color: #475569; padding: 2px 8px; border-radius: 12px; text-transform: uppercase;">${typeClean}</span>`;
  if (typeClean === "URGENT") {
    typeBadgeHtml = `<span style="font-size: 9px; font-weight: 750; background-color: #FEE2E2; color: #EF4444; padding: 2px 8px; border-radius: 12px; text-transform: uppercase;">URGENT</span>`;
  } else if (typeClean === "APPOINTMENT") {
    typeBadgeHtml = `<span style="font-size: 9px; font-weight: 750; background-color: #FEF3C7; color: #D97706; padding: 2px 8px; border-radius: 12px; text-transform: uppercase;">APPT</span>`;
  }
  
  let timeAgoText = "Today";
  const dateVal = order.Date || "";
  if (dateVal) {
    const d = new Date(Number(dateVal));
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      timeAgoText = `${day}/${month}`;
    }
  }

  const isRet = (order.Mark || '').trim().toUpperCase().startsWith('R');
  const markBg = isRet ? "#F5F3FF" : "#FFF8F2"; 
  const markTextCol = isRet ? "#7C3AED" : "#EA580C"; 

  return `
    <div style="background-color: #FFFFFF; border: 1.5px solid var(--border-color); border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); overflow: hidden; display: flex; flex-direction: column; width: 100%; box-sizing: border-box; pointer-events: none; user-select: none;">
      <!-- Top Section -->
      <div style="display: flex; gap: 14px; padding: 14px; align-items: center;">
        <div style="background-color: ${markBg}; color: ${markTextCol}; width: 50px; height: 50px; border-radius: 12px; font-size: 20px; font-weight: 850; display: flex; align-items: center; justify-content: center; flex-shrink: 0; border: 1px solid rgba(0,0,0,0.02);">
          ${mark}
        </div>
        <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;">
          <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
            <span style="font-size: 14px; font-weight: 850; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 70%;">${doNum}</span>
            <span style="font-size: 10px; color: var(--text-muted); font-weight: 600;">${timeAgoText}</span>
          </div>
          <div style="font-size: 12px; color: var(--text-secondary); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${deliverToTrunc}
          </div>
          <div style="display: flex; gap: 6px; align-items: center; margin-top: 4px;">
            <span style="font-size: 9px; font-weight: 750; background-color: #EFF6FF; color: #1E40AF; padding: 2px 8px; border-radius: 12px; text-transform: uppercase;">${zone}</span>
            ${typeBadgeHtml}
          </div>
        </div>
      </div>
      <!-- Bottom Status bar -->
      <div style="background-color: #F8FAFC; border-top: 1.5px solid var(--border-color); padding: 10px 14px; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 11px; font-weight: 750; color: #475569;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 13px; height: 13px; color: var(--app-color);">
          <rect x="1" y="3" width="15" height="13"></rect>
          <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon>
          <circle cx="5.5" cy="18.5" r="2.5"></circle>
          <circle cx="18.5" cy="18.5" r="2.5"></circle>
        </svg>
        ${statusText}
      </div>
    </div>
  `;
}

function renderDeliverOrderPage() {
  const driverName = getCachedAuth() || "";
  const inprogressTab = document.getElementById('deliver-tab-inprogress');
  const pendingTab = document.getElementById('deliver-tab-pending');
  const countEl = document.getElementById('deliver-order-count');
  const cardsContainer = document.getElementById('deliver-order-list-cards');

  if (!inprogressTab || !pendingTab || !cardsContainer) return;

  if (activeDeliverOrderTab === "inprogress") {
    inprogressTab.style.backgroundColor = "var(--app-color)";
    inprogressTab.style.color = "#FFFFFF";
    pendingTab.style.backgroundColor = "transparent";
    pendingTab.style.color = "var(--text-secondary)";
  } else {
    pendingTab.style.backgroundColor = "var(--app-color)";
    pendingTab.style.color = "#FFFFFF";
    inprogressTab.style.backgroundColor = "transparent";
    inprogressTab.style.color = "var(--text-secondary)";
  }

  const isReturnOrder = (order) => {
    const m = (order.Mark || '').trim().toUpperCase();
    return m.startsWith('R');
  };

  let filtered = [];
  if (activeDeliverOrderTab === "inprogress") {
    filtered = allOrders.filter(o => 
      !isReturnOrder(o) &&
      (o.Driver || "").trim() === driverName &&
      ((o.Status || "").trim().toLowerCase() === "load" || (o.Status || "").trim().toLowerCase() === "out for delivery")
    );
  } else {
    filtered = allOrders.filter(o => 
      !isReturnOrder(o) &&
      ((o.Status || "").trim().toLowerCase() === "ready to pick" || 
       (o.Status || "").trim().toLowerCase() === "picking" || 
       (o.Status || "").trim().toLowerCase() === "ready to deliver")
    );
  }

  if (countEl) countEl.textContent = `Total Orders: ${filtered.length}`;

  if (filtered.length === 0) {
    cardsContainer.innerHTML = `<div class="map-placeholder-text" style="padding: 40px 0;">No delivery orders found.</div>`;
    return;
  }

  cardsContainer.innerHTML = filtered.map(order => {
    let statusText = "Ready to Pick";
    const st = (order.Status || "").trim().toLowerCase();
    if (st === "picking") statusText = "Picking in Progress";
    else if (st === "ready to deliver") statusText = "Goods Ready";
    else if (st === "load") statusText = "Loaded on Vehicle";
    else if (st === "out for delivery") statusText = "Out for Delivery";
    
    return renderJobCardHTML(order, statusText);
  }).join('');
}

function renderReturnOrderPage() {
  const driverName = getCachedAuth() || "";
  const inprogressTab = document.getElementById('return-tab-inprogress');
  const pendingTab = document.getElementById('return-tab-pending');
  const countEl = document.getElementById('return-order-count');
  const cardsContainer = document.getElementById('return-order-list-cards');

  if (!inprogressTab || !pendingTab || !cardsContainer) return;

  if (activeReturnOrderTab === "inprogress") {
    inprogressTab.style.backgroundColor = "var(--app-color)";
    inprogressTab.style.color = "#FFFFFF";
    pendingTab.style.backgroundColor = "transparent";
    pendingTab.style.color = "var(--text-secondary)";
  } else {
    pendingTab.style.backgroundColor = "var(--app-color)";
    pendingTab.style.color = "#FFFFFF";
    inprogressTab.style.backgroundColor = "transparent";
    inprogressTab.style.color = "var(--text-secondary)";
  }

  const isReturnOrder = (order) => {
    const m = (order.Mark || '').trim().toUpperCase();
    return m.startsWith('R');
  };

  let filtered = [];
  if (activeReturnOrderTab === "inprogress") {
    filtered = allOrders.filter(o => 
      isReturnOrder(o) &&
      (o.Driver || "").trim() === driverName &&
      (o.Status || "").trim().toLowerCase() === "pending"
    );
  } else {
    filtered = allOrders.filter(o => 
      isReturnOrder(o) &&
      (o.Driver || "").trim() !== driverName &&
      (o.Status || "").trim().toLowerCase() === "pending"
    );
  }

  if (countEl) countEl.textContent = `Total Orders: ${filtered.length}`;

  if (filtered.length === 0) {
    cardsContainer.innerHTML = `<div class="map-placeholder-text" style="padding: 40px 0;">No return orders found.</div>`;
    return;
  }

  cardsContainer.innerHTML = filtered.map(order => {
    const isAssigned = (order.Driver || "").trim() === driverName;
    const statusText = isAssigned ? "Assigned to You" : "Available for Pickup";
    return renderJobCardHTML(order, statusText);
  }).join('');
}

function openWhatsAppShareFromComplete(orderId) {
  const order = allOrders.find(o => o.ID === orderId);
  if (!order) return;
  
  const isReturn = (order.Mark || '').trim().toUpperCase().startsWith('R') || 
                    (order.Status || '').trim().toUpperCase() === 'COLLECTED';
  const items = typeof order.Items === 'string' ? JSON.parse(order.Items || '[]') : (order.Items || []);
  
  const itemQtys = {};
  items.forEach(item => {
    itemQtys[item.sku] = item.qty;
  });
  
  showWhatsAppShare(order, isReturn, items, itemQtys);
}

window.openWhatsAppShareFromComplete = openWhatsAppShareFromComplete;

// Fetch shared Track_Orders sheet from Worker API
async function fetchData() {
  if (isFetchingData) return;
  isFetchingData = true;

  const refreshIcon = document.getElementById('refresh-icon');
  const drawerRefreshIcon = document.getElementById('drawer-refresh-icon');
  if (refreshIcon) refreshIcon.classList.add('spinning');
  if (drawerRefreshIcon) drawerRefreshIcon.classList.add('spinning');

  try {
    const response = await fetch(`${WORKER_URL}/api/app/driver/Track_Orders?t=${Date.now()}`);
    if (!response.ok) {
      throw new Error(`Worker API returned status ${response.status}`);
    }

    const data = await response.json();
    let ordersList = [];
    if (Array.isArray(data)) {
      ordersList = data;
    } else if (data && Array.isArray(data.value)) {
      ordersList = data.value;
    } else {
      throw new Error("Invalid database format response");
    }

    allOrders = ordersList;
    localStorage.setItem('driver_orders', JSON.stringify(ordersList));
  } catch (err) {
    console.error("Failed to load orders from Worker API:", err);
    showToast("Server offline", "error");
    // If failed, check localStorage for cached data
    const cached = localStorage.getItem('driver_orders');
    if (cached) {
      try {
        allOrders = JSON.parse(cached);
      } catch (e) {
        allOrders = [];
      }
    } else {
      allOrders = [];
    }
  } finally {
    isFetchingData = false;
    if (refreshIcon) refreshIcon.classList.remove('spinning');
    if (drawerRefreshIcon) drawerRefreshIcon.classList.remove('spinning');
    lastRefreshTime = Date.now();
    renderActivePage();
  }
}

// Load cached data on initialization
function loadCachedData() {
  const cached = localStorage.getItem('driver_orders');
  if (cached) {
    try {
      allOrders = JSON.parse(cached);
    } catch (e) {
      allOrders = [];
    }
  } else {
    allOrders = [];
  }
  renderActivePage();
}

// Render the order list or the blank pages
function renderOrdersList() {
  const listContainer = document.getElementById('orders-list');
  const qtyDisplay = document.getElementById('qty-count-display');
  if (!listContainer) return;

  listContainer.innerHTML = '';

  if (activeTab !== 'Complete') {
    return; // Non-complete pages are handled by #blank-page-view element in index.html
  }

  // Complete page implementation matching Picker App 100%
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let completedOrders = allOrders.filter(o => 
    (o.Status === 'Delivered' || o.Status === 'Collected') && Number(o.Timestamp || 0) >= thirtyDaysAgo
  );

  // Search filter
  if (searchQuery.trim() !== '') {
    const query = searchQuery.toLowerCase().trim();
    completedOrders = completedOrders.filter(order => {
      const idMatch = (order.ID || '').toLowerCase().includes(query);
      const deliverMatch = (order.Deliver_To || '').toLowerCase().includes(query);
      const doMatch = (order.DO_Number || order.do_number || '').toLowerCase().includes(query);
      return idMatch || deliverMatch || doMatch;
    });
  }
  
  // Sort latest first
  completedOrders.sort((a, b) => Number(b.Timestamp || 0) - Number(a.Timestamp || 0));
  
  if (qtyDisplay) {
    qtyDisplay.textContent = `Completed (30d): ${completedOrders.length}`;
  }
  
  if (completedOrders.length === 0) {
    listContainer.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <div class="empty-text">No Complete Orders</div>
        <div class="empty-subtext">Delivered orders in the last 30 days will appear here.</div>
      </div>
    `;
    return;
  }

  // Group by date
  const groups = {};
  const groupOrder = []; // To keep track of the date headers sorted latest first
  
  completedOrders.forEach(order => {
    const ts = Number(order.Timestamp || 0);
    const d = new Date(ts);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    const dateStr = `${day}/${month}/${year}`;
    
    if (!groups[dateStr]) {
      groups[dateStr] = [];
      groupOrder.push(dateStr);
    }
    groups[dateStr].push(order);
  });

  let html = '<div class="directory-groups-container" style="width: 100%; display: flex; flex-direction: column; gap: 16px; box-sizing: border-box; padding-bottom: 20px;">';
  
  groupOrder.forEach(dateStr => {
    const ordersInGroup = groups[dateStr];
    html += `
      <div class="directory-date-group" style="display: flex; flex-direction: column; gap: 4px;">
        <div style="background-color: #E2E8F0; padding: 6px 12px; font-weight: 800; color: #475569; font-size: 11px; text-align: left; border-radius: 6px; text-transform: uppercase; letter-spacing: 0.05em;">
          ${dateStr}
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left;">
          <tbody>
    `;
    
    ordersInGroup.forEach(order => {
      const displayId = order.ID || 'UNKNOWN';
      const deliverToVal = order.Deliver_To || order.deliver_to || order.DeliverTo || '';
      const truncatedDeliver = deliverToVal.length > 12 ? deliverToVal.substring(0, 12) + '...' : deliverToVal;
      
      const method = (order.Deliver_Method || order.deliver_method || "").trim().toLowerCase();
      const isCompanyDelivery = method === "company delivery" || method === "company vehicle";
      
      let shareBtnHtml = '';
      if (isCompanyDelivery) {
        shareBtnHtml = `
          <button onclick="openWhatsAppShareFromComplete('${order.ID}')" style="background: none; border: none; padding: 6px; cursor: pointer; color: #25D366; display: inline-flex; align-items: center; justify-content: center; outline: none; -webkit-tap-highlight-color: transparent; margin-right: 4px;" title="Share to WhatsApp">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" style="width: 15px; height: 15px;">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
            </svg>
          </button>
        `;
      }
      
      html += `
        <tr style="border-bottom: 1px solid #E2E8F0;">
          <td style="padding: 12px 4px; color: #1E293B; font-weight: 600; font-family: monospace;">
            ${displayId} - <span style="font-family: inherit; font-weight: 500; color: #64748B;">${truncatedDeliver}</span>
          </td>
          <td style="padding: 12px 4px; text-align: right; width: 80px; white-space: nowrap;">
            ${shareBtnHtml}
            <button class="complete-order-logs-btn" data-id="${order.ID}" style="background: none; border: none; padding: 6px; cursor: pointer; color: var(--app-color); display: inline-flex; align-items: center; justify-content: center; outline: none; -webkit-tap-highlight-color: transparent;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" style="width: 15px; height: 15px;">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
              </svg>
            </button>
          </td>
        </tr>
      `;
    });
    
    html += `
          </tbody>
        </table>
      </div>
    `;
  });
  
  html += '</div>';
  listContainer.innerHTML = html;

  // Bind logs buttons
  listContainer.querySelectorAll('.complete-order-logs-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const oId = btn.getAttribute('data-id');
      const matchingOrder = allOrders.find(o => o.ID === oId);
      if (matchingOrder) {
        openLogsPage(matchingOrder);
      }
    });
  });
}

// Custom Toast Notification System matching Merchandiser App
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
  if (type === 'success' || msgLower.includes('success') || msgLower.includes('submitted') || msgLower.includes('saved') || msgLower.includes('completed') || msgLower.includes('updated')) {
    toast.classList.add('success');
    iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="toast-icon success-icon"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
  } else if (type === 'error' || msgLower.includes('error') || msgLower.includes('fail') || msgLower.includes('incorrect') || msgLower.includes('denied') || msgLower.includes('missing')) {
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

// Collapse and clear the expandable search bar
function collapseSearch(shouldRender = true) {
  const searchContainer = document.getElementById('search-bar-container');
  const searchInput = document.getElementById('order-search-input');
  const searchClearBtn = document.getElementById('search-clear-btn');
  
  if (searchContainer) {
    searchContainer.classList.remove('expanded');
  }
  if (searchInput) {
    searchInput.value = '';
  }
  if (searchClearBtn) {
    searchClearBtn.classList.add('hidden');
  }
  searchQuery = '';
  if (shouldRender) {
    renderOrdersList();
  }
}

// Fetch support metadata sheets: Driver_Users and Products
async function fetchSupportData() {
  const cachedUsers = localStorage.getItem('driver_users');
  if (cachedUsers) allUsers = JSON.parse(cachedUsers);

  const cachedProducts = localStorage.getItem('driver_products');
  if (cachedProducts) allProducts = JSON.parse(cachedProducts);

  const cachedBrands = localStorage.getItem('driver_brands');
  if (cachedBrands) allBrands = JSON.parse(cachedBrands);

  try {
    const [userRes, prodRes, brandRes] = await Promise.all([
      fetch(`${WORKER_URL}/api/app/driver/users?t=${Date.now()}`),
      fetch(`${WORKER_URL}/api/app/picker/products?t=${Date.now()}`),
      fetch(`${WORKER_URL}/api/app/picker/brands?t=${Date.now()}`)
    ]);

    if (userRes.ok) {
      const userData = await userRes.json();
      allUsers = userData.value || userData;
      localStorage.setItem('driver_users', JSON.stringify(allUsers));
    }

    if (prodRes.ok) {
      const prodData = await prodRes.json();
      allProducts = prodData.value || prodData;
      localStorage.setItem('driver_products', JSON.stringify(allProducts));
    }

    if (brandRes.ok) {
      const brandData = await brandRes.json();
      allBrands = brandData.value || brandData;
      localStorage.setItem('driver_brands', JSON.stringify(allBrands));
    }
  } catch (err) {
    console.error("Failed to fetch support metadata:", err);
  }
}

// Cache Authentication functions
function isSessionAuthenticated() {
  return sessionStorage.getItem('driver_session_active') === 'true' && localStorage.getItem('auth_driver_name') !== null;
}

function getCachedAuth() {
  if (!isSessionAuthenticated()) {
    return null;
  }
  return localStorage.getItem('auth_driver_name');
}

function setCachedAuth(matchedUser) {
  const name = matchedUser.Name || matchedUser.name || 'Driver';
  localStorage.setItem('auth_driver_name', name);
  localStorage.setItem('auth_driver_user', JSON.stringify(matchedUser));
  sessionStorage.setItem('driver_session_active', 'true');
  updateDrawerLogoutButton();
}

function clearCachedAuth() {
  localStorage.removeItem('auth_driver_name');
  localStorage.removeItem('auth_driver_user');
  sessionStorage.removeItem('driver_session_active');
  updateDrawerLogoutButton();
  openAuthPage(true); // Always force login again when logging out
}

function updateDrawerLogoutButton() {
  const name = getCachedAuth();
  const logoutBtn = document.getElementById('logout-btn');
  const nameSpan = document.getElementById('logout-driver-name');
  
  if (name) {
    if (nameSpan) nameSpan.textContent = name;
    if (logoutBtn) logoutBtn.classList.remove('hidden');
  } else {
    if (logoutBtn) logoutBtn.classList.add('hidden');
  }
  updateJobToggleDisabledState();
}

// Auth Page View Controllers
function openAuthPage(isMandatory = false) {
  const authPage = document.getElementById('auth-page');
  if (!authPage) return;

  clearAuthPin();
  authPage.classList.add('active');

  const authBackBtn = document.getElementById('auth-back-btn');
  if (authBackBtn) {
    if (isMandatory) {
      authBackBtn.style.display = 'none';
    } else {
      authBackBtn.style.display = 'flex';
    }
  }
}

function closeAuthPage() {
  const authPage = document.getElementById('auth-page');
  if (authPage) {
    authPage.classList.remove('active');
  }
}

function clearAuthPin() {
  const pinInput = document.getElementById('auth-pin-input');
  if (pinInput) {
    pinInput.value = '';
  }
  const hiddenInput = document.getElementById('auth-pin-hidden');
  if (hiddenInput) {
    hiddenInput.value = '';
    hiddenInput.classList.remove('error');
  }
  const displays = document.querySelectorAll('#auth-page .pin-digit-display');
  displays.forEach((display, idx) => {
    display.textContent = '';
    display.classList.remove('error');
    if (idx === 0) {
      display.classList.add('active');
    } else {
      display.classList.remove('active');
    }
  });
  if (hiddenInput) {
    setTimeout(() => {
      hiddenInput.focus();
    }, 200);
  }
}

function bindAuthPinInputs() {
  const hiddenInput = document.getElementById('auth-pin-hidden');
  const displays = document.querySelectorAll('#auth-page .pin-digit-display');
  const pinInput = document.getElementById('auth-pin-input');
  const wrapper = document.getElementById('pin-digits-wrapper');

  if (!hiddenInput || !wrapper) return;

  // Clicking wrapper focuses the hidden input
  wrapper.addEventListener('click', () => {
    hiddenInput.focus();
  });

  hiddenInput.addEventListener('input', (e) => {
    let val = hiddenInput.value.replace(/[^0-9]/g, '');
    if (val.length > 4) {
      val = val.substring(0, 4);
    }
    hiddenInput.value = val;
    if (pinInput) pinInput.value = val;

    // Update displays
    displays.forEach((display, idx) => {
      if (idx < val.length) {
        display.textContent = '●'; // Masked character
        display.classList.remove('active');
      } else {
        display.textContent = '';
        if (idx === val.length) {
          display.classList.add('active'); // Current focus indicator
        } else {
          display.classList.remove('active');
        }
      }
    });

    // Auto enter when 4 digits are completed
    if (val.length === 4) {
      hiddenInput.blur();
      submitProofPIN(val);
    }
  });

  hiddenInput.addEventListener('focus', () => {
    const val = hiddenInput.value;
    displays.forEach((display, idx) => {
      if (idx === val.length) {
        display.classList.add('active');
      } else {
        display.classList.remove('active');
      }
    });
  });

  hiddenInput.addEventListener('blur', () => {
    displays.forEach(display => display.classList.remove('active'));
  });
}

// Authenticate PIN
async function submitProofPIN(pin) {
  const enteredPin = parseInt(pin);
  const matchedUser = allUsers.find(u => parseInt(u.PIN || u.pin) === enteredPin);
  
  if (!matchedUser) {
    const hiddenInput = document.getElementById('auth-pin-hidden');
    if (hiddenInput) hiddenInput.classList.add('error');
    const displays = document.querySelectorAll('#auth-page .pin-digit-display');
    displays.forEach(display => {
      display.classList.add('error');
    });
    showToast("Incorrect PIN. Please try again.", "error");
    
    // Clear and reset focus after error shake animation finishes
    setTimeout(() => {
      clearAuthPin();
    }, 600);
    return;
  }

  const driverName = matchedUser.Name || matchedUser.name || 'Driver';
  
  // Save credentials and session
  setCachedAuth(matchedUser);
  closeAuthPage();

  // Fetch fresh data only if we are not executing a pending action
  if (!authPendingAction) {
    fetchSupportData();
    fetchData();
  }

  if (authPendingAction) {
    const order = allOrders.find(o => o.ID === authPendingAction.orderId);
    if (order) {
      if (authPendingAction.type === 'load_goods') {
        loadingGoodsOrderId = order.ID;
        tickedSKUs.clear();
        if (activeTab === 'Route Map') {
          const fallbackPin = { color: "#E28B54", textColor: "#FFFFFF" };
          renderMapOrderDetails(order, fallbackPin);
        }
      } else if (authPendingAction.type === 'go_to_destination') {
        performGoToDestination(order, driverName);
      } else if (authPendingAction.type === 'complete_delivery') {
        performCompleteDelivery(order, driverName);
      } else if (authPendingAction.type === 'pick_return') {
        performPickReturnPaper(order, driverName, authPendingAction.photoFile);
      } else if (authPendingAction.type === 'deliver_goods') {
        performDeliverGoods(
          order,
          driverName,
          authPendingAction.isReturn,
          authPendingAction.signedFile,
          authPendingAction.supportingFiles,
          authPendingAction.itemQtys,
          authPendingAction.itemRemarks
        );
      }
    }
    authPendingAction = null;
  }
}

async function performPickReturnPaper(order, driverName, photoFile) {
  showToast("Uploading proof and syncing...", "info");

  try {
    const compressedFile = await compressImageToMax250kb(photoFile);
    const doNumber = order.DO_Number || order.do_number || 'UNKNOWN';
    const fileName = `Track_Orders/Return_Proof/${doNumber}_${Date.now()}.jpg`;
    const uploadUrl = `${WORKER_URL}/api/upload?filename=${encodeURIComponent(fileName)}`;

    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: compressedFile
    });

    let photoUrl = '';
    if (uploadRes.ok) {
      const uploadData = await uploadRes.json();
      if (uploadData.success) {
        photoUrl = uploadData.url;
      } else {
        throw new Error("Upload response success=false");
      }
    } else {
      throw new Error(`Upload failed with status ${uploadRes.status}`);
    }

    let logs = [];
    try {
      logs = JSON.parse(order.Logs || '[]');
    } catch (_) {}

    logs.push({
      action: "Pick Return Paper",
      actionBy: driverName,
      remark: "Return Paper photo submitted",
      timestamp: Date.now(),
      photoUrl: photoUrl
    });

    await silentSyncOrderUpdate(order.ID, {
      Driver: driverName,
      Photo_Return_Paper: photoUrl,
      Logs: JSON.stringify(logs)
    });

    showToast("Return Paper submitted successfully!", "success");
    returnPaperPhotoFile = null;
    
    // Re-render pins and reload details
    renderMapPins();
    const updatedOrder = allOrders.find(o => o.ID === order.ID);
    if (updatedOrder) {
      const activePin = { color: "#7C3AED", textColor: "#FFFFFF" };
      renderMapOrderDetails(updatedOrder, activePin);
    }
  } catch (err) {
    console.error("Failed to pick return paper:", err);
    showToast(`Failed: ${err.message}`, "error");
  }
}

async function uploadToR2(fileName, file) {
  const uploadUrl = `${WORKER_URL}/api/upload?filename=${encodeURIComponent(fileName)}`;
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg' },
    body: file
  });
  if (!res.ok) throw new Error(`Upload failed with status ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error("Upload response success=false");
  return data.url;
}

async function performDeliverGoods(order, driverName, isReturn, signedFile, supportingFiles, itemQtys, itemRemarks) {
  // --- 1. INSTANT OPTIMISTIC UI UPDATE ---
  const previousStatus = order.Status;
  
  // Update status locally in memory immediately
  order.Status = isReturn ? "Collected" : "Delivered";

  // Close the deliver page overlay instantly
  const deliverPage = document.getElementById('deliver-page');
  if (deliverPage) deliverPage.classList.remove('active');

  // Re-render map and timeline immediately (the completed card hides instantly)
  renderMapPins();
  renderOnModeList();

  const items = typeof order.Items === 'string' ? JSON.parse(order.Items || '[]') : (order.Items || []);

  // Display WhatsApp share drawer instantly using local photo files
  showWhatsAppShare(order, isReturn, items, itemQtys);

  // --- 2. SILENT BACKGROUND SYNCHRONIZATION ---
  runSilentBackgroundSync(order, driverName, isReturn, signedFile, supportingFiles, itemQtys, itemRemarks, previousStatus).catch(err => {
    console.error("Silent background sync failed:", err);
    showToast(`Sync failed: ${err.message}. Reverting status...`, "error");

    // Rollback status in memory on error
    order.Status = previousStatus;
    renderMapPins();
    renderOnModeList();
  });
}

async function runSilentBackgroundSync(order, driverName, isReturn, signedFile, supportingFiles, itemQtys, itemRemarks, previousStatus) {
  const doNumber = order.DO_Number || order.do_number || 'UNKNOWN';

  // 1. Upload Signed DO / Return Paper
  const compSigned = await compressImageToMax250kb(signedFile);
  const signedFolder = isReturn ? "Return_Proof_Admin" : "Signed_DO";
  const signedFileName = `Track_Orders/${signedFolder}/${doNumber}_signed_${Date.now()}.jpg`;
  const signedUrl = await uploadToR2(signedFileName, compSigned);

  // 2. Upload Supporting photos
  const supportingUrls = [];
  for (let i = 0; i < supportingFiles.length; i++) {
    const comp = await compressImageToMax250kb(supportingFiles[i]);
    const fileName = `Track_Orders/Delivery_Proof/${doNumber}_proof_${i}_${Date.now()}.jpg`;
    const url = await uploadToR2(fileName, comp);
    supportingUrls.push(url);
  }
  const supportingPhotoVal = JSON.stringify(supportingUrls);

  let logs = [];
  try {
    logs = JSON.parse(order.Logs || '[]');
  } catch (_) {}

  const activeJobId = localStorage.getItem('active_job_id');
  let deliveredRecord = [];
  try {
    deliveredRecord = JSON.parse(localStorage.getItem('active_job_delivered_record') || '[]');
  } catch (_) {}

  if (isReturn) {
    // --- COLLECT RETURN FLOW ---
    logs.push({
      action: "Unpick Return Paper",
      actionBy: driverName,
      remark: "Returned paper given to admin",
      timestamp: Date.now(),
      photoUrl: signedUrl
    });

    await silentSyncOrderUpdate(order.ID, {
      Status: "Collected",
      Photo_Return_Paper_Admin: signedUrl,
      Photo_Delivered_Proof: supportingPhotoVal,
      Logs: JSON.stringify(logs)
    });

    // Update Deliver_Job details
    deliveredRecord.push({
      id: order.ID,
      timestamp: Date.now(),
      signed_paper_img: signedUrl
    });
    await saveJobAndRemoveOrder(activeJobId, order.ID, deliveredRecord);

    showToast("Return collected successfully!", "success");

  } else {
    // --- DELIVER GOODS FLOW ---
    const discrepancies = [];
    const items = typeof order.Items === 'string' ? JSON.parse(order.Items || '[]') : (order.Items || []);
    items.forEach(item => {
      const currentQty = itemQtys[item.sku] !== undefined ? itemQtys[item.sku] : item.qty;
      if (currentQty < item.qty) {
        discrepancies.push({
          sku: item.sku,
          qty_ordered: item.qty,
          qty_delivered: currentQty,
          remark: itemRemarks[item.sku] || ''
        });
      }
    });

    const remarkText = discrepancies.length > 0
      ? `Delivered with discrepancies: ${discrepancies.map(d => `${d.sku} qty ${d.qty_delivered}/${d.qty_ordered} (${d.remark})`).join(', ')}`
      : "Delivered successfully";

    logs.push({
      action: "Delivered",
      actionBy: driverName,
      remark: remarkText,
      timestamp: Date.now(),
      photoUrl: signedUrl
    });

    await silentSyncOrderUpdate(order.ID, {
      Status: "Delivered",
      Photo_DO_Paper_Signed: signedUrl,
      Photo_Delivered_Proof: supportingPhotoVal,
      Logs: JSON.stringify(logs)
    });

    // Update Deliver_Job details
    deliveredRecord.push({
      id: order.ID,
      timestamp: Date.now(),
      signed_paper_img: signedUrl,
      discrepancies: discrepancies
    });
    await saveJobAndRemoveOrder(activeJobId, order.ID, deliveredRecord);

    showToast("Goods delivered successfully!", "success");
  }
}



async function saveJobAndRemoveOrder(jobId, orderId, deliveredRecord) {
  if (!jobId) return;

  localStorage.setItem('active_job_delivered_record', JSON.stringify(deliveredRecord));

  const driverName = getCachedAuth();
  const activeDeliverOrders = allOrders.filter(o => 
    (String(o.Mark || '').trim().toUpperCase().startsWith('R') === false) &&
    (o.Status || "").trim().toLowerCase() === "out for delivery" &&
    (o.Driver || "").trim() === driverName
  );
  const activeReturnOrders = allOrders.filter(o => 
    (String(o.Mark || '').trim().toUpperCase().startsWith('R') === true) &&
    (o.Status || "").trim().toLowerCase() === "pending" && 
    (o.Driver || "").trim() === driverName
  );
  const activeOrderIds = [
    ...activeDeliverOrders.map(o => o.ID),
    ...activeReturnOrders.map(o => o.ID)
  ].filter(id => id !== orderId);

  await syncDeliverJob(jobId, "update", {
    Active_Orders: JSON.stringify(activeOrderIds),
    Delivered_Record: JSON.stringify(deliveredRecord)
  });
}

function showWhatsAppShare(order, isReturn, items, itemQtys) {
  const drawer = document.getElementById('whatsapp-share-drawer');
  const textArea = document.getElementById('whatsapp-text-area');
  if (!drawer || !textArea) return;

  const deliverTo = order.Deliver_To || order.deliver_to || "N/A";
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const formattedDateTime = `${day}/${month}/${year} ${hours}:${minutes}`;

  const isReturnOrder = !!isReturn || 
                       (order.Mark || '').trim().toUpperCase().startsWith('R') || 
                       (order.Status || '').trim().toUpperCase() === 'COLLECTED';

  let text = "";
  const prefix = isReturnOrder ? "`Return Collected`" : "`Goods Delivered`";
  text = `${prefix}\n*D - ${order.ID}*\n${deliverTo}\n${formattedDateTime}`;
  if (!isReturnOrder) {
    text += `\n\n*SKU*........*QTY*\n`;
    items.forEach(item => {
      const currentQty = itemQtys && itemQtys[item.sku] !== undefined ? itemQtys[item.sku] : item.qty;
      text += `${item.sku}........${currentQty}\n`;
    });
  }

  textArea.value = text;

  // Populate UI fields
  const idEl = document.getElementById('whatsapp-order-id');
  const delEl = document.getElementById('whatsapp-order-deliver');
  const thumbsContainer = document.getElementById('whatsapp-proof-thumbnails-container');
  
  if (idEl) idEl.textContent = order.ID || '-';
  if (delEl) delEl.textContent = deliverTo;
  
  // Extract R2 proof URLs if available (for past completed orders)
  currentWhatsAppShareUrls = [];
  const signedUrl = isReturn 
    ? (order.Photo_Return_Paper_Admin || order.photo_return_paper_admin || "") 
    : (order.Photo_DO_Paper_Signed || order.photo_do_paper_signed || "");
  if (signedUrl && signedUrl.startsWith("http")) {
    currentWhatsAppShareUrls.push(signedUrl);
  }
  
  const handoverUrl = order.Photo_Handover_Proof || order.photo_handover_proof || "";
  if (handoverUrl && handoverUrl.startsWith("http")) {
    currentWhatsAppShareUrls.push(handoverUrl);
  }
  
  const supportingVal = order.Photo_Delivered_Proof || order.photo_delivered_proof || "";
  if (supportingVal) {
    try {
      const urls = JSON.parse(supportingVal);
      if (Array.isArray(urls)) {
        urls.forEach(url => {
          if (url && url.startsWith("http")) {
            currentWhatsAppShareUrls.push(url);
          }
        });
      }
    } catch (_) {
      if (supportingVal.startsWith("http")) {
        currentWhatsAppShareUrls.push(supportingVal);
      }
    }
  }

  if (thumbsContainer) {
    thumbsContainer.innerHTML = '';
    const placeholderImg = "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2264%22%20height%3D%2264%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2394A3B8%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Crect%20x%3D%223%22%20y%3D%223%22%20width%3D%2218%22%20height%3D%2218%22%20rx%3D%222%22%20ry%3D%222%22%2F%3E%3Ccircle%20cx%3D%228.5%22%20cy%3D%228.5%22%20r%3D%221.5%22%2F%3E%3Cpolyline%20points%3D%2221%2015%2016%2010%205%2021%22%2F%3E%3C%2Fsvg%3E";
    
    const fileUrls = [];
    
    // Add local memory photos if they exist (just completed)
    if (deliverSignedPhotoFile) {
      fileUrls.push(URL.createObjectURL(deliverSignedPhotoFile));
    }
    if (returnPaperPhotoFile) {
      fileUrls.push(URL.createObjectURL(returnPaperPhotoFile));
    }
    if (Array.isArray(deliverSupportingPhotoFiles)) {
      deliverSupportingPhotoFiles.forEach(file => {
        if (file) fileUrls.push(URL.createObjectURL(file));
      });
    }
    
    // Also include existing Photo_Handover_Proof URL if it is set in the order object
    if (handoverUrl && handoverUrl.startsWith("http")) {
      // Avoid duplicate push if already in fileUrls
      if (!fileUrls.includes(handoverUrl)) {
        fileUrls.push(handoverUrl);
      }
    }
    
    // Fall back to R2 URLs if local memory is empty (completed in past)
    if (fileUrls.length === 0 && currentWhatsAppShareUrls.length > 0) {
      currentWhatsAppShareUrls.forEach(url => {
        fileUrls.push(url);
      });
    }
    
    if (fileUrls.length > 0) {
      fileUrls.forEach(url => {
        const img = document.createElement('img');
        img.src = url;
        img.alt = "Proof Thumbnail";
        img.style.width = "50px";
        img.style.height = "50px";
        img.style.borderRadius = "8px";
        img.style.border = "1.5px solid var(--border-color)";
        img.style.objectFit = "cover";
        img.style.cursor = "pointer";
        img.onclick = () => showLightbox(url);
        thumbsContainer.appendChild(img);
      });
    } else {
      const img = document.createElement('img');
      img.src = placeholderImg;
      img.alt = "No Photo";
      img.style.width = "50px";
      img.style.height = "50px";
      img.style.borderRadius = "8px";
      img.style.border = "1.5px solid var(--border-color)";
      img.style.objectFit = "cover";
      thumbsContainer.appendChild(img);
    }
  }
  
  drawer.style.display = 'flex';
  setTimeout(() => {
    const card = document.getElementById('whatsapp-share-drawer-card');
    if (card) card.style.transform = 'translateY(0)';
  }, 50);
}

// Logs Page View control functions
function openLogsPage(order) {
  const page = document.getElementById('logs-page');
  if (!page) return;
  
  page.classList.add('active');
  
  const titleEl = document.getElementById('logs-page-title');
  const doNum = order.DO_Number || order.do_number || 'Order';
  if (titleEl) titleEl.textContent = `Logs - ${doNum}`;
  
  const container = document.getElementById('logs-timeline-container');
  if (!container) return;
  
  container.innerHTML = '';
  
  let logs = [];
  try {
    logs = JSON.parse(order.Logs || '[]');
  } catch (e) {
    logs = [];
  }
  
  if (!Array.isArray(logs) || logs.length === 0) {
    container.innerHTML = '<p style="color: #94A3B8; font-style: italic;">No logs recorded for this order.</p>';
    return;
  }
  
  // Sort logs by timestamp ascending (timeline flow)
  logs.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));

  logs.forEach(log => {
    const entry = document.createElement('div');
    entry.style.position = 'relative';
    entry.style.display = 'flex';
    entry.style.flexDirection = 'column';
    entry.style.gap = '4px';
    
    const formattedTime = formatTimestamp(log.timestamp);
    
    // Check if there is an image in the log or mapped from columns
    let imgUrls = [];
    if (log.photoUrl) {
      imgUrls = parseDOImages(log.photoUrl);
    } else {
      const act = (log.action || '').toLowerCase();
      if (act.includes("created") || act.includes("imported") || act.includes("sent")) {
        const rawVal = order.Photo_DO_Paper || order.photo_do_paper || order.PhotoDoPaper || '';
        imgUrls = parseDOImages(rawVal);
      } else if (act.includes("picked") || act.includes("proof")) {
        const rawVal = order.Photo_Picker_Proof || order.photo_picker_proof || order.PhotoPickerProof || '';
        imgUrls = parseDOImages(rawVal);
      } else if (act.includes("delivered")) {
        const rawVal = order.Photo_Delivered_Proof || order.photo_delivered_proof || order.PhotoDeliveredProof || '';
        imgUrls = parseDOImages(rawVal);
      } else if (act.includes("handover")) {
        const rawVal = order.Photo_Handover_Proof || order.photo_handover_proof || order.PhotoHandoverProof || '';
        imgUrls = parseDOImages(rawVal);
      } else if (act.includes("signed")) {
        const rawVal = order.Photo_DO_Paper_Signed || order.photo_do_paper_signed || order.PhotoDoPaperSigned || '';
        imgUrls = parseDOImages(rawVal);
      } else if (act.includes("pick return") || act.includes("return paper")) {
        const rawVal = order.Photo_Return_Paper || order.photo_return_paper || '';
        imgUrls = parseDOImages(rawVal);
      } else if (act.includes("unpick return") || act.includes("return paper admin")) {
        const rawVal = order.Photo_Return_Paper_Admin || order.photo_return_paper_admin || '';
        imgUrls = parseDOImages(rawVal);
      }
    }
    
    let imgHtml = '';
    if (imgUrls.length > 0) {
      imgHtml = imgUrls.map((url, uIdx) => `
        <div style="margin-top: 6px; max-width: 200px; border-radius: 8px; overflow: hidden; border: 1px solid #CBD5E1; background-color: #F8FAFC;">
          <img src="${url}" alt="Log Proof Page ${uIdx + 1}" class="log-proof-img" data-img-url="${url}" style="width: 100%; height: auto; display: block; cursor: pointer;">
        </div>
      `).join('');
    }
    
    entry.innerHTML = `
      <div style="position: absolute; left: -31px; top: 4px; width: 12px; height: 12px; border-radius: 50%; background-color: var(--app-color); border: 2.5px solid #FFF; box-shadow: 0 1px 2px rgba(0,0,0,0.15);"></div>
      <div style="font-size: 10px; color: #94A3B8; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">${formattedTime}</div>
      <div style="font-size: 13px; font-weight: 700; color: var(--text-primary);">
        ${log.action} <span style="font-size: 11px; font-weight: 500; color: #64748B;">by ${log.actionBy}</span>
      </div>
      ${log.remark ? `<div style="font-size: 11px; color: #475569; background-color: #F8FAFC; border: 1px solid #E2E8F0; padding: 6px 10px; border-radius: 6px; line-height: 1.4; word-break: break-word;">${log.remark}</div>` : ''}
      ${imgHtml}
    `;

    if (imgUrls.length > 0) {
      entry.querySelectorAll('.log-proof-img').forEach(imgEl => {
        const u = imgEl.getAttribute('data-img-url');
        if (u) {
          imgEl.addEventListener('click', () => {
            showLightbox(u);
          });
        }
      });
    }
    
    container.appendChild(entry);
  });
}

function closeLogsPage() {
  const page = document.getElementById('logs-page');
  if (page) {
    page.classList.remove('active');
  }
}

function parseDOImages(val) {
  if (!val) return [];
  const trimmed = String(val).trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch (_) {}
  }
  return [trimmed].filter(Boolean);
}

function showLightbox(url) {
  const modal = document.getElementById('lightbox-modal');
  const img = document.getElementById('lightbox-img');
  if (modal && img) {
    img.src = url;
    modal.style.display = 'flex';
  }
}

function hideLightbox() {
  const modal = document.getElementById('lightbox-modal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// ==========================================================================
// Leaflet Map & Pin Logic (Route Map Tab)
// ==========================================================================

function getSingaporeLatLng(poscode) {
  let clean = String(poscode || "").trim();
  if (!clean) return { lat: 1.3521, lng: 103.8198 }; // Center of SG
  
  // Pad with leading zero if it's a 5-digit number
  if (/^\d+$/.test(clean)) {
    clean = clean.padStart(6, '0');
  }
  
  if (clean.length < 2) return { lat: 1.3521, lng: 103.8198 };
  const prefix = clean.substring(0, 2);
  const mapping = {
    "01": { lat: 1.277, lng: 103.852 }, "02": { lat: 1.277, lng: 103.852 }, "03": { lat: 1.277, lng: 103.852 },
    "04": { lat: 1.277, lng: 103.852 }, "05": { lat: 1.277, lng: 103.852 }, "06": { lat: 1.277, lng: 103.852 },
    "07": { lat: 1.274, lng: 103.844 }, "08": { lat: 1.274, lng: 103.844 },
    "09": { lat: 1.267, lng: 103.822 }, "10": { lat: 1.267, lng: 103.822 },
    "14": { lat: 1.288, lng: 103.810 }, "15": { lat: 1.288, lng: 103.810 }, "16": { lat: 1.288, lng: 103.810 },
    "11": { lat: 1.292, lng: 103.778 }, "12": { lat: 1.292, lng: 103.778 }, "13": { lat: 1.292, lng: 103.778 },
    "17": { lat: 1.292, lng: 103.778 }, "18": { lat: 1.292, lng: 103.778 }, "19": { lat: 1.292, lng: 103.778 },
    "20": { lat: 1.292, lng: 103.778 }, "21": { lat: 1.292, lng: 103.778 },
    "22": { lat: 1.303, lng: 103.834 }, "23": { lat: 1.303, lng: 103.834 }, "24": { lat: 1.303, lng: 103.834 },
    "25": { lat: 1.303, lng: 103.834 }, "26": { lat: 1.303, lng: 103.834 }, "27": { lat: 1.303, lng: 103.834 },
    "28": { lat: 1.325, lng: 103.839 }, "29": { lat: 1.325, lng: 103.839 }, "30": { lat: 1.325, lng: 103.839 },
    "31": { lat: 1.332, lng: 103.847 }, "32": { lat: 1.332, lng: 103.847 }, "33": { lat: 1.332, lng: 103.847 },
    "34": { lat: 1.325, lng: 103.871 }, "35": { lat: 1.325, lng: 103.871 }, "36": { lat: 1.325, lng: 103.871 }, "37": { lat: 1.325, lng: 103.871 },
    "38": { lat: 1.318, lng: 103.886 }, "39": { lat: 1.318, lng: 103.886 }, "40": { lat: 1.318, lng: 103.886 }, "41": { lat: 1.318, lng: 103.886 },
    "42": { lat: 1.305, lng: 103.905 }, "43": { lat: 1.305, lng: 103.905 }, "44": { lat: 1.305, lng: 103.905 }, "45": { lat: 1.305, lng: 103.905 },
    "46": { lat: 1.324, lng: 103.929 }, "47": { lat: 1.324, lng: 103.929 }, "48": { lat: 1.324, lng: 103.929 },
    "49": { lat: 1.364, lng: 103.991 }, "50": { lat: 1.364, lng: 103.991 },
    "51": { lat: 1.353, lng: 103.944 }, "52": { lat: 1.353, lng: 103.944 },
    "53": { lat: 1.361, lng: 103.886 }, "54": { lat: 1.361, lng: 103.886 }, "55": { lat: 1.361, lng: 103.886 },
    "56": { lat: 1.369, lng: 103.848 }, "57": { lat: 1.369, lng: 103.848 },
    "58": { lat: 1.344, lng: 103.774 }, "59": { lat: 1.344, lng: 103.774 },
    "60": { lat: 1.326, lng: 103.722 }, "61": { lat: 1.326, lng: 103.722 }, "62": { lat: 1.326, lng: 103.722 }, "63": { lat: 1.326, lng: 103.722 }, "64": { lat: 1.326, lng: 103.722 },
    "65": { lat: 1.358, lng: 103.750 }, "66": { lat: 1.358, lng: 103.750 }, "67": { lat: 1.358, lng: 103.750 }, "68": { lat: 1.358, lng: 103.750 },
    "69": { lat: 1.411, lng: 103.705 }, "70": { lat: 1.411, lng: 103.705 }, "71": { lat: 1.411, lng: 103.705 },
    "72": { lat: 1.437, lng: 103.779 }, "73": { lat: 1.437, lng: 103.779 },
    "75": { lat: 1.430, lng: 103.828 }, "76": { lat: 1.430, lng: 103.828 },
    "77": { lat: 1.396, lng: 103.818 }, "78": { lat: 1.396, lng: 103.818 },
    "79": { lat: 1.409, lng: 103.870 }, "80": { lat: 1.409, lng: 103.870 },
    "81": { lat: 1.390, lng: 103.902 }, "82": { lat: 1.390, lng: 103.902 }
  };
  return mapping[prefix] || { lat: 1.3521, lng: 103.8198 };
}

function validatePoscode(code) {
  const clean = String(code || "").trim();
  return /^\d{5,6}$/.test(clean);
}

function getZoneFromPostcode(postcode) {
  if (!postcode) return "Unknown";
  
  const postcodeStr = postcode.toString().padStart(6, '0');
  const sector = parseInt(postcodeStr.substring(0, 2), 10);
  
  if (isNaN(sector)) return "Unknown";
  
  if (sector >= 1 && sector <= 10) return "South";
  if (sector >= 11 && sector <= 33) return "Central";
  if ((sector >= 34 && sector <= 52) || sector === 81) return "East";
  if ((sector >= 53 && sector <= 57) || sector === 79 || sector === 80 || sector === 82) return "North-East";
  if (sector >= 58 && sector <= 71) return "West";
  if (sector >= 72 && sector <= 78) return "North";
  
  return "Unknown";
}

function initMap() {
  if (activeTab !== 'Route Map') return;
  if (!window.L) {
    setTimeout(initMap, 200);
    return;
  }

  const L = window.L;

  if (!mapInstance) {
    mapInstance = L.map("leaflet-map", {
      zoomControl: true,
      attributionControl: false
    }).setView([1.3521, 103.8198], 11);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19
    }).addTo(mapInstance);

    markersGroup = L.featureGroup().addTo(mapInstance);

    // Bind fullscreen button
    const fsBtn = document.getElementById('map-fullscreen-btn');
    if (fsBtn && !fsBtn.dataset.bound) {
      fsBtn.dataset.bound = "true";
      fsBtn.addEventListener('click', () => {
        const wrapper = document.getElementById('map-wrapper');
        if (wrapper) {
          isMapFullscreen = !isMapFullscreen;
          if (isMapFullscreen) {
            wrapper.classList.add('fullscreen');
          } else {
            wrapper.classList.remove('fullscreen');
          }
          if (mapInstance) {
            setTimeout(() => {
              mapInstance.invalidateSize();
            }, 300);
          }
        }
      });
    }

    // Force redraw tiles
    setTimeout(() => {
      if (mapInstance) mapInstance.invalidateSize();
    }, 200);
  } else {
    mapInstance.invalidateSize();
  }

  renderMapPins();
}

function lockMap() {
  if (!mapInstance) return;
  mapInstance.dragging.disable();
  mapInstance.touchZoom.disable();
  mapInstance.doubleClickZoom.disable();
  mapInstance.scrollWheelZoom.disable();
  if (mapInstance.tap) mapInstance.tap.disable();
}

function unlockMap() {
  if (!mapInstance) return;
  mapInstance.dragging.enable();
  mapInstance.touchZoom.enable();
  mapInstance.doubleClickZoom.enable();
  mapInstance.scrollWheelZoom.enable();
  if (mapInstance.tap) mapInstance.tap.enable();
}

function renderMapPins() {
  if (!mapInstance || !markersGroup) return;

  const L = window.L;
  markersGroup.clearLayers();

  // 1. Add Warehouse Pin (postcode: 409461 -> 1.3197, 103.8962) with Home Icon in gray
  const homeIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
  const warehouseIcon = L.divIcon({
    html: `<div style="background-color: #9CA3AF; border: 1px solid white; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; color: white; box-shadow: 0 1px 3px rgba(0,0,0,0.25);">${homeIconSvg}</div>`,
    className: "",
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });

  L.marker([1.3197, 103.8962], { icon: warehouseIcon }).addTo(markersGroup);

  // 2. Filter Active Orders for Pins
  const activeJobId = localStorage.getItem('active_job_id');
  const driverName = getCachedAuth();

  const isReturnOrder = (order) => {
    const m = (order.Mark || '').trim().toUpperCase();
    return m.startsWith('R');
  };

  let deliveryOrders = [];
  let returnOrders = [];

  if (activeJobId) {
    // ON Job Mode: Only show active Out for Delivery / Pending Return assigned to current driver
    deliveryOrders = allOrders.filter(o => 
      !isReturnOrder(o) &&
      (o.Status || "").trim().toLowerCase() === "out for delivery" &&
      (o.Driver || "").trim() === driverName &&
      o.Poscode && 
      validatePoscode(o.Poscode)
    );

    returnOrders = allOrders.filter(o => 
      isReturnOrder(o) &&
      (o.Status || "").trim().toLowerCase() === "pending" && 
      (o.Driver || "").trim() === driverName &&
      o.Poscode
    );
  } else {
    // OFF Job Mode: Show all unassigned or self-assigned prepare/ready/load orders
    deliveryOrders = allOrders.filter(o => 
      !isReturnOrder(o) &&
      ["ready to pick", "picking", "ready to deliver", "load"].includes((o.Status || "").trim().toLowerCase()) &&
      o.Poscode && 
      validatePoscode(o.Poscode)
    );

    returnOrders = allOrders.filter(o => 
      isReturnOrder(o) &&
      (o.Status || "").trim().toLowerCase() === "pending" && 
      o.Poscode
    );
  }

  const deliveryPins = deliveryOrders.map(o => {
    let lat = Number(o.Latitude);
    let lng = Number(o.Longitude);
    if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
      const coords = getSingaporeLatLng(o.Poscode);
      lat = coords.lat;
      lng = coords.lng;
    }

    let color = "#9CA3AF"; // Default Gray
    let textColor = "#FFFFFF";
    let displayStatus = "Preparing Goods";

    const st = (o.Status || "").trim().toLowerCase();
    if (st === "ready to pick" || st === "picking") {
      color = "#D47A8E"; // Dusty Rose
      textColor = "#FFFFFF";
      displayStatus = "Preparing Goods";
    } else if (st === "ready to deliver") {
      color = "#E28B54"; // Soft Orange
      textColor = "#FFFFFF";
      displayStatus = "Goods Ready";
    } else if (st === "load") {
      color = "#007A87"; // Teal Blue
      textColor = "#FFFFFF";
      displayStatus = "Goods Ready";
    } else if (st === "out for delivery") {
      color = "#007A87"; // Teal Blue
      textColor = "#FFFFFF";
      displayStatus = "Out for Delivery";
    }

    return {
      order: o,
      mark: o.Mark || "-",
      poscode: o.Poscode,
      deliverTo: o.Deliver_To || o.deliver_to || o.DeliverTo || "N/A",
      status: displayStatus,
      color,
      textColor,
      lat,
      lng,
      isReturn: false,
      typeDisplay: o.Type || "Normal",
      deliverMethod: o.Deliver_Method || "Company Delivery"
    };
  });

  // Map Return Pins
  const returnPins = returnOrders.map(o => {
    let lat = Number(o.Latitude);
    let lng = Number(o.Longitude);
    if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
      const coords = getSingaporeLatLng(o.Poscode);
      lat = coords.lat;
      lng = coords.lng;
    }

    let color = "#7C3AED"; // Purple (Return Pending)
    let textColor = "#FFFFFF";
    let displayStatus = "Pending Collect";

    return {
      order: o,
      mark: o.Mark || "-",
      poscode: o.Poscode,
      deliverTo: o.Deliver_To || o.deliver_to || o.DeliverTo || "N/A",
      status: displayStatus,
      color,
      textColor,
      lat,
      lng,
      isReturn: true,
      typeDisplay: "Return",
      deliverMethod: o.Deliver_Method || "Company Vehicle"
    };
  });

  const activePins = [...deliveryPins, ...returnPins];

  // Group pins by postcode or lat-lng to detect overlapping
  const keyGroups = {};
  activePins.forEach(pin => {
    const key = String(pin.poscode || "").trim() || `${pin.lat.toFixed(5)}_${pin.lng.toFixed(5)}`;
    if (!keyGroups[key]) {
      keyGroups[key] = [];
    }
    keyGroups[key].push(pin);
  });

  // Render pins with side-by-side anchor offsets for overlaps
  Object.keys(keyGroups).forEach(key => {
    const group = keyGroups[key];
    const N = group.length;

    group.forEach((pin, i) => {
      // Calculate horizontal pixel offset for side-by-side display
      const xShift = -(N - 1) * 13 + i * 26;
      const anchorX = 12 - xShift;

      const customIcon = L.divIcon({
        html: `<div style="background-color: ${pin.color}; border: 1.5px solid white; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-family: inherit; font-size: 10px; font-weight: 900; color: ${pin.textColor}; box-shadow: 0 2px 4px rgba(0,0,0,0.35); line-height: 22px; text-align: center; cursor: pointer;">${pin.mark}</div>`,
        className: "",
        iconSize: [24, 24],
        iconAnchor: [anchorX, 12]
      });

      const marker = L.marker([pin.lat, pin.lng], { icon: customIcon }).addTo(markersGroup);

      // Bind custom click handler
      marker.on('click', () => {
        const activeJobId = localStorage.getItem('active_job_id');
        if (activeJobId) {
          if (pin.isReturn) {
            const card = document.getElementById(`on-mode-card-${pin.order.ID}`);
            if (card) {
              card.scrollIntoView({ behavior: 'smooth', block: 'center' });
              const origBg = card.style.backgroundColor;
              card.style.backgroundColor = '#FEF3C7'; // Amber flash
              setTimeout(() => {
                card.style.backgroundColor = origBg || '';
              }, 1000);
            }
          } else {
            openDeliverPage(pin.order);
          }
          mapInstance.setView([pin.lat, pin.lng], Math.max(mapInstance.getZoom(), 13));
          return;
        }
        selectedOrderOnMap = pin.order.ID;
        renderMapOrderDetails(pin.order, pin);
        mapInstance.setView([pin.lat, pin.lng], Math.max(mapInstance.getZoom(), 13));
      });
    });
  });
}

// Instantly update LocalStorage and silently sync updates to GAS proxy endpoint
async function silentSyncOrderUpdate(orderId, fields) {
  // 1. Instantly update local state
  const order = allOrders.find(o => o.ID === orderId);
  if (order) {
    Object.assign(order, fields);
    localStorage.setItem('driver_orders', JSON.stringify(allOrders));
    updateJobToggleDisabledState();
    
    // Refresh map pins if tab is Route Map
    if (activeTab === 'Route Map') {
      renderMapPins();
      // If currently selected, re-render details
      if (selectedOrderOnMap === orderId) {
        // Resolve corresponding active pin
        const activePin = {
          color: fields.Status === "Load" ? "#007A87" : (fields.Status === "Out for Delivery" ? "#007A87" : "#14532D"),
          textColor: "#FFFFFF"
        };
        renderMapOrderDetails(order, activePin);
      }
    }
  }

  // 2. Silently POST update to Worker
  try {
    const payload = {
      sheet: "Track_Orders",
      action: "update",
      data: {
        ID: orderId,
        ...fields
      }
    };
    
    fetch(`${WORKER_URL}/api/app/driver/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(res => {
      if (!res.ok) {
        console.warn("Background update sync failed with status:", res.status);
      }
    }).catch(err => {
      console.warn("Background update sync failed:", err);
    });
  } catch (e) {
    console.warn("Failed to schedule background sync:", e);
  }
}

// Action execution handlers
function performLoadGoods(order, driverName) {
  let logs = [];
  try {
    logs = JSON.parse(order.Logs || '[]');
  } catch (_) {}
  logs.push({
    action: "Loaded Goods",
    actionBy: driverName,
    remark: `Loaded goods with marking ${order.Mark || "-"}`,
    timestamp: Date.now()
  });

  silentSyncOrderUpdate(order.ID, {
    Status: "Load",
    Driver: driverName,
    Logs: JSON.stringify(logs)
  });
  showToast("Order loaded successfully!", "success");
}

function performGoToDestination(order, driverName) {
  let logs = [];
  try {
    logs = JSON.parse(order.Logs || '[]');
  } catch (_) {}
  logs.push({
    action: "Out for Delivery",
    actionBy: driverName,
    remark: "Departed for delivery",
    timestamp: Date.now()
  });

  silentSyncOrderUpdate(order.ID, {
    Status: "Out for Delivery",
    Logs: JSON.stringify(logs)
  });
  showToast("Status updated to Out for Delivery!", "success");
}

function performCompleteDelivery(order, driverName) {
  let logs = [];
  try {
    logs = JSON.parse(order.Logs || '[]');
  } catch (_) {}
  logs.push({
    action: "Delivered",
    actionBy: driverName,
    remark: "Delivery completed",
    timestamp: Date.now()
  });

  silentSyncOrderUpdate(order.ID, {
    Status: "Delivered",
    Completed: "true",
    Logs: JSON.stringify(logs)
  });
  showToast("Delivery completed successfully!", "success");
  clearMapOrderDetails();
}

// Auth-trigger actions
function handleLoadGoodsAction(order) {
  const driverName = getCachedAuth();
  if (!driverName) {
    authPendingAction = {
      type: 'load_goods',
      orderId: order.ID
    };
    openAuthPage();
    return;
  }
  performLoadGoods(order, driverName);
}

function handleGoToDestinationAction(order) {
  const driverName = getCachedAuth();
  if (!driverName) {
    authPendingAction = {
      type: 'go_to_destination',
      orderId: order.ID
    };
    openAuthPage();
    return;
  }
  performGoToDestination(order, driverName);
}

function handleCompleteDeliveryAction(order) {
  const driverName = getCachedAuth();
  if (!driverName) {
    authPendingAction = {
      type: 'complete_delivery',
      orderId: order.ID
    };
    openAuthPage();
    return;
  }
  performCompleteDelivery(order, driverName);
}

function renderMapOrderDetails(order, pin) {
  const container = document.getElementById('map-details-container');
  if (!container) return;

  // Exit fullscreen if active
  if (isMapFullscreen) {
    isMapFullscreen = false;
    const wrapper = document.getElementById('map-wrapper');
    if (wrapper) {
      wrapper.classList.remove('fullscreen');
    }
  }

  // Shrink map container to 10% height and blur 50%
  const wrapper = document.getElementById('map-wrapper');
  if (wrapper) {
    wrapper.classList.add('shrink');
  }
  
  if (mapInstance) {
    setTimeout(() => {
      mapInstance.invalidateSize();
    }, 320);
  }

  const mark = order.Mark || "-";
  const isReturn = mark.trim().toUpperCase().startsWith('R');
  const color = pin ? pin.color : "#3B82F6";
  const textColor = pin ? pin.textColor : "#FFFFFF";
  const doNum = order.DO_Number || order.do_number || "UNKNOWN";
  const postcode = order.Poscode || "N/A";
  const zone = getZoneFromPostcode(postcode);

  const currentUser = getCachedAuth();
  const userClean = (currentUser || "").trim().toLowerCase();
  const driverClean = (order.Driver || "").trim().toLowerCase();
  const statusClean = (order.Status || "").trim().toLowerCase();

  // Action footer elements
  const actionBtn = document.getElementById('map-action-btn');
  const actionBar = document.getElementById('map-action-bar');

  if (actionBtn) {
    actionBtn.style.display = '';
  }
  if (actionBar) {
    const existingSlider = actionBar.querySelector('.slide-to-unload-container');
    if (existingSlider) existingSlider.remove();
  }

  if (isReturn) {
    // ==========================================
    // [Return Order] Template
    // ==========================================
    const returnStatusText = order.Driver ? `${order.Driver} will collect this return` : "Pending Collect";
    const collectFrom = order.Deliver_To || order.deliver_to || order.DeliverTo || "N/A";
    const collectFromTruncated = collectFrom.length > 16 ? collectFrom.substring(0, 16) + "..." : collectFrom;

    // Body: photo of Return Paper if available, otherwise static text + inline camera
    let returnPaperHtml = "";
    const returnPaperUrl = order.Photo_Return_Paper || order.photo_return_paper || "";
    if (returnPaperUrl) {
      returnPaperHtml = `
        <div style="max-width: 100%; aspect-ratio: 4/3; border-radius: 12px; overflow: hidden; border: 1.5px solid var(--border-color); background-color: #F8FAFC; cursor: pointer;">
          <img src="${returnPaperUrl}" class="lightbox-trigger" data-img-url="${returnPaperUrl}" alt="Return Paper" style="width: 100%; height: 100%; object-fit: cover;">
        </div>
      `;
    } else if (statusClean === "pending" && !driverClean) {
      returnPaperHtml = `
        <div style="padding: 20px; text-align: center; color: #475569; font-weight: 700; font-size: 14px; background-color: #F1F5F9; border-radius: 12px; border: 1.5px dashed #CBD5E1; margin-bottom: 12px;">
          Collect the Return Paper at Office.
        </div>
        <div class="camera-upload-box" id="return-inline-camera-box" style="width: 100%; aspect-ratio: 4/3; border: 2.5px dashed var(--border-color); border-radius: 12px; position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center; background-color: #F8FAFC; cursor: pointer; box-sizing: border-box;">
          <div class="camera-placeholder" id="return-inline-placeholder" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--text-muted);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 32px; height: 32px;">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
              <circle cx="12" cy="13" r="4"></circle>
            </svg>
            <span style="font-size: 13px; font-weight: 700;">Tap to Capture Return Paper</span>
          </div>
          <img id="return-inline-preview" class="camera-preview-img hidden" alt="Return Paper Preview" style="width: 100%; height: 100%; object-fit: cover; position: absolute; top: 0; left: 0;">
          <input type="file" id="return-inline-input" accept="image/*" capture="environment" style="display: none;">
        </div>
      `;
    } else {
      returnPaperHtml = `
        <div style="padding: 24px; text-align: center; color: #475569; font-weight: 700; font-size: 14px; background-color: #F1F5F9; border-radius: 12px; border: 1.5px dashed #CBD5E1;">
          Collect the Return Paper at Office.
        </div>
      `;
    }

    container.innerHTML = `
      <div class="map-order-detail-card" style="margin-bottom: 24px;">
        <!-- Top Container -->
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 2px 0 6px 0; border-bottom: 1.5px solid var(--border-color); margin-bottom: -4px;">
          <div style="flex: 1; text-align: center; font-size: 11px; font-weight: 700; color: #94A3B8; text-transform: uppercase; line-height: 1.2;">
            ${returnStatusText}
          </div>
          <button id="map-detail-close-btn" style="border: none; background: transparent; font-size: 28px; font-weight: 700; color: #94A3B8; cursor: pointer; padding: 0; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; margin-top: -10px; margin-bottom: -10px; margin-right: -12px; outline: none; -webkit-tap-highlight-color: transparent;">&times;</button>
        </div>

        <!-- Header Container -->
        <div class="map-order-header" style="display: flex; align-items: flex-start; gap: 12px; border-bottom: none; padding-bottom: 0;">
          <div class="map-order-mark" style="background-color: ${color}; color: ${textColor}; aspect-ratio: 1/1; width: 54px; height: 54px; border-radius: var(--radius-md); font-size: 22px; font-weight: 800; display: flex; align-items: center; justify-content: center; flex-shrink: 0; line-height: 54px;">
            ${mark}
          </div>
          <div class="map-order-title-block" style="flex: 1; min-width: 0; text-align: left; display: flex; flex-direction: column; justify-content: space-between; height: 54px; box-sizing: border-box; padding: 2px 0;">
            <div style="font-size: 16px; font-weight: 800; color: var(--text-primary); line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${order.ID || order.id || "UNKNOWN"}</div>
            <div style="font-size: 13px; color: var(--text-secondary); font-weight: 500; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; display: block;">${collectFrom}</div>
            <div style="font-size: 11px; color: var(--text-muted); font-weight: 500; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${postcode} - ${zone}</div>
          </div>
        </div>

        <!-- Body Container -->
        <div style="margin-top: 20px; text-align: left;">
          ${returnPaperHtml}
        </div>
      </div>
    `;

    // Footer actions for Return Order
    if (statusClean === "pending") {
      if (!driverClean) {
        // Pick Return Paper
        if (actionBar && actionBtn) {
          actionBar.classList.remove('hidden');
          if (!returnPaperPhotoFile) {
            actionBtn.className = "picking-action-btn ready-mode disabled-mode";
          } else {
            actionBtn.className = "picking-action-btn ready-mode";
          }
          actionBtn.innerHTML = `Pick Return Paper`;
          actionBtn.onclick = () => {
            if (actionBtn.classList.contains('disabled-mode')) {
              showToast("Please capture the return paper photo first!", "warning");
              return;
            }
            authPendingAction = {
              type: 'pick_return',
              orderId: order.ID,
              photoFile: returnPaperPhotoFile
            };
            openAuthPage();
          };
        }
      } else if (userClean && driverClean === userClean) {
        // [Unpick Return Paper]
        if (actionBar && actionBtn) {
          actionBar.classList.remove('hidden');
          actionBtn.className = "picking-action-btn"; // Blue
          actionBtn.innerHTML = `Unpick Return Paper`;
          actionBtn.onclick = () => {
            handleUnpickReturnPaperAction(order);
          };
        }
      } else {
        // Return is claimed by another driver, hide action bar
        if (actionBar) actionBar.classList.add('hidden');
      }
    } else {
      if (actionBar) actionBar.classList.add('hidden');
    }

  } else {
    // ==========================================
    // [Deliver Order] Template
    // ==========================================
    let statusText = "Pending Pick";
    if (statusClean === "ready to pick" || statusClean === "picking") {
      statusText = "Pending Pick";
    } else if (statusClean === "ready to deliver") {
      statusText = "Goods Ready";
    } else if (statusClean === "load") {
      statusText = `Load by ${order.Driver || "Driver"}.`;
    }

    const deliverToVal = order.Deliver_To || order.deliver_to || order.DeliverTo || "N/A";
    const deliverToTruncated = deliverToVal.length > 12 ? deliverToVal.substring(0, 12) + "..." : deliverToVal;

    // Label Banner (Urgent/Appointment)
    const typeRaw = (order.Type || 'Normal').trim();
    const typeUpper = typeRaw.toUpperCase();

    let labelBannerHtml = "";
    if (typeUpper.startsWith('URGENT')) {
      labelBannerHtml = `
        <div style="background-color: #EF4444; color: #FFFFFF; font-size: 11px; font-weight: 700; text-align: center; padding: 8px 12px; margin-left: -16px; margin-right: -16px; margin-top: -12px; margin-bottom: 4px; width: calc(100% + 32px); box-sizing: border-box; text-transform: uppercase; user-select: none;">
          Deliver by Today
        </div>
      `;
    } else if (typeUpper.startsWith('APPO')) {
      let deadlineFormatted = '';
      const match = typeRaw.match(/\(([^)]+)\)/);
      if (match) {
        deadlineFormatted = match[1];
      } else {
        deadlineFormatted = formatAppointment(order.Deadline || order.deadline || order.Timestamp || order.timestamp);
      }
      labelBannerHtml = `
        <div style="background-color: #F59E0B; color: #FFFFFF; font-size: 11px; font-weight: 700; text-align: center; padding: 8px 12px; margin-left: -16px; margin-right: -16px; margin-top: -12px; margin-bottom: 4px; width: calc(100% + 32px); box-sizing: border-box; text-transform: uppercase; user-select: none;">
          Deliver by ${deadlineFormatted}
        </div>
      `;
    }

    // Parse items
    let itemsListHtml = '';
    try {
      const items = typeof order.Items === 'string' ? JSON.parse(order.Items || '[]') : (order.Items || []);
      if (Array.isArray(items) && items.length > 0) {
        const placeholderImg = "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2264%22%20height%3D%2264%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2394A3B8%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Crect%20x%3D%223%22%20y%3D%223%22%20width%3D%2218%22%20height%3D%2218%22%20rx%3D%222%22%20ry%3D%222%22%2F%3E%3Ccircle%20cx%3D%228.5%22%20cy%3D%228.5%22%20r%3D%221.5%22%2F%3E%3Cpolyline%20points%3D%2221%2015%2016%2010%205%2021%22%2F%3E%3C%2Fsvg%3E";
        itemsListHtml = items.map((item, index) => {
           const prod = allProducts.find(p => (p.SKU || p.sku || '').toUpperCase() === (item.sku || '').toUpperCase());
           let prodName = item.sku;
           let imgUrl = '';
           if (prod) {
             prodName = prod["Display Name"] || prod.name || item.sku;
             imgUrl = prod.Image || prod.image || '';
           }

           const isChecking = loadingGoodsOrderId === order.ID;
           const isTicked = tickedSKUs.has(item.sku);

           let rightSectionHtml = '';
           if (isChecking) {
             rightSectionHtml = `
               <div style="border-left: 1.5px solid var(--border-color); display: flex; align-items: center; padding: 0 12px; height: 64px; flex-shrink: 0; background-color: #FFFFFF; justify-content: space-between; gap: 10px;">
                 <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1.1; min-width: 28px;">
                   <span style="font-size: 18px; font-weight: 850; color: #0F172A;">${item.qty}</span>
                   <span style="font-size: 9px; font-weight: 700; color: #64748B; letter-spacing: 0.05em; margin-top: 2px;">QTY</span>
                 </div>
                 <div class="picking-item-checkbox ${isTicked ? 'checked' : ''}" data-sku="${item.sku}">
                   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px; stroke: ${isTicked ? '#FFFFFF' : 'transparent'};">
                     <polyline points="20 6 9 17 4 12"></polyline>
                   </svg>
                 </div>
               </div>
             `;
           } else {
             rightSectionHtml = `
               <div style="border-left: 1.5px solid var(--border-color); display: flex; align-items: center; justify-content: center; padding: 0 16px; height: 64px; flex-shrink: 0; background-color: #FFFFFF; min-width: 60px;">
                 <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1.1;">
                   <span style="font-size: 18px; font-weight: 850; color: #0F172A;">${item.qty}</span>
                   <span style="font-size: 9px; font-weight: 700; color: #64748B; letter-spacing: 0.05em; margin-top: 2px;">QTY</span>
                 </div>
               </div>
             `;
           }

           return `
             <div style="display: flex; align-items: center; border: 1.5px solid var(--border-color); border-radius: 12px; background: #FFFFFF; box-sizing: border-box; height: 64px; overflow: hidden; margin-bottom: 8px;">
               <div style="position: relative; width: 64px; height: 64px; flex-shrink: 0; background-color: #FFFFFF; display: flex; align-items: center; justify-content: center; border-right: 1.5px solid var(--border-color); overflow: hidden; cursor: pointer;" class="lightbox-trigger" data-img-url="${imgUrl || placeholderImg}">
                 <img src="${imgUrl || placeholderImg}" onerror="this.onerror=null; this.src='${placeholderImg}';" style="width: 100%; height: 100%; object-fit: cover;">
                 <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background-color: rgba(0, 0, 0, 0.5); display: flex; align-items: center; justify-content: center; color: #FFFFFF; font-size: 18px; font-weight: 850; font-family: 'Outfit', sans-serif; pointer-events: none; user-select: none;">
                   ${mark}${index + 1}
                 </div>
               </div>
               <div style="flex: 1; min-width: 0; text-align: left; padding: 4px 12px;">
                 <div style="font-size: 14px; font-weight: 750; color: #0F172A; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${item.sku}</div>
                 <div style="font-size: 11px; color: #64748B; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; margin-top: 2px;">${prodName}</div>
               </div>
               ${rightSectionHtml}
             </div>
           `;
         }).join('');
       }
    } catch (e) {
      console.error("Failed to render items:", e);
    }

    // Picker proof (Goods Ready)
    let photoProofHtml = '';
    const pickerPhotoUrl = order.Photo_Picker_Proof || order.photo_picker_proof || order.picker_photo || '';
    if (pickerPhotoUrl && (statusClean === "ready to deliver" || statusClean === "load")) {
      photoProofHtml = `
        <div style="margin-top: 12px; text-align: left;">
          <div style="max-width: 100%; aspect-ratio: 4/3; border-radius: 12px; overflow: hidden; border: 1.5px solid var(--border-color); background-color: #F8FAFC; cursor: pointer;">
            <img src="${pickerPhotoUrl}" class="lightbox-trigger" data-img-url="${pickerPhotoUrl}" alt="Picker Proof" style="width: 100%; height: 100%; object-fit: cover;">
          </div>
        </div>
      `;
    }

    // DO Paper (Supports JSON serialized string arrays for multiple pages)
    let doPaperHtml = '';
    const doPaperVal = order.Photo_DO_Paper || order.photo_do_paper || '';
    const doPaperUrls = parseDOImageUrls(doPaperVal);
    if (doPaperUrls.length > 0) {
      doPaperHtml = doPaperUrls.map((url, index) => `
        <div style="margin-top: 12px; text-align: left;">
          <div style="max-width: 100%; aspect-ratio: 4/3; border-radius: 12px; overflow: hidden; border: 1.5px solid var(--border-color); background-color: #F8FAFC; cursor: pointer;">
            <img src="${url}" class="lightbox-trigger" data-img-url="${url}" alt="DO Paper Page ${index + 1}" style="width: 100%; height: 100%; object-fit: cover;">
          </div>
        </div>
      `).join('');
    }

    container.innerHTML = `
      <div class="map-order-detail-card" style="margin-bottom: 24px;">
        <!-- Top Container -->
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 2px 0 6px 0; border-bottom: 1.5px solid var(--border-color); margin-bottom: -4px;">
          <div style="flex: 1; text-align: center; font-size: 11px; font-weight: 700; color: #94A3B8; text-transform: uppercase; line-height: 1.2;">
            ${statusText}
          </div>
          <button id="map-detail-close-btn" style="border: none; background: transparent; font-size: 28px; font-weight: 700; color: #94A3B8; cursor: pointer; padding: 0; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; margin-top: -10px; margin-bottom: -10px; margin-right: -12px; outline: none; -webkit-tap-highlight-color: transparent;">&times;</button>
        </div>

        <!-- Label Container -->
        ${labelBannerHtml}

        <!-- Header Container -->
        <div class="map-order-header" style="display: flex; align-items: flex-start; gap: 12px; border-bottom: none; padding-bottom: 0;">
          <div class="map-order-mark" style="background-color: ${color}; color: ${textColor}; aspect-ratio: 1/1; width: 54px; height: 54px; border-radius: var(--radius-md); font-size: 22px; font-weight: 800; display: flex; align-items: center; justify-content: center; flex-shrink: 0; line-height: 54px;">
            ${mark}
          </div>
          <div class="map-order-title-block" style="flex: 1; min-width: 0; text-align: left; display: flex; flex-direction: column; justify-content: space-between; height: 54px; box-sizing: border-box; padding: 2px 0;">
            <div style="font-size: 16px; font-weight: 800; color: var(--text-primary); line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${order.ID || order.id || "UNKNOWN"}</div>
            <div style="font-size: 13px; color: var(--text-secondary); font-weight: 500; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; display: block;">${deliverToVal}</div>
            <div style="font-size: 11px; color: var(--text-muted); font-weight: 500; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${postcode} - ${zone}</div>
          </div>
        </div>

        <!-- Body Container -->
        <div style="margin-top: 16px; text-align: left;">
          <!-- Items List -->
          <div style="font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">Items List</div>
          <div style="display: flex; flex-direction: column;">
            ${itemsListHtml || '<div style="font-size: 12px; color: var(--text-muted); font-style: italic;">No items specified.</div>'}
          </div>

          <!-- Open More Details Button -->
          <button class="expand-details-btn" id="expand-details-btn">
            <span>Open More Details</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 12px; height: 12px; transition: transform 0.2s ease;"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>

          <!-- Collapsible More Details -->
          <div class="details-expandable-section" id="details-expandable-section">
            <!-- Proof images (inside collapse!) -->
            ${photoProofHtml}
            ${doPaperHtml}
          </div>
        </div>
      </div>
    `;

    // Footer actions for Delivery Order
    if (statusClean === "ready to deliver") {
      if (actionBar && actionBtn) {
        actionBar.classList.remove('hidden');

        if (loadingGoodsOrderId === order.ID) {
          const allItems = typeof order.Items === 'string' ? JSON.parse(order.Items || '[]') : (order.Items || []);
          const allTicked = tickedSKUs.size === allItems.length;

          if (allTicked) {
            actionBtn.className = "picking-action-btn ready-mode"; // Green
            actionBtn.innerHTML = `Finish Loading ${mark}`;
            actionBtn.onclick = () => {
              loadingGoodsOrderId = null;
              tickedSKUs.clear();
              performLoadGoods(order, currentUser);
            };
          } else {
            actionBtn.className = "picking-action-btn cancel-mode"; // Red
            actionBtn.innerHTML = `Cancel Load`;
            actionBtn.onclick = () => {
              loadingGoodsOrderId = null;
              tickedSKUs.clear();
              renderMapOrderDetails(order, pin);
            };
          }
        } else {
          // Load Goods button
          actionBtn.className = "picking-action-btn ready-mode"; // Green
          actionBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 18px; height: 18px; margin-right: 8px; display: inline-block; vertical-align: middle;">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
              <line x1="12" y1="22.08" x2="12" y2="12"/>
            </svg> Load Goods
          `;
          actionBtn.onclick = () => {
            const driverName = getCachedAuth();
            if (!driverName) {
              authPendingAction = { type: 'load_goods', orderId: order.ID };
              openAuthPage();
              return;
            }
            loadingGoodsOrderId = order.ID;
            tickedSKUs.clear();
            renderMapOrderDetails(order, pin);
          };
        }
      }
    } else if (statusClean === "load" && (!driverClean || (userClean && driverClean === userClean))) {
      // Unload Goods slider
      if (actionBar && actionBtn) {
        actionBar.classList.remove('hidden');
        actionBtn.style.display = 'none';
        
        // Remove existing slider if any
        const existingSlider = actionBar.querySelector('.slide-to-unload-container');
        if (existingSlider) existingSlider.remove();
        
        // Create slider container
        const sliderContainer = document.createElement('div');
        sliderContainer.className = 'slide-to-unload-container';
        sliderContainer.style.cssText = 'position: relative; width: 100%; height: 52px; background-color: #F1F5F9; border-radius: 12px; overflow: hidden; display: flex; align-items: center; justify-content: center; user-select: none; box-sizing: border-box; border: 1.5px solid #E2E8F0;';
        
        // Create fill layer
        const fill = document.createElement('div');
        fill.className = 'slide-to-unload-fill';
        fill.style.cssText = 'position: absolute; left: 0; top: 0; bottom: 0; width: 0px; background-color: rgba(59, 130, 246, 0.15); z-index: 1; pointer-events: none; border-radius: 12px 0 0 12px;';
        sliderContainer.appendChild(fill);
        
        // Create track text
        const trackText = document.createElement('div');
        trackText.style.cssText = 'font-size: 13px; font-weight: 750; color: #64748B; pointer-events: none; z-index: 2; text-transform: uppercase; letter-spacing: 0.08em; font-family: "Outfit", sans-serif;';
        trackText.innerText = 'Slide to Unload Goods';
        sliderContainer.appendChild(trackText);
        
        // Create handle
        const handle = document.createElement('div');
        handle.className = 'slide-to-unload-handle';
        handle.style.cssText = 'position: absolute; left: 3px; top: 3px; width: 46px; height: 46px; background: linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%); border-radius: 9px; display: flex; align-items: center; justify-content: center; color: #FFFFFF; cursor: grab; z-index: 3; box-shadow: 0 2px 5px rgba(29, 78, 216, 0.3); touch-action: none;';
        handle.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="width: 18px; height: 18px; pointer-events: none;">
            <polyline points="13 17 18 12 13 7"></polyline>
            <polyline points="6 17 11 12 6 7"></polyline>
          </svg>
        `;
        sliderContainer.appendChild(handle);
        actionBar.appendChild(sliderContainer);
        
        // Drag/Slide logic using pointer events for touch & mouse compatibility
        let isDragging = false;
        let startX = 0;
        let maxSlide = 0;
        
        handle.addEventListener('pointerdown', (e) => {
          isDragging = true;
          startX = e.clientX;
          maxSlide = sliderContainer.clientWidth - handle.clientWidth - 6; // 3px padding on left/right
          handle.setPointerCapture(e.pointerId);
          handle.style.transition = 'none';
          fill.style.transition = 'none';
          handle.style.cursor = 'grabbing';
        });
        
        handle.addEventListener('pointermove', (e) => {
          if (!isDragging) return;
          const currentX = e.clientX;
          let deltaX = currentX - startX;
          if (deltaX < 0) deltaX = 0;
          if (deltaX > maxSlide) deltaX = maxSlide;
          
          handle.style.left = (deltaX + 3) + 'px';
          fill.style.width = (deltaX + 26) + 'px'; // fill up to middle of handle
          
          const ratio = deltaX / maxSlide;
          trackText.style.opacity = (1 - ratio).toString();
        });
        
        handle.addEventListener('pointerup', (e) => {
          if (!isDragging) return;
          isDragging = false;
          handle.style.cursor = 'grab';
          
          const currentX = e.clientX;
          let deltaX = currentX - startX;
          
          if (deltaX >= maxSlide * 0.85) {
            handle.style.transition = 'left 0.15s ease';
            fill.style.transition = 'width 0.15s ease';
            handle.style.left = (maxSlide + 3) + 'px';
            fill.style.width = '100%';
            trackText.style.opacity = '0';
            
            setTimeout(() => {
              handle.style.left = '3px';
              fill.style.width = '0px';
              trackText.style.opacity = '1';
              handleUnloadGoodsAction(order);
            }, 150);
          } else {
            // Slide back
            handle.style.transition = 'left 0.15s ease';
            fill.style.transition = 'width 0.15s ease';
            handle.style.left = '3px';
            fill.style.width = '0px';
            trackText.style.opacity = '1';
          }
        });
        
        handle.addEventListener('pointercancel', (e) => {
          if (!isDragging) return;
          isDragging = false;
          handle.style.cursor = 'grab';
          handle.style.transition = 'left 0.15s ease';
          fill.style.transition = 'width 0.15s ease';
          handle.style.left = '3px';
          fill.style.width = '0px';
          trackText.style.opacity = '1';
        });
      }
    } else {
      if (actionBar) actionBar.classList.add('hidden');
    }
  }

  // Bind close button
  const closeBtn = document.getElementById('map-detail-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      if (loadingGoodsOrderId) {
        loadingGoodsOrderId = null;
        tickedSKUs.clear();
      }
      clearMapOrderDetails();
    });
  }

  // Bind return inline camera events
  const returnCameraBox = document.getElementById('return-inline-camera-box');
  const returnCameraInput = document.getElementById('return-inline-input');
  const returnPreviewImg = document.getElementById('return-inline-preview');
  const returnPlaceholder = document.getElementById('return-inline-placeholder');

  if (returnCameraBox && returnCameraInput) {
    if (returnPaperPhotoFile) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (returnPreviewImg) {
          returnPreviewImg.src = event.target.result;
          returnPreviewImg.classList.remove('hidden');
        }
        if (returnPlaceholder) {
          returnPlaceholder.style.display = 'none';
        }
      };
      reader.readAsDataURL(returnPaperPhotoFile);
    }

    returnCameraBox.addEventListener('click', () => {
      returnCameraInput.click();
    });

    returnCameraInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        try {
          const compressed = await compressImageToMax250kb(file);
          returnPaperPhotoFile = compressed;

          const reader = new FileReader();
          reader.onload = (event) => {
            if (returnPreviewImg) {
              returnPreviewImg.src = event.target.result;
              returnPreviewImg.classList.remove('hidden');
            }
            if (returnPlaceholder) {
              returnPlaceholder.style.display = 'none';
            }
            const actionBtn = document.getElementById('map-action-btn');
            if (actionBtn) {
              actionBtn.classList.remove('disabled-mode');
            }
          };
          reader.readAsDataURL(compressed);
        } catch (err) {
          console.error("Compression failed:", err);
          showToast("Failed to process image", "error");
        }
      }
    });
  }

  // Bind Lightbox on images click
  container.querySelectorAll('.lightbox-trigger').forEach(img => {
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      showLightbox(img.getAttribute('data-img-url'));
    });
  });

  // Bind Open More Details collapsible
  const expandBtn = document.getElementById('expand-details-btn');
  const expandableSection = document.getElementById('details-expandable-section');
  if (expandBtn && expandableSection) {
    expandBtn.addEventListener('click', () => {
      expandableSection.classList.toggle('expanded');
      const textSpan = expandBtn.querySelector('span');
      if (expandableSection.classList.contains('expanded')) {
        if (textSpan) textSpan.textContent = "Hide More Details";
        expandBtn.querySelector('svg').style.transform = "rotate(180deg)";
      } else {
        if (textSpan) textSpan.textContent = "Open More Details";
        expandBtn.querySelector('svg').style.transform = "rotate(0deg)";
      }
    });
  }

  // Bind Checklist Item Click Actions
  if (loadingGoodsOrderId === order.ID) {
    container.querySelectorAll('.picking-item-checkbox').forEach(cb => {
      cb.addEventListener('click', (e) => {
        e.stopPropagation();
        const sku = cb.getAttribute('data-sku');
        const svg = cb.querySelector('svg');
        if (tickedSKUs.has(sku)) {
          tickedSKUs.delete(sku);
          cb.classList.remove('checked');
          if (svg) svg.style.stroke = 'transparent';
        } else {
          tickedSKUs.add(sku);
          cb.classList.add('checked');
          if (svg) svg.style.stroke = '#FFFFFF';
        }

        // Re-evaluate if all ticked and adjust sticky button live
        const allItems = typeof order.Items === 'string' ? JSON.parse(order.Items || '[]') : (order.Items || []);
        const allTicked = tickedSKUs.size === allItems.length;

        if (allTicked) {
          actionBtn.className = "picking-action-btn ready-mode"; // Green
          actionBtn.innerHTML = `Finish Loading ${mark}`;
          actionBtn.onclick = () => {
            loadingGoodsOrderId = null;
            tickedSKUs.clear();
            performLoadGoods(order, currentUser);
          };
        } else {
          actionBtn.className = "picking-action-btn cancel-mode"; // Red
          actionBtn.innerHTML = `Cancel Load`;
          actionBtn.onclick = () => {
            loadingGoodsOrderId = null;
            tickedSKUs.clear();
            renderMapOrderDetails(order, pin);
          };
        }
      });
    });
  }
}

function clearMapOrderDetails() {
  returnPaperPhotoFile = null;
  const container = document.getElementById('map-details-container');
  if (container) {
    container.innerHTML = `<div class="map-placeholder-text">Click the pin location mark in maps to see details order.</div>`;
  }
  
  // Expand map back to 60vh
  const wrapper = document.getElementById('map-wrapper');
  if (wrapper) {
    wrapper.classList.remove('shrink');
  }

  // Hide sticky action bar and clean up slider
  const actionBar = document.getElementById('map-action-bar');
  if (actionBar) {
    actionBar.classList.add('hidden');
    const existingSlider = actionBar.querySelector('.slide-to-unload-container');
    if (existingSlider) existingSlider.remove();
  }

  const actionBtn = document.getElementById('map-action-btn');
  if (actionBtn) {
    actionBtn.style.display = '';
  }

  if (mapInstance) {
    setTimeout(() => {
      mapInstance.invalidateSize();
    }, 320);
  }

  selectedOrderOnMap = null;
  unlockMap();
}

// Job Toggle Switch & Confirm Modal Logic
function updateJobToggleDisabledState() {
  const jobToggle = document.getElementById('job-toggle-input');
  if (!jobToggle) return;

  const hasActiveJob = localStorage.getItem('active_job_id') !== null;
  if (hasActiveJob) {
    jobToggle.disabled = false;
    return;
  }

  const driverName = getCachedAuth();
  if (!driverName) {
    jobToggle.disabled = false;
    return;
  }

  const isReturnOrder = (order) => {
    const m = (order.Mark || '').trim().toUpperCase();
    return m.startsWith('R');
  };

  const hasLoadedOrders = allOrders.some(o => {
    const statusClean = (o.Status || '').trim().toLowerCase();
    const driverClean = (o.Driver || '').trim();
    return !isReturnOrder(o) && statusClean === 'load' && driverClean === driverName;
  });

  const hasPickedReturns = allOrders.some(o => {
    const isReturn = isReturnOrder(o);
    const driverClean = (o.Driver || '').trim();
    const hasPhoto = !!o.Photo_Return_Paper;
    const statusClean = (o.Status || '').trim().toLowerCase();
    return isReturn && driverClean === driverName && hasPhoto && statusClean === 'pending';
  });

  if (!hasLoadedOrders && !hasPickedReturns) {
    jobToggle.disabled = true;
  } else {
    jobToggle.disabled = false;
  }
}

function initJobToggle() {
  const jobToggle = document.getElementById('job-toggle-input');
  if (!jobToggle) return;

  // Initialize status on load based on active job existence
  const activeJobId = localStorage.getItem('active_job_id');
  jobToggle.checked = activeJobId !== null;
  if (activeJobId) {
    updateOnModeUI(true);
    renderOnModeList();
  } else {
    updateOnModeUI(false);
  }

  updateJobToggleDisabledState();

  // Handle click to prevent immediate change and show confirmation modal
  jobToggle.addEventListener('click', (e) => {
    e.preventDefault(); // Prevent checkbox state change
    const hasActiveJob = localStorage.getItem('active_job_id') !== null;
    if (!hasActiveJob) {
      showJobConfirmModal(true);
    } else {
      showJobConfirmModal(false);
    }
  });

  // Bind Confirm Modal buttons
  const confirmBtn = document.getElementById('job-modal-confirm-btn');
  const cancelBtn = document.getElementById('job-modal-cancel-btn');
  const modal = document.getElementById('job-confirm-modal');

  if (confirmBtn) {
    confirmBtn.onclick = async () => {
      if (modal) modal.style.display = 'none';
      const hasActiveJob = localStorage.getItem('active_job_id') !== null;
      if (!hasActiveJob) {
        // Start Delivery Job
        const driverName = getCachedAuth();
        if (!driverName) {
          showToast("Please log in first", "error");
          openAuthPage(true);
          return;
        }

        const jobId = 'JOB-' + Date.now();
        localStorage.setItem('active_job_id', jobId);
        localStorage.setItem('active_job_delivered_record', JSON.stringify([]));
        jobToggle.checked = true;

        showToast("Starting delivery job...", "info");

        // 1. Transition loaded orders (status = Load) to "Out for Delivery"
        const loadedOrders = allOrders.filter(o => {
          const statusClean = (o.Status || '').trim().toLowerCase();
          const driverClean = (o.Driver || '').trim();
          return statusClean === 'load' && driverClean === driverName;
        });

        for (const order of loadedOrders) {
          await silentSyncOrderUpdate(order.ID, {
            Status: "Out for Delivery"
          });
        }

        // 2. Gather active order IDs (Out for Delivery + Pending returns)
        const activeDeliverOrders = allOrders.filter(o => {
          const statusClean = (o.Status || '').trim().toLowerCase();
          const driverClean = (o.Driver || '').trim();
          return statusClean === 'out for delivery' && driverClean === driverName;
        });
        const activeReturnOrders = allOrders.filter(o => {
          const statusClean = (o.Status || '').trim().toLowerCase();
          const driverClean = (o.Driver || '').trim();
          const isReturn = String(o.Mark || '').startsWith('R');
          return isReturn && statusClean === 'pending' && driverClean === driverName;
        });
        
        const activeOrderIds = [
          ...activeDeliverOrders.map(o => o.ID),
          ...activeReturnOrders.map(o => o.ID)
        ];

        // 3. Write Deliver_Job record
        await syncDeliverJob(jobId, "insert", {
          Driver: driverName,
          Status: "ON",
          Start_Time: Date.now(),
          End_Time: "",
          Active_Orders: JSON.stringify(activeOrderIds),
          Delivered_Record: JSON.stringify([])
        });

        showToast("Delivery job started successfully", "success");
        
        updateOnModeUI(true);
        renderMapPins();
        renderOnModeList();
      } else {
        // End Delivery Job
        const jobId = localStorage.getItem('active_job_id');
        const driverName = getCachedAuth();
        if (jobId && driverName) {
          showToast("Ending delivery job...", "info");

          // 1. Restore Out for Delivery back to Load status
          const activeUndelivered = allOrders.filter(o => {
            const statusClean = (o.Status || '').trim().toLowerCase();
            const driverClean = (o.Driver || '').trim();
            return statusClean === 'out for delivery' && driverClean === driverName;
          });

          for (const order of activeUndelivered) {
            await silentSyncOrderUpdate(order.ID, {
              Status: "Load"
            });
          }

          // 2. Gather remaining active IDs
          const remainingDeliverIds = activeUndelivered.map(o => o.ID);
          const remainingReturnIds = allOrders.filter(o => {
            const statusClean = (o.Status || '').trim().toLowerCase();
            const driverClean = (o.Driver || '').trim();
            const isReturn = String(o.Mark || '').startsWith('R');
            return isReturn && statusClean === 'pending' && driverClean === driverName;
          }).map(o => o.ID);
          
          const remainingOrderIds = [...remainingDeliverIds, ...remainingReturnIds];

          let deliveredRecord = [];
          try {
            deliveredRecord = JSON.parse(localStorage.getItem('active_job_delivered_record') || '[]');
          } catch (_) {}

          // 3. Update Deliver_Job record
          await syncDeliverJob(jobId, "update", {
            Status: "OFF",
            End_Time: Date.now(),
            Active_Orders: JSON.stringify(remainingOrderIds),
            Delivered_Record: JSON.stringify(deliveredRecord)
          });
          
          showToast("Delivery job ended", "success");
        }
        localStorage.removeItem('active_job_id');
        localStorage.removeItem('active_job_delivered_record');
        jobToggle.checked = false;

        updateOnModeUI(false);
        renderMapPins();
      }
    };
  }

  if (cancelBtn) {
    cancelBtn.onclick = () => {
      if (modal) modal.style.display = 'none';
    };
  }
}

function updateOnModeUI(isOn) {
  const mapContainer = document.getElementById('map-page-container');
  const detailsContainer = document.getElementById('map-details-container');
  const onModeListContainer = document.getElementById('on-mode-list-container');
  
  if (isOn) {
    if (mapContainer) mapContainer.classList.add('on-mode');
    if (detailsContainer) detailsContainer.classList.add('hidden');
    if (onModeListContainer) onModeListContainer.classList.remove('hidden');
  } else {
    if (mapContainer) mapContainer.classList.remove('on-mode');
    if (detailsContainer) detailsContainer.classList.remove('hidden');
    if (onModeListContainer) onModeListContainer.classList.add('hidden');
  }
}

function getWarehouseDistance(o) {
  let lat = Number(o.Latitude);
  let lng = Number(o.Longitude);
  if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
    const coords = getSingaporeLatLng(o.Poscode);
    lat = coords.lat;
    lng = coords.lng;
  }
  // Warehouse: [1.3197, 103.8962]
  return Math.sqrt(Math.pow(lat - 1.3197, 2) + Math.pow(lng - 103.8962, 2));
}

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function getOrderLatLng(o) {
  let lat = Number(o.Latitude);
  let lng = Number(o.Longitude);
  if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
    const coords = getSingaporeLatLng(o.Poscode);
    lat = coords.lat;
    lng = coords.lng;
  }
  return [lat, lng];
}

function findNearest(currentLatLng, candidates) {
  let minDistance = Infinity;
  let nearestNode = null;
  for (const o of candidates) {
    const nodeLatLng = getOrderLatLng(o);
    const dist = calculateDistanceKm(currentLatLng[0], currentLatLng[1], nodeLatLng[0], nodeLatLng[1]);
    if (dist < minDistance) {
      minDistance = dist;
      nearestNode = o;
    }
  }
  return nearestNode;
}

function routeNearestNeighbor(startLatLng, orders, prioritizeUrgentAndAppt) {
  const unvisited = [...orders];
  const path = [];
  let currentLatLng = startLatLng;
  
  if (prioritizeUrgentAndAppt) {
    // 1. Visit all Urgent first in nearest-neighbor order
    const urgents = unvisited.filter(o => (o.Type || '').trim().toLowerCase() === 'urgent');
    while (urgents.length > 0) {
      const nearest = findNearest(currentLatLng, urgents);
      path.push(nearest);
      unvisited.splice(unvisited.indexOf(nearest), 1);
      urgents.splice(urgents.indexOf(nearest), 1);
      currentLatLng = getOrderLatLng(nearest);
    }
    
    // 2. Visit all Appointment next in nearest-neighbor order
    const appts = unvisited.filter(o => (o.Type || '').trim().toLowerCase() === 'appointment');
    while (appts.length > 0) {
      const nearest = findNearest(currentLatLng, appts);
      path.push(nearest);
      unvisited.splice(unvisited.indexOf(nearest), 1);
      appts.splice(appts.indexOf(nearest), 1);
      currentLatLng = getOrderLatLng(nearest);
    }
  }
  
  // 3. Visit remaining (Normal, or all of them if not prioritizing)
  while (unvisited.length > 0) {
    const nearest = findNearest(currentLatLng, unvisited);
    path.push(nearest);
    unvisited.splice(unvisited.indexOf(nearest), 1);
    currentLatLng = getOrderLatLng(nearest);
  }
  
  return path;
}

function renderOnModeList() {
  const container = document.getElementById('on-mode-list-container');
  if (!container) return;

  const driverName = getCachedAuth();
  if (!driverName) {
    container.innerHTML = '<div class="map-placeholder-text">Please log in first.</div>';
    return;
  }

  const isReturnOrder = (order) => {
    const m = (order.Mark || '').trim().toUpperCase();
    return m.startsWith('R');
  };

  // Find all active Out for Delivery / Pending Return assigned to current driver
  const activeDeliverOrders = allOrders.filter(o => 
    !isReturnOrder(o) &&
    (o.Status || "").trim().toLowerCase() === "out for delivery" &&
    (o.Driver || "").trim() === driverName
  );

  const activeReturnOrders = allOrders.filter(o => 
    isReturnOrder(o) &&
    (o.Status || "").trim().toLowerCase() === "pending" && 
    (o.Driver || "").trim() === driverName
  );

  const activeOrders = [...activeDeliverOrders, ...activeReturnOrders];

  // Render toggle segment group at the top regardless of card counts
  let html = `
    <div style="display: flex; background-color: #F1F5F9; border-radius: 20px; padding: 4px; margin-bottom: 20px; width: 100%; box-sizing: border-box; border: 1.5px solid var(--border-color); height: 40px; align-items: center; flex-shrink: 0; user-select: none;">
      <button onclick="setTimelineStart('warehouse')" style="flex: 1; height: 100%; border: none; border-radius: 16px; font-size: 13px; font-weight: 750; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; background-color: ${activeTimelineStart === 'warehouse' ? 'var(--app-color)' : 'transparent'}; color: ${activeTimelineStart === 'warehouse' ? '#FFFFFF' : 'var(--text-secondary)'}; transition: all 0.2s ease; outline: none; -webkit-tap-highlight-color: transparent;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 14px; height: 14px;">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
          <polyline points="9 22 9 12 15 12 15 22"></polyline>
        </svg>
        Warehouse
      </button>
      <button onclick="setTimelineStart('mylocation')" style="flex: 1; height: 100%; border: none; border-radius: 16px; font-size: 13px; font-weight: 750; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; background-color: ${activeTimelineStart === 'mylocation' ? 'var(--app-color)' : 'transparent'}; color: ${activeTimelineStart === 'mylocation' ? '#FFFFFF' : 'var(--text-secondary)'}; transition: all 0.2s ease; outline: none; -webkit-tap-highlight-color: transparent;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 14px; height: 14px;">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
          <circle cx="12" cy="10" r="3"></circle>
        </svg>
        My Location
      </button>
    </div>
  `;

  const isAppointmentToday = (order) => {
    const typeClean = (order.Type || '').trim().toLowerCase();
    if (typeClean !== 'appointment') return true;
    if (!order.Deadline) return true;
    const ts = Number(order.Deadline);
    if (isNaN(ts) || ts <= 0) return true;
    
    const orderDate = new Date(ts);
    const todayDate = new Date();
    return (
      orderDate.getDate() === todayDate.getDate() &&
      orderDate.getMonth() === todayDate.getMonth() &&
      orderDate.getFullYear() === todayDate.getFullYear()
    );
  };

  const todayOrders = activeOrders.filter(o => isAppointmentToday(o));
  const notTodayOrders = activeOrders.filter(o => !isAppointmentToday(o));

  if (todayOrders.length === 0 && notTodayOrders.length === 0) {
    html += '<div class="map-placeholder-text" style="padding: 30px 0;">No active delivery or return orders in your route.</div>';
    container.innerHTML = html;
    return;
  }

  // Resolve start parameters
  const startLatLng = activeTimelineStart === 'warehouse' ? [1.3197, 103.8962] : driverLatLng;
  const prioritize = activeTimelineStart === 'warehouse';

  // Sort today's orders 1 location to 1 location (nearest-neighbor TSP)
  const sortedTodayOrders = routeNearestNeighbor(startLatLng, todayOrders, prioritize);

  let currentLoc = startLatLng;

  if (sortedTodayOrders.length > 0) {
    // Timeline Start indicator
    const startLabel = activeTimelineStart === 'warehouse' ? "Warehouse" : "My Location";
    html += `
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 4px; padding-left: 14px; text-align: left; user-select: none;">
        <div style="width: 24px; height: 24px; border-radius: 50%; background-color: var(--app-color); display: flex; align-items: center; justify-content: center; color: white; border: 3px solid #E2E8F0; box-shadow: 0 1px 2px rgba(0,0,0,0.1); box-sizing: border-box;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" style="width: 10px; height: 10px;">
            <circle cx="12" cy="12" r="10"></circle>
          </svg>
        </div>
        <div style="font-size: 13px; font-weight: 850; color: var(--text-primary); letter-spacing: -0.01em;">
          Start: ${startLabel}
        </div>
      </div>
    `;

    sortedTodayOrders.forEach(order => {
      const orderLoc = getOrderLatLng(order);
      const distance = calculateDistanceKm(currentLoc[0], currentLoc[1], orderLoc[0], orderLoc[1]);
      
      // Update previous coordinate tracker
      currentLoc = orderLoc;

      // Vertical dotted line connecting nodes with distance label
      html += `
        <div style="display: flex; align-items: center; gap: 12px; height: 38px; padding-left: 25px; margin-top: -6px; margin-bottom: -6px; user-select: none;">
          <div style="width: 2px; height: 100%; border-left: 2px dashed #94A3B8; box-sizing: border-box;"></div>
          <div style="font-size: 11px; font-weight: 750; color: #475569; background-color: #F8FAFC; padding: 2px 8px; border-radius: 12px; border: 1.5px solid var(--border-color); font-family: var(--font-mono), monospace;">
            . - ${distance.toFixed(1)} km
          </div>
        </div>
      `;

      const isRet = isReturnOrder(order);
      const markColor = isRet ? "#7C3AED" : "#007A87";
      const markTextColor = "#FFFFFF";
      const postcode = order.Poscode || order.poscode || "";
      const zone = getZoneFromPostcode(postcode);
      const deliverTo = order.Deliver_To || order.deliver_to || "N/A";

      const typeClean = (order.Type || '').trim().toLowerCase();
      let bannerHtml = '';

      if (typeClean === 'urgent') {
        bannerHtml = `
          <div class="on-mode-card-banner urgent" style="border: none; border-top: 1.5px solid var(--border-color); border-radius: 0; margin: 0; padding: 8px 12px; justify-content: center; text-align: center;">
            Deliver by Today
          </div>
        `;
      } else if (typeClean === 'appointment') {
        const timeStr = formatAppointment(order.Deadline);
        bannerHtml = `
          <div class="on-mode-card-banner appointment" style="border: none; border-top: 1.5px solid var(--border-color); border-radius: 0; margin: 0; padding: 8px 12px; justify-content: center; text-align: center;">
            Deliver by ${timeStr}
          </div>
        `;
      }

      const actionText = isRet ? "Collect Return" : "Handover";

      html += `
        <div style="display: flex; flex-direction: column; width: 100%;">
          <div class="on-mode-order-card" id="on-mode-card-${order.ID}">
            <!-- Info Body -->
            <div style="display: flex; align-items: center; justify-content: space-between; height: 64px; padding: 0; box-sizing: border-box; width: 100%;">
              <!-- Left Side: Mark & Details -->
              <div style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; height: 100%;">
                <div style="background-color: ${markColor}; color: ${markTextColor}; width: 64px; height: 64px; font-size: 24px; font-weight: 850; display: flex; align-items: center; justify-content: center; flex-shrink: 0; line-height: 64px; user-select: none;">
                  ${order.Mark || "-"}
                </div>
                <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 2px; height: 100%;">
                  <div style="font-size: 14px; font-weight: 850; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2;">
                    ${order.ID}
                  </div>
                  <div style="font-size: 12px; color: var(--text-secondary); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; line-height: 1.2;">
                    ${deliverTo}
                  </div>
                  <div style="font-size: 11px; color: var(--text-muted); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2;">
                    ${postcode} - ${zone}
                  </div>
                </div>
              </div>
            </div>
            
            <!-- Banner Container (if any) -->
            ${bannerHtml}
            
            <!-- Bottom Action Buttons Row -->
            <div style="display: flex; align-items: stretch; height: 44px; background-color: #F8FAFC; border-top: 1.5px solid var(--border-color); width: 100%; box-sizing: border-box;">
              <!-- Handover (Left) -->
              <button class="card-footer-action-btn handover-btn" onclick="startDeliverAction('${order.ID}')" style="flex: 1; border: none; background: none; color: #10B981; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px; border-right: 1.5px solid var(--border-color); cursor: pointer; text-transform: uppercase; letter-spacing: 0.05em; font-family: 'Outfit', sans-serif;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                  <line x1="12" y1="22.08" x2="12" y2="12"></line>
                </svg>
                <span>${actionText}</span>
              </button>
              <!-- Navigate to (Right) -->
              <button class="card-footer-action-btn navigate-btn" onclick="navigateOrder('${order.ID}')" style="flex: 1; border: none; background: none; color: #3B82F6; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer; text-transform: uppercase; letter-spacing: 0.05em; font-family: 'Outfit', sans-serif;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
                  <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
                </svg>
                <span>Navigate to</span>
              </button>
            </div>
          </div>
        </div>
      `;
    });
  }

  // Render future appointments section (if any)
  if (notTodayOrders.length > 0) {
    // Sort future appointments starting from our last routed coordinate
    const sortedFutureOrders = routeNearestNeighbor(currentLoc, notTodayOrders, false);

    // Separator line
    html += `
      <div style="display: flex; align-items: center; gap: 12px; margin-top: 24px; margin-bottom: 16px; user-select: none;">
        <div style="flex: 1; border-top: 1.5px dashed #CBD5E1;"></div>
        <div style="font-size: 11px; font-weight: 800; color: #64748B; text-transform: uppercase; letter-spacing: 0.08em; background-color: #F1F5F9; padding: 4px 12px; border-radius: 12px; border: 1.5px solid var(--border-color); font-family: 'Outfit', sans-serif;">
          Future Deliveries
        </div>
        <div style="flex: 1; border-top: 1.5px dashed #CBD5E1;"></div>
      </div>
    `;

    // Render future appointment cards (without vertical connecting lines)
    sortedFutureOrders.forEach(order => {
      const isRet = isReturnOrder(order);
      const markColor = isRet ? "#7C3AED" : "#007A87";
      const markTextColor = "#FFFFFF";
      const postcode = order.Poscode || order.poscode || "";
      const zone = getZoneFromPostcode(postcode);
      const deliverTo = order.Deliver_To || order.deliver_to || "N/A";

      const typeClean = (order.Type || '').trim().toLowerCase();
      let bannerHtml = '';

      if (typeClean === 'urgent') {
        bannerHtml = `
          <div class="on-mode-card-banner urgent" style="border: none; border-top: 1.5px solid var(--border-color); border-radius: 0; margin: 0; padding: 8px 12px; justify-content: center; text-align: center;">
            Deliver by Today
          </div>
        `;
      } else if (typeClean === 'appointment') {
        const timeStr = formatAppointment(order.Deadline);
        bannerHtml = `
          <div class="on-mode-card-banner appointment" style="border: none; border-top: 1.5px solid var(--border-color); border-radius: 0; margin: 0; padding: 8px 12px; justify-content: center; text-align: center;">
            Deliver by ${timeStr}
          </div>
        `;
      }

      const actionText = isRet ? "Collect Return" : "Handover";

      html += `
        <div style="display: flex; flex-direction: column; width: 100%; margin-bottom: 12px;">
          <div class="on-mode-order-card" id="on-mode-card-${order.ID}" style="margin-bottom: 0;">
            <!-- Info Body -->
            <div style="display: flex; align-items: center; justify-content: space-between; height: 64px; padding: 0; box-sizing: border-box; width: 100%;">
              <!-- Left Side: Mark & Details -->
              <div style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; height: 100%;">
                <div style="background-color: ${markColor}; color: ${markTextColor}; width: 64px; height: 64px; font-size: 24px; font-weight: 850; display: flex; align-items: center; justify-content: center; flex-shrink: 0; line-height: 64px; user-select: none;">
                  ${order.Mark || "-"}
                </div>
                <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 2px; height: 100%;">
                  <div style="font-size: 14px; font-weight: 850; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2;">
                    ${order.ID}
                  </div>
                  <div style="font-size: 12px; color: var(--text-secondary); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; line-height: 1.2;">
                    ${deliverTo}
                  </div>
                  <div style="font-size: 11px; color: var(--text-muted); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2;">
                    ${postcode} - ${zone}
                  </div>
                </div>
              </div>
            </div>
            
            <!-- Banner Container (if any) -->
            ${bannerHtml}
            
            <!-- Bottom Action Buttons Row -->
            <div style="display: flex; align-items: stretch; height: 44px; background-color: #F8FAFC; border-top: 1.5px solid var(--border-color); width: 100%; box-sizing: border-box;">
              <!-- Handover (Left) -->
              <button class="card-footer-action-btn handover-btn" onclick="startDeliverAction('${order.ID}')" style="flex: 1; border: none; background: none; color: #10B981; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px; border-right: 1.5px solid var(--border-color); cursor: pointer; text-transform: uppercase; letter-spacing: 0.05em; font-family: 'Outfit', sans-serif;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                  <line x1="12" y1="22.08" x2="12" y2="12"></line>
                </svg>
                <span>${actionText}</span>
              </button>
              <!-- Navigate to (Right) -->
              <button class="card-footer-action-btn navigate-btn" onclick="navigateOrder('${order.ID}')" style="flex: 1; border: none; background: none; color: #3B82F6; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer; text-transform: uppercase; letter-spacing: 0.05em; font-family: 'Outfit', sans-serif;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
                  <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
                </svg>
                <span>Navigate to</span>
              </button>
            </div>
          </div>
        </div>
      `;
    });
  }

  container.innerHTML = html;
}

window.setTimelineStart = function(mode) {
  activeTimelineStart = mode;
  if (mode === 'mylocation') {
    showToast("Locating driver device...", "info");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        driverLatLng = [pos.coords.latitude, pos.coords.longitude];
        showToast("Device location resolved", "success");
        renderOnModeList();
      },
      (err) => {
        console.warn("Location permission denied or failed:", err);
        showToast("Location denied. Defaulting to Warehouse.", "warning");
        activeTimelineStart = 'warehouse';
        renderOnModeList();
      },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  } else {
    renderOnModeList();
  }
};

window.startDeliverAction = function(orderId) {
  const order = allOrders.find(o => o.ID === orderId);
  if (!order) return;
  const isReturn = String(order.Mark || '').trim().toUpperCase().startsWith('R');
  if (isReturn) {
    openDeliverPage(order, true);
  } else {
    openDeliverPage(order, false);
  }
};

window.navigateOrder = function(orderId) {
  const order = allOrders.find(o => o.ID === orderId);
  if (!order) return;
  let lat = Number(order.Latitude);
  let lng = Number(order.Longitude);
  if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
    const coords = getSingaporeLatLng(order.Poscode);
    lat = coords.lat;
    lng = coords.lng;
  }
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
};

window.openDeliverPage = function(order, isReturn) {
  currentDeliverOrder = order;
  currentDeliverIsReturn = !!isReturn;
  deliverSignedPhotoFile = null;
  deliverSupportingPhotoFiles = [];
  deliverItemTicks.clear();
  deliverItemQtys = {};
  deliverItemRemarks = {};

  const page = document.getElementById('deliver-page');
  if (page) page.classList.add('active');

  // Render header title
  const headerTitle = page.querySelector('.mobile-header-title');
  if (headerTitle) {
    headerTitle.textContent = isReturn ? "Collect Return" : "Deliver List";
  }

  const markBox = document.getElementById('deliver-order-mark');
  const idValue = document.getElementById('deliver-order-id');
  const deliverValue = document.getElementById('deliver-order-deliver');
  const zoneValue = document.getElementById('deliver-order-zone');
  const doPaperBtn = document.getElementById('deliver-do-paper-btn');

  const isRet = !!isReturn;
  const markColor = isRet ? "#7C3AED" : "#007A87";
  const markTextColor = "#FFFFFF";

  if (markBox) {
    markBox.textContent = order.Mark || '-';
    markBox.style.backgroundColor = markColor;
    markBox.style.color = markTextColor;
  }
  if (idValue) idValue.textContent = order.ID || 'N/A';
  if (deliverValue) deliverValue.textContent = order.Deliver_To || order.deliver_to || "N/A";
  if (zoneValue) {
    const postcode = order.Poscode || order.poscode || "";
    const zoneName = getZoneFromPostcode(postcode);
    zoneValue.textContent = postcode ? `${postcode} - ${zoneName}` : zoneName;
  }

  if (doPaperBtn) {
    const paperUrlRaw = order.Photo_DO_Paper || order.photo_do_paper || order.PhotoDoPaper || '';
    const parsedUrls = parseDOImages(paperUrlRaw);
    if (parsedUrls.length > 0) {
      doPaperBtn.style.display = 'flex';
      doPaperBtn.onclick = (e) => {
        e.stopPropagation();
        showLightbox(parsedUrls[0]);
      };
    } else {
      doPaperBtn.style.display = 'none';
    }
  }

  // Setup accordion and uploads
  const accordion = document.getElementById('deliver-items-accordion');
  const signedCameraBoxLabel = document.getElementById('deliver-signed-placeholder').querySelector('span');
  const proofTitle = document.getElementById('deliver-proof-title');
  const signedTitle = document.getElementById('deliver-signed-title');
  const submitBtn = document.getElementById('deliver-submit-btn');

  if (isReturn) {
    if (accordion) accordion.style.display = 'none';
    if (proofTitle) proofTitle.textContent = "Proof of Collected";
    if (signedTitle) signedTitle.textContent = "Signed Return Paper (Mandatory)";
    if (signedCameraBoxLabel) signedCameraBoxLabel.textContent = "TAP TO CAPTURE SIGNED RETURN PAPER";
    if (submitBtn) {
      submitBtn.textContent = "Collect Return";
      submitBtn.className = "picking-action-btn disabled-mode";
    }
  } else {
    if (accordion) accordion.style.display = 'flex';
    if (proofTitle) proofTitle.textContent = "Proof of Delivery";
    if (signedTitle) signedTitle.textContent = "Signed DO / GRN Photo (Mandatory)";
    if (signedCameraBoxLabel) signedCameraBoxLabel.textContent = "TAP TO CAPTURE SIGNED DO / GRN";
    if (submitBtn) {
      submitBtn.textContent = "Deliver Goods";
      submitBtn.className = "picking-action-btn disabled-mode";
    }

    // Populate items
    renderDeliverItemsList(order);
  }

  // Clear Signed Paper preview and resets
  const signedPreview = document.getElementById('deliver-signed-preview');
  const signedPlaceholder = document.getElementById('deliver-signed-placeholder');
  if (signedPreview) signedPreview.classList.add('hidden');
  if (signedPlaceholder) signedPlaceholder.classList.remove('hidden');

  const accordionBody = document.getElementById('deliver-accordion-body');
  const arrowSvg = document.getElementById('deliver-accordion-toggle-btn').querySelector('svg');
  if (accordionBody) accordionBody.style.display = 'block';
  if (arrowSvg) arrowSvg.style.transform = 'rotate(0deg)';

  renderSupportingPhotoGrid();
  updateDeliverSubmitButtonState();
};

function renderSupportingPhotoGrid() {
  const grid = document.getElementById('deliver-supporting-grid');
  if (!grid) return;

  grid.innerHTML = '';

  for (let i = 0; i < 5; i++) {
    const isSlotFilled = i < deliverSupportingPhotoFiles.length;
    const isSlotActive = i === deliverSupportingPhotoFiles.length;

    const slotDiv = document.createElement('div');
    slotDiv.className = 'camera-upload-box';
    slotDiv.style.width = '100%';
    slotDiv.style.aspectRatio = '1/1';
    slotDiv.style.border = isSlotFilled ? '1.5px solid var(--border-color)' : (isSlotActive ? '1.5px dashed var(--app-color)' : '1.5px dashed #CBD5E1');
    slotDiv.style.borderRadius = '8px';
    slotDiv.style.position = 'relative';
    slotDiv.style.overflow = 'hidden';
    slotDiv.style.display = 'flex';
    slotDiv.style.alignItems = 'center';
    slotDiv.style.justifyContent = 'center';
    slotDiv.style.backgroundColor = isSlotFilled ? '#FFFFFF' : (isSlotActive ? '#F0FDF4' : '#F8FAFC');
    slotDiv.style.cursor = isSlotFilled || isSlotActive ? 'pointer' : 'default';

    if (isSlotFilled) {
      const file = deliverSupportingPhotoFiles[i];
      const imgUrl = URL.createObjectURL(file);

      slotDiv.innerHTML = `
        <img src="${imgUrl}" style="width: 100%; height: 100%; object-fit: cover;">
        <button onclick="removeSupportingPhoto(${i}, event)" style="position: absolute; top: 4px; right: 4px; border: none; background: rgba(0,0,0,0.6); color: white; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; cursor: pointer; outline: none; -webkit-tap-highlight-color: transparent;">&times;</button>
      `;
    } else {
      const strokeColor = isSlotActive ? 'var(--app-color)' : '#94A3B8';
      slotDiv.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="2.5" style="width: 20px; height: 20px;">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
          <circle cx="12" cy="13" r="4"></circle>
        </svg>
        <input type="file" accept="image/*" capture="environment" onchange="onSupportingPhotoSelected(this, ${i})" style="display: none;">
      `;
      
      if (isSlotActive) {
        slotDiv.onclick = () => {
          slotDiv.querySelector('input').click();
        };
      }
    }

    grid.appendChild(slotDiv);
  }
}

window.onSupportingPhotoSelected = function(input, index) {
  if (input.files && input.files[0]) {
    const file = input.files[0];
    deliverSupportingPhotoFiles.push(file);
    renderSupportingPhotoGrid();
    updateDeliverSubmitButtonState();
  }
};

window.removeSupportingPhoto = function(index, e) {
  if (e) e.stopPropagation();
  deliverSupportingPhotoFiles.splice(index, 1);
  renderSupportingPhotoGrid();
  updateDeliverSubmitButtonState();
};

function renderDeliverItemsList(order) {
  const container = document.getElementById('deliver-items-list-container');
  if (!container) return;

  container.innerHTML = '';

  const items = typeof order.Items === 'string' ? JSON.parse(order.Items || '[]') : (order.Items || []);
  if (items.length === 0) {
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: #64748B;">No items to display.</div>';
    return;
  }

  const placeholderImg = "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2264%22%20height%3D%2264%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2394A3B8%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Crect%20x%3D%223%22%20y%3D%223%22%20width%3D%2218%22%20height%3D%2218%22%20rx%3D%222%22%20ry%3D%222%22%2F%3E%3Ccircle%20cx%3D%228.5%22%20cy%3D%228.5%22%20r%3D%221.5%22%2F%3E%3Cpolyline%20points%3D%2221%2015%2016%2010%205%2021%22%2F%3E%3C%2Fsvg%3E";

  const mapped = items.map((item, index) => {
    const prod = allProducts.find(p => (p.SKU || p.sku || '').toUpperCase() === (item.sku || '').toUpperCase());
    let brandName = 'Other Brands';
    let prodName = item.sku;
    let imgUrl = '';

    if (prod) {
      prodName = prod["Display Name"] || prod.name || item.sku;
      imgUrl = prod.Image || prod.image || '';
      const brandId = prod["Brands ID"] || prod.Brands_ID || prod.brandId;
      if (brandId) {
        const brand = allBrands.find(b => b.ID === brandId || b.id === brandId);
        if (brand) {
          brandName = brand["Display Name"] || brand.name || 'Other Brands';
        }
      }
    }

    if (deliverItemQtys[item.sku] === undefined) {
      deliverItemQtys[item.sku] = item.qty;
    }

    return {
      sku: item.sku,
      qty: item.qty,
      name: prodName,
      image: imgUrl,
      brand: brandName,
      originalIndex: index
    };
  });

  const groups = {};
  mapped.forEach(item => {
    if (!groups[item.brand]) {
      groups[item.brand] = [];
    }
    groups[item.brand].push(item);
  });

  const sortedBrands = Object.keys(groups).sort();

  sortedBrands.forEach(brand => {
    groups[brand].sort((a, b) => a.sku.localeCompare(b.sku));

    const section = document.createElement('div');
    section.className = 'picking-brand-section';
    section.style.textAlign = 'left';

    const title = document.createElement('div');
    title.className = 'picking-brand-title';
    title.textContent = brand;
    section.appendChild(title);

    groups[brand].forEach(item => {
      const isTicked = deliverItemTicks.has(item.sku);
      const currentQty = deliverItemQtys[item.sku];
      const isDiscrepancy = currentQty < item.qty;
      const remarkVal = deliverItemRemarks[item.sku] || '';

      // Parent wrapper for item card + optional discrepancy remark
      const cardWrapper = document.createElement('div');
      cardWrapper.style.display = 'flex';
      cardWrapper.style.flexDirection = 'column';
      cardWrapper.style.width = '100%';
      cardWrapper.style.marginBottom = '10px';

      const card = document.createElement('div');
      card.className = 'picking-item-card';
      card.style.marginBottom = '0'; // Let wrapper handle margin-bottom

      const seqText = `${order.Mark || "A"}${item.originalIndex + 1}`;

      card.innerHTML = `
        <!-- Left Side: Image + Badge -->
        <div class="picking-item-img-container" style="position: relative; cursor: pointer; overflow: hidden;" onclick="showLightbox('${item.image || placeholderImg}')">
          <img class="picking-item-img" src="${item.image || placeholderImg}" onerror="this.onerror=null; this.src='${placeholderImg}';">
          <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background-color: rgba(0, 0, 0, 0.5); display: flex; align-items: center; justify-content: center; color: #FFFFFF; font-size: 18px; font-weight: 850; pointer-events: none; user-select: none;">
            ${seqText}
          </div>
        </div>

        <!-- Middle Side: SKU & Description -->
        <div class="picking-item-content" style="flex: 1; min-width: 0; text-align: left; display: flex; flex-direction: column; justify-content: center;">
          <div style="font-size: 13px; font-weight: 800; color: var(--text-primary); line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.sku}</div>
          <div style="font-size: 11px; color: var(--text-muted); font-weight: 500; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; display: block; margin-top: 2px;">${item.name}</div>
        </div>

        <!-- Right Side: Adjuster + Tick Checkbox -->
        <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0; padding: 0 12px; border-left: 1.5px solid var(--border-color); height: 64px; box-sizing: border-box;">
          <div class="deliver-qty-adjuster ${isTicked ? 'disabled' : ''}">
            <button class="deliver-qty-btn" onclick="event.stopPropagation(); adjustDeliverQty('${item.sku}', -1)">-</button>
            <div class="deliver-qty-val" id="qty-val-${item.sku}">${currentQty}</div>
            <button class="deliver-qty-btn" onclick="event.stopPropagation(); adjustDeliverQty('${item.sku}', 1)">+</button>
          </div>
          
          <div class="deliver-check-circle ${isTicked ? 'checked' : ''}" onclick="event.stopPropagation(); toggleDeliverItemTick('${item.sku}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
        </div>
      `;

      cardWrapper.appendChild(card);

      // Discrepancy Remark Textarea Container (Renders outside card to prevent layout collapse)
      const remarkDiv = document.createElement('div');
      remarkDiv.className = `deliver-remark-container ${isDiscrepancy ? '' : 'hidden'}`;
      remarkDiv.id = `remark-container-${item.sku}`;
      remarkDiv.style.marginTop = '4px';
      remarkDiv.innerHTML = `
        <textarea class="deliver-remark-input" id="remark-input-${item.sku}" placeholder="Write reason for shortage / discrepancy... (Mandatory)" oninput="onDeliverRemarkInput('${item.sku}', this.value)">${remarkVal}</textarea>
      `;
      cardWrapper.appendChild(remarkDiv);

      section.appendChild(cardWrapper);
    });

    container.appendChild(section);
  });
}

window.adjustDeliverQty = function(sku, dir) {
  if (deliverItemTicks.has(sku)) return;

  const item = typeof currentDeliverOrder.Items === 'string' ? JSON.parse(currentDeliverOrder.Items || '[]').find(i => i.sku === sku) : (currentDeliverOrder.Items || []).find(i => i.sku === sku);
  if (!item) return;

  const originalQty = item.qty;
  const currentVal = deliverItemQtys[sku] || originalQty;
  const newVal = Math.max(0, Math.min(originalQty, currentVal + dir));

  deliverItemQtys[sku] = newVal;

  const valEl = document.getElementById(`qty-val-${sku}`);
  if (valEl) valEl.textContent = newVal;

  const remarkContainer = document.getElementById(`remark-container-${sku}`);
  if (remarkContainer) {
    if (newVal < originalQty) {
      remarkContainer.classList.remove('hidden');
    } else {
      remarkContainer.classList.add('hidden');
      deliverItemRemarks[sku] = '';
    }
  }

  updateDeliverSubmitButtonState();
};

window.toggleDeliverItemTick = function(sku) {
  if (deliverItemTicks.has(sku)) {
    deliverItemTicks.delete(sku);
  } else {
    deliverItemTicks.add(sku);
  }
  
  renderDeliverItemsList(currentDeliverOrder);
  updateDeliverSubmitButtonState();
};

window.onDeliverRemarkInput = function(sku, val) {
  deliverItemRemarks[sku] = val;
  updateDeliverSubmitButtonState();
};

function updateDeliverSubmitButtonState() {
  const submitBtn = document.getElementById('deliver-submit-btn');
  if (!submitBtn) return;

  if (!deliverSignedPhotoFile) {
    submitBtn.classList.add('disabled-mode');
    return;
  }

  if (deliverSupportingPhotoFiles.length === 0) {
    submitBtn.classList.add('disabled-mode');
    return;
  }

  if (currentDeliverIsReturn) {
    submitBtn.classList.remove('disabled-mode');
    return;
  }

  const items = typeof currentDeliverOrder.Items === 'string' ? JSON.parse(currentDeliverOrder.Items || '[]') : (currentDeliverOrder.Items || []);
  const allTicked = items.every(item => deliverItemTicks.has(item.sku));
  if (!allTicked) {
    submitBtn.classList.add('disabled-mode');
    return;
  }

  const hasDiscrepancyRemarkEmpty = items.some(item => {
    const originalQty = item.qty;
    const currentQty = deliverItemQtys[item.sku] !== undefined ? deliverItemQtys[item.sku] : originalQty;
    if (currentQty < originalQty) {
      const remark = (deliverItemRemarks[item.sku] || '').trim();
      return remark.length === 0;
    }
    return false;
  });

  if (hasDiscrepancyRemarkEmpty) {
    submitBtn.classList.add('disabled-mode');
    return;
  }

  submitBtn.classList.remove('disabled-mode');
}

function bindDeliverPageEvents() {
  const backBtn = document.getElementById('deliver-back-btn');
  const cancelBtn = document.getElementById('deliver-cancel-btn');
  const closePage = () => {
    document.getElementById('deliver-page').classList.remove('active');
  };
  if (backBtn) backBtn.onclick = closePage;
  if (cancelBtn) cancelBtn.onclick = closePage;

  const cameraBox = document.getElementById('deliver-signed-camera-box');
  const fileInput = document.getElementById('deliver-signed-input');
  if (cameraBox && fileInput) {
    cameraBox.onclick = () => fileInput.click();
    
    fileInput.onchange = (e) => {
      if (fileInput.files && fileInput.files[0]) {
        const file = fileInput.files[0];
        deliverSignedPhotoFile = file;
        
        const preview = document.getElementById('deliver-signed-preview');
        const placeholder = document.getElementById('deliver-signed-placeholder');
        if (preview) {
          preview.src = URL.createObjectURL(file);
          preview.classList.remove('hidden');
        }
        if (placeholder) placeholder.classList.add('hidden');
        
        updateDeliverSubmitButtonState();
      }
    };
  }

  const accordionHeader = document.getElementById('deliver-accordion-header');
  const accordionBody = document.getElementById('deliver-accordion-body');
  const arrowSvg = document.getElementById('deliver-accordion-toggle-btn').querySelector('svg');
  if (accordionHeader && accordionBody) {
    accordionHeader.onclick = () => {
      const isCollapsed = accordionBody.style.display === 'none';
      if (isCollapsed) {
        accordionBody.style.display = 'block';
        if (arrowSvg) arrowSvg.style.transform = 'rotate(0deg)';
      } else {
        accordionBody.style.display = 'none';
        if (arrowSvg) arrowSvg.style.transform = 'rotate(180deg)';
      }
    };
  }

  const submitBtn = document.getElementById('deliver-submit-btn');
  if (submitBtn) {
    submitBtn.onclick = () => {
      if (submitBtn.classList.contains('disabled-mode')) {
        showToast("Please complete the checklist and upload all required proofs first!", "warning");
        return;
      }
      
      authPendingAction = {
        type: 'deliver_goods',
        orderId: currentDeliverOrder.ID,
        isReturn: currentDeliverIsReturn,
        signedFile: deliverSignedPhotoFile,
        supportingFiles: deliverSupportingPhotoFiles,
        itemQtys: deliverItemQtys,
        itemRemarks: deliverItemRemarks
      };
      
      openAuthPage();
    };
  }

  const waCloseBtn = document.getElementById('whatsapp-close-btn');
  const waCopyBtn = document.getElementById('whatsapp-copy-btn');
  const waSendBtn = document.getElementById('whatsapp-send-btn');
  const waDrawer = document.getElementById('whatsapp-share-drawer');
  const closeWaDrawer = () => {
    if (waDrawer) {
      const card = document.getElementById('whatsapp-share-drawer-card');
      if (card) card.style.transform = 'translateY(100%)';
      setTimeout(() => { waDrawer.style.display = 'none'; }, 300);
    }
  };

  if (waCloseBtn) waCloseBtn.onclick = closeWaDrawer;
  
  if (waCopyBtn) {
    waCopyBtn.onclick = () => {
      const textArea = document.getElementById('whatsapp-text-area');
      if (textArea) {
        textArea.select();
        textArea.setSelectionRange(0, 99999);
        navigator.clipboard.writeText(textArea.value);
        showToast("Summary copied to clipboard!", "success");
      }
    };
  }

  if (waSendBtn) {
    waSendBtn.onclick = async () => {
      const textArea = document.getElementById('whatsapp-text-area');
      const text = textArea ? textArea.value : '';
      
      let shared = false;
      
      if (navigator.share && navigator.canShare) {
        const filesToShare = [];
        
        // Add signed paper photo
        if (deliverSignedPhotoFile) {
          try {
            const ext = deliverSignedPhotoFile.type.split('/')[1] || 'jpg';
            const fileObj = new File([deliverSignedPhotoFile], `signed_do_${Date.now()}.${ext}`, { type: deliverSignedPhotoFile.type });
            filesToShare.push(fileObj);
          } catch (e) {
            console.error("Failed to construct signed DO file for sharing:", e);
          }
        }
        
        // Add supporting photos
        if (Array.isArray(deliverSupportingPhotoFiles)) {
          deliverSupportingPhotoFiles.forEach((file, index) => {
            if (file) {
              try {
                const ext = file.type.split('/')[1] || 'jpg';
                const fileObj = new File([file], `supporting_proof_${index + 1}_${Date.now()}.${ext}`, { type: file.type });
                filesToShare.push(fileObj);
              } catch (e) {
                console.error("Failed to construct supporting file for sharing:", e);
              }
            }
          });
        }
        
        // If filesToShare is empty but we have R2 URLs (past completed order)
        if (filesToShare.length === 0 && currentWhatsAppShareUrls.length > 0) {
          showToast("Preparing photos for sharing...", "info");
          for (let i = 0; i < currentWhatsAppShareUrls.length; i++) {
            try {
              const url = currentWhatsAppShareUrls[i];
              const res = await fetch(url);
              const blob = await res.blob();
              const ext = blob.type.split('/')[1] || 'jpg';
              const filename = `proof_${i + 1}_${Date.now()}.${ext}`;
              const fileObj = new File([blob], filename, { type: blob.type });
              filesToShare.push(fileObj);
            } catch (fetchErr) {
              console.error("Failed to download proof image for sharing:", fetchErr);
            }
          }
        }
        
        if (filesToShare.length > 0) {
          try {
            if (navigator.canShare({ files: filesToShare })) {
              const shareId = currentDeliverOrder ? (currentDeliverOrder.ID || '') : '';
              await navigator.share({
                files: filesToShare,
                text: text,
                title: `Proof - ${shareId}`
              });
              shared = true;
            }
          } catch (shareErr) {
            console.warn("Native Web Share failed:", shareErr);
            shared = true;
            showToast("Sharing cancelled.", "info");
          }
        }
      }
      
      if (!shared) {
        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
      }
    };
  }
}

function showJobConfirmModal(toOn) {
  const modal = document.getElementById('job-confirm-modal');
  const title = document.getElementById('job-modal-title');
  const desc = document.getElementById('job-modal-desc');
  const confirmBtn = document.getElementById('job-modal-confirm-btn');

  if (!modal) return;

  if (toOn) {
    if (title) title.textContent = "Start Delivery?";
    if (desc) desc.textContent = "Confirm all things load and start Delivery?";
    if (confirmBtn) {
      confirmBtn.textContent = "Start Delivery";
      confirmBtn.style.backgroundColor = "#10B981"; // Green
    }
  } else {
    if (title) title.textContent = "End Delivery?";
    if (desc) desc.textContent = "Do you confirm to end the job?";
    if (confirmBtn) {
      confirmBtn.textContent = "End Job";
      confirmBtn.style.backgroundColor = "#EF4444"; // Red
    }
  }

  modal.style.display = 'flex';
}

async function syncDeliverJob(jobId, action, fields) {
  try {
    const payload = {
      sheet: "Deliver_Job",
      action: action,
      data: {
        ID: jobId,
        ...fields
      }
    };
    
    const res = await fetch(`${WORKER_URL}/api/app/driver/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      console.warn("Background job update sync failed with status:", res.status);
      throw new Error(`Server returned status ${res.status}`);
    }
    const result = await res.json();
    if (result.error) {
      console.warn("Background job update sync failed:", result.error);
      throw new Error(result.error);
    }
  } catch (e) {
    console.warn("Job sync failed:", e);
    showToast("Network sync issue. Saved locally.", "warning");
  }
}

// ==========================================================
// Reusable Re-Auth Modal & Image Upload & Canvas Compression
// ==========================================================

function handleUnloadGoodsAction(order) {
  currentUnloadOrder = order;
  unloadModalMode = "unload";
  openUnloadModal();
}

function handlePickReturnPaperAction(order) {
  currentUnloadOrder = order;
  unloadModalMode = "pick_return";
  unloadPhotoFile = returnPaperPhotoFile;
  openUnloadModal();
}

function handleUnpickReturnPaperAction(order) {
  currentUnloadOrder = order;
  unloadModalMode = "unpick_return";
  openUnloadModal();
}

function openUnloadModal() {
  const modal = document.getElementById('unload-proof-modal');
  const title = document.getElementById('unload-proof-title');
  const desc = document.getElementById('unload-camera-desc');
  const pinLabel = document.getElementById('unload-pin-label');
  const confirmBtn = document.getElementById('unload-modal-confirm-btn');

  if (!modal) return;

  clearUnloadForm();

  const cameraBox = document.getElementById('unload-camera-box');
  if (cameraBox) cameraBox.style.display = 'block';
  if (desc) desc.style.display = 'block';

  if (unloadModalMode === "unload") {
    if (title) title.textContent = "Unload Goods Proof";
    if (desc) desc.textContent = "Tap to Capture Photo";
    if (pinLabel) pinLabel.textContent = "ENTER PIN TO RECONFIRM";
    if (confirmBtn) {
      confirmBtn.textContent = "Unload Goods";
      confirmBtn.style.backgroundColor = "#10B981"; // Green
    }
  } else if (unloadModalMode === "pick_return") {
    if (cameraBox) cameraBox.style.display = 'none';
    if (desc) desc.style.display = 'none';
    if (title) title.textContent = "Confirm Pick Return Paper";
    if (pinLabel) pinLabel.textContent = "ENTER PIN TO SUBMIT";
    if (confirmBtn) {
      confirmBtn.textContent = "Submit Paper";
      confirmBtn.style.backgroundColor = "#10B981"; // Green
    }
  } else if (unloadModalMode === "unpick_return") {
    if (title) title.textContent = "Unpick Return Paper Proof";
    if (desc) desc.textContent = "Snap picture of paper given to admin";
    if (pinLabel) pinLabel.textContent = "ENTER PIN TO CONFIRM UNPICK";
    if (confirmBtn) {
      confirmBtn.textContent = "Confirm Unpick";
      confirmBtn.style.backgroundColor = "#10B981"; // Green
    }
  }

  modal.style.display = 'flex';
}

function bindUnloadProofModal() {
  const cameraBox = document.getElementById('unload-camera-box');
  const cameraInput = document.getElementById('unload-camera-input');
  const previewImg = document.getElementById('unload-camera-preview');
  const placeholder = document.getElementById('unload-camera-placeholder');
  
  if (cameraBox && cameraInput) {
    cameraBox.addEventListener('click', () => {
      cameraInput.click();
    });

    cameraInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        unloadPhotoFile = file;
        const reader = new FileReader();
        reader.onload = (event) => {
          if (previewImg) {
            previewImg.src = event.target.result;
            previewImg.classList.remove('hidden');
          }
          if (placeholder) {
            placeholder.style.display = 'none';
          }
          validateUnloadForm();
        };
        reader.readAsDataURL(file);
      }
    });
  }

  // Bind PIN Input Display Mapping
  const hiddenInput = document.getElementById('unload-pin-hidden');
  const displays = document.querySelectorAll('#unload-proof-modal .pin-digit-display');
  const pinInput = document.getElementById('unload-pin-input');
  const wrapper = document.getElementById('unload-pin-digits-wrapper');

  if (hiddenInput && wrapper) {
    wrapper.addEventListener('click', () => {
      hiddenInput.focus();
    });

    hiddenInput.addEventListener('input', () => {
      let val = hiddenInput.value.replace(/[^0-9]/g, '');
      if (val.length > 4) {
        val = val.substring(0, 4);
      }
      hiddenInput.value = val;
      if (pinInput) pinInput.value = val;

      // Update dot displays
      displays.forEach((display, idx) => {
        if (idx < val.length) {
          display.textContent = '●';
          display.classList.remove('active');
        } else {
          display.textContent = '';
          if (idx === val.length) {
            display.classList.add('active');
          } else {
            display.classList.remove('active');
          }
        }
      });

      validateUnloadForm();
    });

    hiddenInput.addEventListener('focus', () => {
      const val = hiddenInput.value;
      displays.forEach((display, idx) => {
        if (idx === val.length) {
          display.classList.add('active');
        } else {
          display.classList.remove('active');
        }
      });
    });

    hiddenInput.addEventListener('blur', () => {
      displays.forEach(display => display.classList.remove('active'));
    });
  }

  // Bind Close and Cancel Buttons
  const cancelBtn = document.getElementById('unload-modal-cancel-btn');
  const closeBtn = document.getElementById('unload-proof-close-btn');
  const modal = document.getElementById('unload-proof-modal');

  const closeModal = () => {
    if (modal) modal.style.display = 'none';
    clearUnloadForm();
  };

  if (cancelBtn) cancelBtn.onclick = closeModal;
  if (closeBtn) closeBtn.onclick = closeModal;

  // Bind Submit Reconfirmation
  const confirmBtn = document.getElementById('unload-modal-confirm-btn');
  if (confirmBtn) {
    confirmBtn.onclick = async () => {
      const pinInput = document.getElementById('unload-pin-input');
      const pinVal = pinInput ? pinInput.value : '';
      if (!unloadPhotoFile || pinVal.length !== 4) {
        showToast("Please capture a photo and enter your PIN", "error");
        return;
      }

      // Verify PIN
      const enteredPin = parseInt(pinVal);
      const matchedUser = allUsers.find(u => parseInt(u.PIN || u.pin) === enteredPin);
      if (!matchedUser) {
        const hiddenInput = document.getElementById('unload-pin-hidden');
        if (hiddenInput) hiddenInput.classList.add('error');
        const displays = document.querySelectorAll('#unload-proof-modal .pin-digit-display');
        displays.forEach(display => display.classList.add('error'));
        showToast("Incorrect PIN. Please try again.", "error");
        
        setTimeout(() => {
          if (hiddenInput) {
            hiddenInput.value = '';
            hiddenInput.classList.remove('error');
          }
          if (pinInput) pinInput.value = '';
          displays.forEach((display, idx) => {
            display.textContent = '';
            display.classList.remove('error');
            if (idx === 0) display.classList.add('active');
            else display.classList.remove('active');
          });
          validateUnloadForm();
        }, 600);
        return;
      }

      // PIN validated successfully! Send uploads
      const driverName = matchedUser.Name || matchedUser.name || 'Driver';
      showToast("Uploading proof and syncing...", "info");

      try {
        const compressedFile = await compressImageToMax250kb(unloadPhotoFile);
        const doNumber = currentUnloadOrder.DO_Number || currentUnloadOrder.do_number || 'UNKNOWN';
        
        let subFolder = "Unload_Proof";
        if (unloadModalMode === "pick_return") {
          subFolder = "Return_Proof";
        } else if (unloadModalMode === "unpick_return") {
          subFolder = "Return_Proof_Admin";
        }

        const fileName = `Track_Orders/${subFolder}/${doNumber}_${Date.now()}.jpg`;
        const uploadUrl = `${WORKER_URL}/api/upload?filename=${encodeURIComponent(fileName)}`;

        const uploadRes = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg' },
          body: compressedFile
        });

        let photoUrl = '';
        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          if (uploadData.success) {
            photoUrl = uploadData.url;
          } else {
            throw new Error("Upload response success=false");
          }
        } else {
          throw new Error(`Upload failed with status ${uploadRes.status}`);
        }

        // Apply state updates depending on modal mode
        let logs = [];
        try {
          logs = JSON.parse(currentUnloadOrder.Logs || '[]');
        } catch (_) {}

        if (unloadModalMode === "unload") {
          logs.push({
            action: "Unload Goods",
            actionBy: driverName,
            remark: "Unloaded goods from vehicle back to warehouse",
            timestamp: Date.now(),
            photoUrl: photoUrl
          });

          await silentSyncOrderUpdate(currentUnloadOrder.ID, {
            Status: "Ready to Deliver",
            Driver: "",
            Logs: JSON.stringify(logs)
          });

          showToast("Unload Goods completed successfully!", "success");
          clearMapOrderDetails();
        } else if (unloadModalMode === "pick_return") {
          logs.push({
            action: "Pick Return Paper",
            actionBy: driverName,
            remark: "Return Paper photo submitted",
            timestamp: Date.now(),
            photoUrl: photoUrl
          });

          await silentSyncOrderUpdate(currentUnloadOrder.ID, {
            Driver: driverName,
            Photo_Return_Paper: photoUrl,
            Logs: JSON.stringify(logs)
          });

          showToast("Return Paper submitted successfully!", "success");
          returnPaperPhotoFile = null;
          
          // Re-render pins and reload details
          renderMapPins();
          const updatedOrder = allOrders.find(o => o.ID === currentUnloadOrder.ID);
          if (updatedOrder) {
            const activePin = { color: "#7C3AED", textColor: "#FFFFFF" };
            renderMapOrderDetails(updatedOrder, activePin);
          }
        } else if (unloadModalMode === "unpick_return") {
          logs.push({
            action: "Unpick Return Paper",
            actionBy: driverName,
            remark: "Returned paper given to admin",
            timestamp: Date.now(),
            photoUrl: photoUrl
          });

          await silentSyncOrderUpdate(currentUnloadOrder.ID, {
            Status: "pending",
            Driver: "",
            Photo_Return_Paper: "",
            Photo_Return_Paper_Admin: photoUrl,
            Logs: JSON.stringify(logs)
          });

          showToast("Unpick Return Paper completed!", "success");
          clearMapOrderDetails();
        }

        // Hide overlay and reset
        if (modal) modal.style.display = 'none';
        clearUnloadForm();
      } catch (error) {
        console.error("Submission failed:", error);
        showToast("Submission failed: " + error.message, "error");
      }
    };
  }
}

function clearUnloadForm() {
  unloadPhotoFile = null;
  const cameraBox = document.getElementById('unload-camera-box');
  if (cameraBox) cameraBox.style.display = 'block';
  const previewImg = document.getElementById('unload-camera-preview');
  const placeholder = document.getElementById('unload-camera-placeholder');
  const cameraInput = document.getElementById('unload-camera-input');
  const hiddenInput = document.getElementById('unload-pin-hidden');
  const pinInput = document.getElementById('unload-pin-input');
  const displays = document.querySelectorAll('#unload-proof-modal .pin-digit-display');

  if (previewImg) {
    previewImg.src = '';
    previewImg.classList.add('hidden');
  }
  if (placeholder) {
    placeholder.style.display = 'flex';
  }
  if (cameraInput) {
    cameraInput.value = '';
  }
  if (hiddenInput) {
    hiddenInput.value = '';
    hiddenInput.classList.remove('error');
  }
  if (pinInput) {
    pinInput.value = '';
  }
  displays.forEach((display, idx) => {
    display.textContent = '';
    display.classList.remove('error');
    if (idx === 0) {
      display.classList.add('active');
    } else {
      display.classList.remove('active');
    }
  });

  const confirmBtn = document.getElementById('unload-modal-confirm-btn');
  if (confirmBtn) {
    confirmBtn.classList.add('disabled-mode');
  }
}

function validateUnloadForm() {
  const pinInput = document.getElementById('unload-pin-input');
  const pinVal = pinInput ? pinInput.value : '';
  const confirmBtn = document.getElementById('unload-modal-confirm-btn');

  const isValid = unloadPhotoFile !== null && pinVal.length === 4;

  if (confirmBtn) {
    if (isValid) {
      confirmBtn.classList.remove('disabled-mode');
    } else {
      confirmBtn.classList.add('disabled-mode');
    }
  }
}

// Canvas client-side JPEG image compression
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

        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('Canvas compression returned empty blob'));
            return;
          }
          const name = file.name || 'image.jpg';
          const compressedFile = new File([blob], name, {
            type: 'image/jpeg',
            lastModified: Date.now()
          });
          resolve({
            file: compressedFile
          });
        }, 'image/jpeg', quality);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}

async function compressImageToMax250kb(file) {
  let maxDim = 1200;
  let quality = 0.70;
  let result = await compressImage(file, maxDim, maxDim, quality);
  
  let attempts = 0;
  while (result.file.size > 250 * 1024 && attempts < 3) {
    maxDim -= 200;
    quality -= 0.15;
    if (quality < 0.20) quality = 0.20;
    result = await compressImage(file, maxDim, maxDim, quality);
    attempts++;
  }
  return result.file;
}
