// Desktop Redirect Check (Mobile-only check matching Merchandiser App)
if (window.innerWidth > 600) {
  window.location.href = '../index.html';
}

const WORKER_URL = 'https://ib.hsgglobalpteltd.workers.dev';
const APP_VERSION = "26.0.1";

// App State
let allOrders = [];
let activeTab = 'Pending'; // 'Pending', 'Goods Ready', 'Complete'
let activeSubTab = 'All';  // 'All', 'Urgent', 'Appointment', 'Normal' OR 'All', 'Ready to Deliver', 'Load', 'Out for Delivery'
let searchQuery = '';
let isFetchingData = false;
let lastRefreshTime = Date.now();
let toastTimeout = null;

let allProducts = [];
let allBrands = [];
let allUsers = [];
let currentOrder = null;
let checkedItems = {};
let capturedPhotoFile = null;
let authPendingAction = null;
let handoverPhotoFile = null;

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

// Truncate Deliver_To text to max N characters ending with 3 dots (...) if it exceeds N characters
function truncateDeliverTo(text, limit = 12) {
  if (!text) return '';
  if (text.length > limit) {
    return text.substring(0, limit) + '...';
  }
  return text;
}

// Get Singapore Zone based on 6-digit postcode (first 2 digits)
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

// Calculate relative time elapsed (e.g. 2h ago, 3d ago, 15m ago)
function getRelativeTime(ts) {
  if (!ts) return '';
  const diffMs = Date.now() - Number(ts);
  if (isNaN(diffMs) || diffMs < 0) return 'just now';
  
  const diffMins = Math.floor(diffMs / (60 * 1000));
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
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

  // Dynamic Tab bar rendering
  renderTabs();

  // Bind Expandable Search Bar controls
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
      renderOrdersList();
    });

    if (searchClearBtn) {
      searchClearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        searchInput.value = '';
        searchQuery = '';
        searchClearBtn.classList.add('hidden');
        searchInput.focus();
        renderOrdersList();
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

  // Bind Picking List back button
  const pickingBackBtn = document.getElementById('picking-back-btn');
  if (pickingBackBtn) {
    pickingBackBtn.addEventListener('click', () => {
      const pickingPage = document.getElementById('picking-page');
      if (pickingPage) pickingPage.classList.remove('active');
      currentOrder = null;
    });
  }

  // Bind Picking List action button
  const pickingActionBtn = document.getElementById('picking-action-btn');
  if (pickingActionBtn) {
    pickingActionBtn.addEventListener('click', () => {
      if (!currentOrder) return;
      
      const label = pickingActionBtn.textContent;
      if (label === 'Start Pick') {
        const cachedName = getCachedAuth();
        if (cachedName) {
          proceedToPicking(cachedName);
        } else {
          authPendingAction = {
            type: 'start_pick',
            orderId: currentOrder.ID
          };
          openAuthPage();
        }
      } else if (label === 'Cancel') {
        const order = allOrders.find(o => o.ID === currentOrder.ID);
        let logs = [];
        try {
          logs = JSON.parse((order && order.Logs) || '[]');
          if (!Array.isArray(logs)) logs = [];
        } catch (e) {
          logs = [];
        }
        logs.push({
          action: "Picking Cancelled",
          actionBy: getCachedAuth() || "Picker App",
          remark: "Reverted back to Ready to Pick",
          timestamp: Date.now()
        });
        // Clear checklists
        const items = typeof currentOrder.Items === 'string' ? JSON.parse(currentOrder.Items || '[]') : (currentOrder.Items || []);
        items.forEach(item => {
          checkedItems[item.sku] = false;
        });
        localStorage.removeItem(`picker_checked_${currentOrder.ID}`);
        silentSyncOrderUpdate(currentOrder.ID, { 
          Status: "Ready to Pick",
          Picker: "",
          Logs: JSON.stringify(logs)
        });
      } else if (label === 'Submit') {
        const cachedName = getCachedAuth();
        if (cachedName) {
          proceedToSubmitProof(cachedName);
        } else {
          authPendingAction = {
            type: 'submit_proof',
            orderId: currentOrder.ID
          };
          openAuthPage();
        }
      }
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

  // Bind Camera upload triggers
  bindCameraUpload();

  // Bind PIN inputs digit behavior
  bindAuthPinInputs();

  // Update drawer logout button state on boot
  updateDrawerLogoutButton();

  // Bind Revert Confirmation modal
  const revertCancelBtn = document.getElementById('revert-modal-cancel-btn');
  if (revertCancelBtn) {
    revertCancelBtn.addEventListener('click', closeRevertModal);
  }
  const revertConfirmBtn = document.getElementById('revert-modal-yes-btn');
  if (revertConfirmBtn) {
    revertConfirmBtn.addEventListener('click', executeRevertOrder);
  }

  // Bind Handover page elements
  const handoverBackBtn = document.getElementById('handover-back-btn');
  if (handoverBackBtn) {
    handoverBackBtn.addEventListener('click', closeHandoverPage);
  }
  const handoverSubmitBtn = document.getElementById('handover-page-submit-btn');
  if (handoverSubmitBtn) {
    handoverSubmitBtn.addEventListener('click', () => {
      // Trigger PIN verification
      const cachedName = getCachedAuth();
      if (cachedName) {
        proceedToSubmitHandover(cachedName);
      } else {
        authPendingAction = {
          type: 'submit_handover',
          orderId: currentOrder.ID
        };
        openAuthPage();
      }
    });
  }
  bindHandoverCamera();

  const logsBackBtn = document.getElementById('logs-back-btn');
  if (logsBackBtn) {
    logsBackBtn.addEventListener('click', closeLogsPage);
  }

  const doPaperBtn = document.getElementById('picking-do-paper-btn');
  if (doPaperBtn) {
    doPaperBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const imgUrl = doPaperBtn.getAttribute('data-img-url');
      if (imgUrl) {
        showLightbox(imgUrl);
      }
    });
  }

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

  // Display version number
  const versionSpan = document.getElementById('app-version');
  if (versionSpan) {
    versionSpan.textContent = `Trial Version : ${APP_VERSION}`;
  }

  // Load from cache first, then fetch live data
  loadCachedData();
  fetchSupportData();
  fetchData();

  // Enforce mandatory login on app open
  const currentPickerName = getCachedAuth();
  if (!currentPickerName) {
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
function switchPage(pageName) {
  // Normalize Ready to Deliver/Goods Ready if triggered from legacy/different contexts
  if (pageName === 'Ready to Deliver') {
    pageName = 'Goods Ready';
  }
  
  activeTab = pageName;
  activeSubTab = 'All'; // Reset subtab to default 'All' on page switch

  // Update active Drawer menu item states
  const drawerItems = document.querySelectorAll('.drawer-item');
  drawerItems.forEach(item => {
    const menuVal = item.getAttribute('data-menu');
    if (menuVal === pageName || (pageName === 'Goods Ready' && menuVal === 'Ready to Deliver')) {
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

  // Collapse and reset search on page switch
  collapseSearch(false);

  // Render the sub-tabs dynamically
  renderTabs();

  renderOrdersList();
}

// Render context-dependent subheader tabs dynamically
function renderTabs() {
  const tabBar = document.getElementById('tab-bar');
  const subheader = document.querySelector('.subheader');
  if (!tabBar) return;

  tabBar.innerHTML = '';
  
  if (activeTab === 'Complete') {
    if (subheader) subheader.style.display = 'none'; // Hide subheader for complete
    return;
  }
  
  if (subheader) subheader.style.display = 'flex'; // Show subheader for others

  let tabs = [];
  if (activeTab === 'Pending') {
    tabs = ['All', 'North', 'North-East', 'East', 'West', 'Central', 'South'];
  } else if (activeTab === 'Goods Ready') {
    tabs = ['All', 'Ready to Deliver', 'Load', 'Out for Delivery'];
  }

  tabs.forEach(tab => {
    const btn = document.createElement('button');
    btn.className = `tab-btn ${activeSubTab === tab ? 'active' : ''}`;
    btn.textContent = tab;
    btn.setAttribute('data-subtab', tab);
    btn.addEventListener('click', () => {
      activeSubTab = tab;
      // Update active button styles
      tabBar.querySelectorAll('.tab-btn').forEach(b => {
        if (b.getAttribute('data-subtab') === tab) {
          b.classList.add('active');
        } else {
          b.classList.remove('active');
        }
      });
      renderOrdersList();
    });
    tabBar.appendChild(btn);
  });
}

// Fetch shared Track_Orders sheet from Worker API
async function fetchData() {
  if (isFetchingData) return;
  isFetchingData = true;

  const refreshIcon = document.getElementById('refresh-icon');
  if (refreshIcon) refreshIcon.classList.add('spinning');

  try {
    const response = await fetch(`${WORKER_URL}/api/app/picker/Track_Orders?t=${Date.now()}`);
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
    localStorage.setItem('picker_orders', JSON.stringify(ordersList));
  } catch (err) {
    console.error("Failed to load orders from Worker API:", err);
    showToast("Server offline", "error");
    // If failed, check localStorage for cached data
    const cached = localStorage.getItem('picker_orders');
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
    lastRefreshTime = Date.now();
    renderOrdersList();
  }
}

// Load cached data on initialization
function loadCachedData() {
  const cached = localStorage.getItem('picker_orders');
  if (cached) {
    try {
      allOrders = JSON.parse(cached);
    } catch (e) {
      allOrders = [];
    }
  } else {
    allOrders = [];
  }
  renderOrdersList();
}

// Render the order cards list based on tab filters and search query
function renderOrdersList() {
  const listContainer = document.getElementById('orders-list');
  const qtyDisplay = document.getElementById('qty-count-display');
  if (!listContainer) return;

  listContainer.innerHTML = '';

  // Page 3: Complete page must be completely blank
  if (activeTab === 'Complete') {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const completedOrders = allOrders.filter(o => 
      o.Status === 'Delivered' && Number(o.Timestamp || 0) >= thirtyDaysAgo
    );
    
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
          <div class="empty-subtext">Completed orders in the last 30 days will appear here.</div>
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
        const doNum = order.DO_Number || order.do_number || 'UNKNOWN';
        const deliverToVal = order.Deliver_To || order.deliver_to || order.DeliverTo || '';
        const truncatedDeliver = deliverToVal.length > 12 ? deliverToVal.substring(0, 12) + '...' : deliverToVal;
        
        const method = (order.Deliver_Method || order.deliver_method || "").trim().toLowerCase();
        const isHandover = method !== "company delivery" && method !== "company vehicle";
        
        let shareBtnHtml = '';
        if (isHandover) {
          shareBtnHtml = `
            <button class="complete-order-share-btn" data-id="${order.ID}" style="background: none; border: none; padding: 6px; cursor: pointer; color: #25D366; display: inline-flex; align-items: center; justify-content: center; outline: none; -webkit-tap-highlight-color: transparent; margin-right: 4px;" title="Share to WhatsApp">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" style="width: 15px; height: 15px;">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
              </svg>
            </button>
          `;
        }
        
        html += `
          <tr style="border-bottom: 1px solid #E2E8F0;">
            <td style="padding: 12px 4px; color: #1E293B; font-weight: 600; font-family: monospace;">
              ${doNum} - <span style="font-family: inherit; font-weight: 500; color: #64748B;">${truncatedDeliver}</span>
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

    // Bind share buttons
    listContainer.querySelectorAll('.complete-order-share-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const oId = btn.getAttribute('data-id');
        sharePickerOrderToWhatsApp(oId);
      });
    });
    return;
  }

  let filtered = allOrders.filter(order => {
    // 1. Check main page tab status mapping
    if (activeTab === 'Pending') {
      const isReady = order.Status === 'Ready to Pick';
      const isPicking = order.Status === 'Picking';
      if (!isReady && !isPicking) return false;
      
      // Sub-tab filters by Zone (All, North, North-East, East, West, Central, South)
      if (activeSubTab !== 'All') {
        const orderZone = getZoneFromPostcode(order.Poscode || order.poscode);
        if (orderZone !== activeSubTab) {
          return false;
        }
      }
    } else if (activeTab === 'Goods Ready') {
      const allowedStatuses = ['Ready to Deliver', 'Load', 'Out for Delivery'];
      if (!allowedStatuses.includes(order.Status)) return false;
      
      // Sub-tab filters by Status (All, Ready to Deliver, Load, Out for Delivery)
      if (activeSubTab !== 'All' && order.Status !== activeSubTab) {
        return false;
      }
    }

    // 2. Search query matches ID or Deliver_To
    if (searchQuery.trim() !== '') {
      const query = searchQuery.toLowerCase().trim();
      const idMatch = (order.ID || '').toLowerCase().includes(query);
      const deliverMatch = (order.Deliver_To || '').toLowerCase().includes(query);
      return idMatch || deliverMatch;
    }
    return true;
  });

  // Sort by Status (Picking first, then Ready to Pick), then by priority (Urgent > Appointment > Normal) and then oldest first
  filtered.sort((a, b) => {
    const statusOrder = { 'Picking': 1, 'Ready to Pick': 2 };
    const statusA = a.Status || 'Ready to Pick';
    const statusB = b.Status || 'Ready to Pick';
    const rankA = statusOrder[statusA] || 99;
    const rankB = statusOrder[statusB] || 99;
    if (rankA !== rankB) return rankA - rankB;

    const getPriorityScore = (type) => {
      const t = (type || 'Normal').trim();
      if (t === 'Urgent') return 1;
      if (t === 'Appointment') return 2;
      return 3;
    };
    
    const scoreA = getPriorityScore(a.Type);
    const scoreB = getPriorityScore(b.Type);
    
    if (scoreA !== scoreB) {
      return scoreA - scoreB;
    }
    
    const timeA = Number(a.Timestamp || a.timestamp || 0);
    const timeB = Number(b.Timestamp || b.timestamp || 0);
    return timeA - timeB;
  });

  // Update total counts display
  if (qtyDisplay) {
    qtyDisplay.textContent = `Total Orders: ${filtered.length}`;
  }

  // If no matching orders found, render empty state
  if (filtered.length === 0) {
    const textDesc = activeTab === 'Pending' ? 'Ready to Pick' : 'Ready to Deliver / Load / Out for Delivery';
    listContainer.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <div class="empty-text">No Orders Found</div>
        <div class="empty-subtext">There are no orders found under "${textDesc}" matching active filters.</div>
      </div>
    `;
    return;
  }

  // Render cards
  filtered.forEach(order => {
    const card = document.createElement('div');
    card.className = 'order-card';
    card.style.padding = '0';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.alignItems = 'stretch';
    
    const me = getCachedAuth();
    if (order.Status === 'Picking' && me && (order.Picker || '').trim() !== me) {
      card.style.opacity = '0.7';
    }

    // 1:1 Mark avatar - Displays the "Mark" column value from sheet (e.g. X, Y)
    const markVal = order.Mark || '-';
    
    // Relative time elapsed (top-right corner)
    const relativeTime = getRelativeTime(order.Timestamp || order.timestamp);
    const timeHtml = `<span class="time-elapsed">${relativeTime}</span>`;
    
    // Bottom status badges (Zone and Type) matching Merchandiser App
    const zoneName = getZoneFromPostcode(order.Poscode || order.poscode);
    
    const typeRaw = (order.Type || 'Normal').trim();
    const typeUpper = typeRaw.toUpperCase();

    // Parse Items and count total quantity of SKUs for "Small Order" badge
    let totalQty = 0;
    try {
      const items = typeof order.Items === 'string' ? JSON.parse(order.Items || '[]') : (order.Items || []);
      if (Array.isArray(items)) {
        items.forEach(item => {
          totalQty += Number(item.qty || 0);
        });
      }
    } catch (e) {
      console.error("Failed to parse order items:", e);
    }
    
    let smallOrderBadgeHtml = '';
    if (totalQty > 0 && totalQty < 20) {
      smallOrderBadgeHtml = `<span class="order-badge small-order-badge">Small Order</span>`;
    }

    // Truncate Subtext to max 12 or 10 characters followed by 3 dots (...) if exceeded
    const deliverToVal = order.Deliver_To || order.deliver_to || order.DeliverTo || '';
    const limit = activeTab === 'Goods Ready' ? 10 : 12;
    const truncatedDeliver = truncateDeliverTo(deliverToVal || 'No delivery destination specified', limit);

    let typeBarHtml = '';
    if (order.Status === 'Picking') {
      const currentPicker = getCachedAuth();
      if (currentPicker && (order.Picker || '').trim() === currentPicker) {
        typeBarHtml = `
          <div class="order-card-type-bar type-bar-picking-me">
            Picking by You (In Progress)
          </div>
        `;
      } else {
        typeBarHtml = `
          <div class="order-card-type-bar type-bar-picking-other">
            Picking by ${order.Picker || 'another picker'}
          </div>
        `;
      }
    } else if (typeUpper.startsWith('URGENT')) {
      typeBarHtml = `
        <div class="order-card-type-bar type-bar-urgent">
          Delivery by Today
        </div>
      `;
    } else if (typeUpper.startsWith('APPO')) {
      let formattedDate = '';
      const match = typeRaw.match(/\(([^)]+)\)/);
      if (match) {
        formattedDate = match[1];
      } else {
        formattedDate = formatTimestamp(order.Deadline || order.deadline || order.Timestamp || order.timestamp);
      }
      typeBarHtml = `
        <div class="order-card-type-bar type-bar-appointment">
          Delivery by ${formattedDate}
        </div>
      `;
    }

    if (activeTab === 'Goods Ready') {
      const methodVal = order.Deliver_Method || order.deliver_method || order.DeliverMethod || 'Company Delivery';
      const isCompanyDelivery = methodVal === 'Company Delivery';
      
      const isDriverHandled = order.Status === 'Load' || order.Status === 'Out for Delivery';
      const driverName = order.Driver || order.driver || 'Driver';

      if (isDriverHandled) {
        card.innerHTML = `
          <div class="goods-ready-card-body" style="display: flex; align-items: stretch; padding: 0; flex: 1; width: 100%;">
            <div class="mark-avatar" title="1:1 Mark Ratio">${markVal}</div>
            <div class="order-card-content" style="flex: 1; min-width: 0; padding: 12px 16px 12px 12px;">
              <div class="order-card-header">
                <span class="order-id" title="${order.ID || ''}">${order.ID || 'N/A'}</span>
                ${timeHtml}
              </div>
              <div class="order-deliver-to">${truncatedDeliver}</div>
              <div class="order-card-footer" style="margin-top: 6px;">
                <span class="order-badge zone-badge">${zoneName}</span>
                ${smallOrderBadgeHtml}
              </div>
            </div>
          </div>
          ${typeBarHtml}
          <div class="goods-ready-card-actions" style="display: flex; align-items: center; justify-content: center; height: 44px; background-color: #F1F5F9; color: #475569; font-size: 11px; font-weight: 700; gap: 6px; width: 100%; border-top: 1.5px solid var(--border-color);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px; color: #475569;">
              <rect x="1" y="3" width="15" height="13"></rect>
              <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon>
              <circle cx="5.5" cy="18.5" r="2.5"></circle>
              <circle cx="18.5" cy="18.5" r="2.5"></circle>
            </svg>
            <span>Goods with ${driverName}</span>
          </div>
        `;
      } else {
        card.innerHTML = `
          <div class="goods-ready-card-body" style="display: flex; align-items: stretch; padding: 0; flex: 1; width: 100%;">
            <div class="mark-avatar" title="1:1 Mark Ratio">${markVal}</div>
            <div class="order-card-content" style="flex: 1; min-width: 0; padding: 12px 16px 12px 12px;">
              <div class="order-card-header">
                <span class="order-id" title="${order.ID || ''}">${order.ID || 'N/A'}</span>
                ${timeHtml}
              </div>
              <div class="order-deliver-to">${truncatedDeliver}</div>
              <div class="order-card-footer" style="margin-top: 6px;">
                <span class="order-badge zone-badge">${zoneName}</span>
                ${smallOrderBadgeHtml}
              </div>
            </div>
          </div>
          ${typeBarHtml}
          <div class="goods-ready-card-actions" style="display: flex; align-items: stretch; height: 44px; background-color: #F8FAFC; border-top: 1.5px solid var(--border-color);">
            <button class="card-footer-action-btn delete-btn" style="flex: 1; border: none; background: none; color: #EF4444; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 4px; border-right: 1.5px solid var(--border-color); cursor: pointer;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 13px; height: 13px;">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
              <span>Re-Pick</span>
            </button>
            
            <button class="card-footer-action-btn handover-btn" ${isCompanyDelivery ? 'disabled' : ''} style="flex: 1; border: none; background: none; color: ${isCompanyDelivery ? '#94A3B8' : 'var(--app-color)'}; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 4px; border-right: 1.5px solid var(--border-color); cursor: ${isCompanyDelivery ? 'not-allowed' : 'pointer'}; opacity: ${isCompanyDelivery ? '0.5' : '1'};">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 13px; height: 13px;">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                <line x1="12" y1="22.08" x2="12" y2="12"></line>
              </svg>
              <span>Handover</span>
            </button>
            
            <button class="card-footer-action-btn whatsapp-btn" style="flex: 1; border: none; background: none; color: #10B981; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 4px; cursor: pointer;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 13px; height: 13px;">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
              </svg>
              <span>Share</span>
            </button>
          </div>
        `;
      }
    } else {
      card.innerHTML = `
        <div class="order-card-body" style="display: flex; align-items: stretch; padding: 0; flex: 1; width: 100%;">
          <div class="mark-avatar" title="1:1 Mark Ratio">${markVal}</div>
          <div class="order-card-content" style="flex: 1; min-width: 0; padding: 14px 16px 14px 14px;">
            <div class="order-card-header">
              <span class="order-id" title="${order.ID || ''}">${order.ID || 'N/A'}</span>
              ${timeHtml}
            </div>
            <div class="order-deliver-to">${truncatedDeliver}</div>
            <div class="order-card-footer">
              <span class="order-badge zone-badge">${zoneName}</span>
              ${smallOrderBadgeHtml}
            </div>
          </div>
        </div>
        ${typeBarHtml}
      `;
    }

    if (activeTab === 'Goods Ready') {
      const waBtn = card.querySelector('.whatsapp-btn');
      if (waBtn) {
        waBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          sharePickerOrderToWhatsApp(order.ID);
        });
      }
      const hoBtn = card.querySelector('.handover-btn');
      if (hoBtn) {
        hoBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openHandoverPage(order);
        });
      }
      const trashBtn = card.querySelector('.delete-btn');
      if (trashBtn) {
        trashBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          confirmRevertOrder(order);
        });
      }
    }

    if (activeTab === 'Pending') {
      card.addEventListener('click', () => {
        const loggedIn = getCachedAuth();
        if (order.Status === 'Picking' && loggedIn && (order.Picker || '').trim() !== loggedIn) {
          showToast(`This order is currently being picked by ${order.Picker}`, "warning");
          return;
        }
        openPickingPage(order);
      });
    }

    listContainer.appendChild(card);
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

// Fetch support metadata sheets: products_DB, brands_DB, Picker_Users
async function fetchSupportData() {
  const cachedProducts = localStorage.getItem('picker_products');
  const cachedBrands = localStorage.getItem('picker_brands');
  const cachedUsers = localStorage.getItem('picker_users');
  
  if (cachedProducts) allProducts = JSON.parse(cachedProducts);
  if (cachedBrands) allBrands = JSON.parse(cachedBrands);
  if (cachedUsers) allUsers = JSON.parse(cachedUsers);

  try {
    const [prodRes, brandRes, userRes] = await Promise.all([
      fetch(`${WORKER_URL}/api/app/picker/products?t=${Date.now()}`),
      fetch(`${WORKER_URL}/api/app/picker/brands?t=${Date.now()}`),
      fetch(`${WORKER_URL}/api/app/picker/users?t=${Date.now()}`)
    ]);
    
    if (prodRes.ok) {
      const prodData = await prodRes.json();
      allProducts = prodData.value || prodData;
      localStorage.setItem('picker_products', JSON.stringify(allProducts));
    }
    if (brandRes.ok) {
      const brandData = await brandRes.json();
      allBrands = brandData.value || brandData;
      localStorage.setItem('picker_brands', JSON.stringify(allBrands));
    }
    if (userRes.ok) {
      const userData = await userRes.json();
      allUsers = userData.value || userData;
      localStorage.setItem('picker_users', JSON.stringify(allUsers));
    }
  } catch (err) {
    console.error("Failed to fetch support metadata:", err);
  }
}

// Instantly update LocalStorage and silently sync updates to GAS proxy endpoint
async function silentSyncOrderUpdate(orderId, fields) {
  // 1. Instantly update local state
  const order = allOrders.find(o => o.ID === orderId);
  if (order) {
    Object.assign(order, fields);
    localStorage.setItem('picker_orders', JSON.stringify(allOrders));
    renderOrdersList();
    if (currentOrder && currentOrder.ID === orderId) {
      Object.assign(currentOrder, fields);
      renderPickingPage();
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
    
    fetch(`${WORKER_URL}/api/app/picker/write`, {
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

// Detail page opening and initialization
function openPickingPage(order) {
  currentOrder = order;
  const cachedChecked = localStorage.getItem(`picker_checked_${order.ID}`);
  if (cachedChecked) {
    try {
      checkedItems = JSON.parse(cachedChecked);
    } catch (_) {
      checkedItems = {};
    }
  } else {
    checkedItems = {};
  }
  
  const pickingPage = document.getElementById('picking-page');
  if (!pickingPage) return;

  const markBox = document.getElementById('picking-order-mark');
  const idValue = document.getElementById('picking-order-id');
  const deliverValue = document.getElementById('picking-order-deliver');
  const zoneValue = document.getElementById('picking-order-zone');

  if (markBox) markBox.textContent = order.Mark || '-';
  if (idValue) idValue.textContent = order.ID || 'N/A';
  if (deliverValue) deliverValue.textContent = order.Deliver_To || order.deliver_to || order.DeliverTo || '';
  if (zoneValue) zoneValue.textContent = getZoneFromPostcode(order.Poscode || order.poscode);

  const doPaperBtn = document.getElementById('picking-do-paper-btn');
  if (doPaperBtn) {
    const paperUrlRaw = order.Photo_DO_Paper || order.photo_do_paper || order.PhotoDoPaper || '';
    const parsedUrls = parseDOImages(paperUrlRaw);
    if (parsedUrls.length > 0) {
      doPaperBtn.style.display = 'flex';
      doPaperBtn.setAttribute('data-img-url', parsedUrls[0]);
    } else {
      doPaperBtn.style.display = 'none';
      doPaperBtn.removeAttribute('data-img-url');
    }
  }

  renderPickingPage();
  pickingPage.classList.add('active');
}

function renderPickingPage() {
  if (!currentOrder) return;

  const backBtn = document.getElementById('picking-back-btn');
  const actionBtn = document.getElementById('picking-action-btn');

  if (currentOrder.Status === 'Picking') {
    const isMe = isOrderPickedByMe(currentOrder);
    if (isMe) {
      if (backBtn) backBtn.style.display = 'none';
      updatePickingButtonState(currentOrder);
    } else {
      if (backBtn) backBtn.style.display = 'flex';
      if (actionBtn) {
        let pickedBy = 'another picker';
        try {
          const logs = JSON.parse(currentOrder.Logs || '[]');
          const lastStartLog = logs.slice().reverse().find(l => l.action === "Start Picking");
          if (lastStartLog && lastStartLog.actionBy) pickedBy = lastStartLog.actionBy;
        } catch (_) {}
        actionBtn.className = 'picking-action-btn disabled-mode';
        actionBtn.textContent = `Picking by ${pickedBy}...`;
        actionBtn.disabled = true;
      }
    }
  } else {
    if (backBtn) backBtn.style.display = 'flex';
    if (actionBtn) {
      actionBtn.className = 'picking-action-btn';
      actionBtn.textContent = 'Start Pick';
      actionBtn.disabled = false;
    }
  }

  renderPickingItems(currentOrder);
}

// Group and sort order items by brand
function renderPickingItems(order) {
  const container = document.getElementById('picking-items-container');
  if (!container) return;
  container.innerHTML = '';

  const items = typeof order.Items === 'string' ? JSON.parse(order.Items || '[]') : (order.Items || []);
  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-text">No Items to Pick</div></div>`;
    return;
  }

  // Map to products and brands, preserving original index
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
    return {
      sku: item.sku,
      qty: item.qty,
      name: prodName,
      image: imgUrl,
      brand: brandName,
      originalIndex: index
    };
  });

  // Group by brand name
  const groups = {};
  mapped.forEach(item => {
    if (!groups[item.brand]) {
      groups[item.brand] = [];
    }
    groups[item.brand].push(item);
  });

  // Sort brands alphabetically
  const sortedBrands = Object.keys(groups).sort();

  sortedBrands.forEach(brand => {
    groups[brand].sort((a, b) => a.sku.localeCompare(b.sku));

    const section = document.createElement('div');
    section.className = 'picking-brand-section';

    const title = document.createElement('div');
    title.className = 'picking-brand-title';
    title.textContent = brand;
    section.appendChild(title);

    groups[brand].forEach(item => {
      const card = document.createElement('div');
      card.className = 'picking-item-card';

      const imgContainer = document.createElement('div');
      imgContainer.className = 'picking-item-img-container';
      imgContainer.style.position = 'relative';
      imgContainer.style.cursor = 'pointer';
      imgContainer.style.overflow = 'hidden';

      const img = document.createElement('img');
      img.className = 'picking-item-img';
      img.src = item.image || placeholderImg;
      img.onerror = function() {
        this.onerror = null;
        this.src = placeholderImg;
      };
      imgContainer.appendChild(img);

      // 50% transparent overlay with A1 A2 markings
      const mark = order.Mark || "A";
      const seqText = `${mark}${item.originalIndex + 1}`;

      const overlay = document.createElement('div');
      overlay.style.position = 'absolute';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.right = '0';
      overlay.style.bottom = '0';
      overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.color = '#FFFFFF';
      overlay.style.fontSize = '18px';
      overlay.style.fontWeight = '850';
      overlay.style.fontFamily = "'Outfit', sans-serif";
      overlay.style.pointerEvents = 'none';
      overlay.style.userSelect = 'none';
      overlay.textContent = seqText;
      imgContainer.appendChild(overlay);

      imgContainer.addEventListener('click', (e) => {
        e.stopPropagation();
        showLightbox(item.image || placeholderImg);
      });

      card.appendChild(imgContainer);

      const content = document.createElement('div');
      content.className = 'picking-item-content';

      const sku = document.createElement('div');
      sku.className = 'picking-item-sku';
      sku.textContent = item.sku;
      content.appendChild(sku);

      const name = document.createElement('div');
      name.className = 'picking-item-name';
      name.textContent = item.name;
      content.appendChild(name);

      card.appendChild(content);

      const qtyContainer = document.createElement('div');
      qtyContainer.className = 'picking-item-qty-container';
      qtyContainer.style.display = 'flex';
      qtyContainer.style.flexDirection = 'column';
      qtyContainer.style.alignItems = 'center';
      qtyContainer.style.justifyContent = 'center';
      qtyContainer.style.padding = '0 12px 0 12px';
      qtyContainer.style.borderLeft = '1.5px solid var(--border-color)';
      qtyContainer.style.flexShrink = '0';
      qtyContainer.style.minWidth = '48px';
      qtyContainer.style.boxSizing = 'border-box';

      const qtyNum = document.createElement('span');
      qtyNum.className = 'picking-item-qty-num';
      qtyNum.style.fontSize = '20px';
      qtyNum.style.fontWeight = '800';
      qtyNum.style.color = 'var(--text-primary)';
      qtyNum.style.lineHeight = '1';
      qtyNum.textContent = item.qty;
      qtyContainer.appendChild(qtyNum);

      const qtyLabel = document.createElement('span');
      qtyLabel.className = 'picking-item-qty-label';
      qtyLabel.style.fontSize = '9px';
      qtyLabel.style.fontWeight = '800';
      qtyLabel.style.color = 'var(--text-muted)';
      qtyLabel.style.marginTop = '2px';
      qtyLabel.style.lineHeight = '1';
      qtyLabel.textContent = 'QTY';
      qtyContainer.appendChild(qtyLabel);

      card.appendChild(qtyContainer);

      if (order.Status === 'Picking') {
        const checkContainer = document.createElement('div');
        checkContainer.className = 'picking-item-check-container';

        const checkbox = document.createElement('div');
        checkbox.className = `picking-item-checkbox ${checkedItems[item.sku] ? 'checked' : ''}`;
        checkbox.innerHTML = checkedItems[item.sku] ? `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        ` : '';

        const isMe = isOrderPickedByMe(order);
        if (isMe) {
          checkbox.addEventListener('click', () => {
            checkedItems[item.sku] = !checkedItems[item.sku];
            localStorage.setItem(`picker_checked_${order.ID}`, JSON.stringify(checkedItems));
            checkbox.className = `picking-item-checkbox ${checkedItems[item.sku] ? 'checked' : ''}`;
            checkbox.innerHTML = checkedItems[item.sku] ? `
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            ` : '';

            updatePickingButtonState(order);
          });
        } else {
          checkbox.style.opacity = '0.4';
          checkbox.style.cursor = 'not-allowed';
        }

        checkContainer.appendChild(checkbox);
        card.appendChild(checkContainer);
      }

      section.appendChild(card);
    });

    container.appendChild(section);
  });

  const photoSection = document.getElementById('picking-photo-section');
  if (photoSection) {
    if (order.Status === 'Picking') {
      photoSection.classList.remove('hidden');
    } else {
      photoSection.classList.add('hidden');
      capturedPhotoFile = null;
      const previewImg = document.getElementById('camera-preview-img');
      const placeholder = document.getElementById('camera-placeholder');
      const cameraInput = document.getElementById('proof-camera-input');
      if (previewImg) {
        previewImg.classList.add('hidden');
        previewImg.src = '';
      }
      if (placeholder) {
        placeholder.style.display = 'flex';
      }
      if (cameraInput) {
        cameraInput.value = '';
      }
    }
  }

  updatePickingButtonState(order);
}

function updatePickingButtonState(order) {
  const actionBtn = document.getElementById('picking-action-btn');
  if (!actionBtn) return;
  actionBtn.disabled = false;

  if (order.Status !== 'Picking') {
    actionBtn.className = 'picking-action-btn';
    actionBtn.textContent = 'Start Pick';
    return;
  }

  const items = typeof order.Items === 'string' ? JSON.parse(order.Items || '[]') : (order.Items || []);
  const allChecked = items.every(item => checkedItems[item.sku] === true);
  const photoSection = document.getElementById('picking-photo-section');

  if (allChecked) {
    if (photoSection) {
      photoSection.classList.remove('disabled');
    }
    if (capturedPhotoFile) {
      actionBtn.className = 'picking-action-btn ready-mode';
      actionBtn.textContent = 'Submit';
    } else {
      actionBtn.className = 'picking-action-btn cancel-mode';
      actionBtn.textContent = 'Cancel';
    }
  } else {
    if (capturedPhotoFile) {
      capturedPhotoFile = null;
      const previewImg = document.getElementById('camera-preview-img');
      const placeholder = document.getElementById('camera-placeholder');
      const cameraInput = document.getElementById('proof-camera-input');
      if (previewImg) {
        previewImg.classList.add('hidden');
        previewImg.src = '';
      }
      if (placeholder) {
        placeholder.style.display = 'flex';
      }
      if (cameraInput) {
        cameraInput.value = '';
      }
    }
    if (photoSection) {
      photoSection.classList.add('disabled');
    }
    actionBtn.className = 'picking-action-btn cancel-mode';
    actionBtn.textContent = 'Cancel';
  }
}

// Auth Page View Controllers
function openAuthPage(isMandatory = false) {
  const authPage = document.getElementById('auth-page');
  if (!authPage) return;

  clearAuthPin();
  authPage.classList.add('active');

  const backBtn = document.getElementById('auth-back-btn');
  if (backBtn) {
    if (isMandatory) {
      backBtn.style.display = 'none';
    } else {
      backBtn.style.display = 'flex';
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
    pinInput.classList.remove('error');
  }

  const hiddenInput = document.getElementById('auth-pin-hidden');
  if (hiddenInput) {
    hiddenInput.value = '';
    hiddenInput.classList.remove('error');
  }

  const displays = document.querySelectorAll('#auth-page .pin-digit-display');
  displays.forEach(display => {
    display.textContent = '';
    display.classList.remove('active');
    display.classList.remove('error');
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
        display.textContent = '*'; // Masked character
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
    displays.forEach(display => {
      display.classList.remove('active');
    });
  });
}

// Capture camera trigger (Inline)
function bindCameraUpload() {
  const uploadBox = document.getElementById('camera-upload-box');
  const cameraInput = document.getElementById('proof-camera-input');
  const previewImg = document.getElementById('camera-preview-img');
  const placeholder = document.getElementById('camera-placeholder');

  if (uploadBox && cameraInput) {
    uploadBox.addEventListener('click', () => {
      cameraInput.click();
    });

    cameraInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        capturedPhotoFile = file;
        
        const reader = new FileReader();
        reader.onload = (event) => {
          if (previewImg) {
            previewImg.src = event.target.result;
            previewImg.classList.remove('hidden');
          }
          if (placeholder) {
            placeholder.style.display = 'none';
          }
          updatePickingButtonState(currentOrder);
        };
        reader.readAsDataURL(file);
      }
    });
  }
}

// Compress client-side image using HTML Canvas
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

// Downsize iterations to guarantee image file is strictly under 250KB limit
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

// Cache Authentication functions
function getCachedAuth() {
  const name = localStorage.getItem('auth_picker_name');
  const expireStr = localStorage.getItem('auth_picker_expire');
  if (!name || !expireStr) return null;

  const expire = parseInt(expireStr);
  if (Date.now() > expire) {
    clearCachedAuth();
    return null;
  }
  return name;
}

function setCachedAuth(name) {
  const expire = Date.now() + 30 * 60 * 1000; // 30 minutes
  localStorage.setItem('auth_picker_name', name);
  localStorage.setItem('auth_picker_expire', expire.toString());
  updateDrawerLogoutButton();
}

function clearCachedAuth() {
  localStorage.removeItem('auth_picker_name');
  localStorage.removeItem('auth_picker_expire');
  updateDrawerLogoutButton();
  openAuthPage(true); // Force login again
}

function updateDrawerLogoutButton() {
  const name = getCachedAuth();
  const logoutBtn = document.getElementById('logout-btn');
  const nameSpan = document.getElementById('logout-picker-name');

  if (name) {
    if (nameSpan) nameSpan.textContent = name;
    if (logoutBtn) logoutBtn.classList.remove('hidden');
  } else {
    if (logoutBtn) logoutBtn.classList.add('hidden');
  }
}

function proceedToPicking(pickerName) {
  if (!currentOrder) return;
  const order = allOrders.find(o => o.ID === currentOrder.ID);
  let logs = [];
  try {
    logs = JSON.parse((order && order.Logs) || '[]');
    if (!Array.isArray(logs)) logs = [];
  } catch (e) {
    logs = [];
  }
  logs.push({
    action: "Start Picking",
    actionBy: pickerName,
    remark: "Started picking items",
    timestamp: Date.now()
  });
  silentSyncOrderUpdate(currentOrder.ID, { 
    Status: "Picking",
    Picker: pickerName,
    Logs: JSON.stringify(logs)
  });
}

async function proceedToSubmitProof(pickerName) {
  if (!capturedPhotoFile) {
    showToast("Please capture a photo first", "error");
    return;
  }

  showToast("Submitting proof and updating status...", "info");
  
  try {
    let uploadFile = capturedPhotoFile;
    try {
      uploadFile = await compressImageToMax250kb(capturedPhotoFile);
    } catch (compressErr) {
      console.warn("Image compression failed, using original file:", compressErr);
    }
    
    const doNumber = currentOrder.DO_Number || currentOrder.do_number || 'UNKNOWN';
    const fileName = `Track_Orders/Picker_Proof/${doNumber}_${Date.now()}.jpg`;
    const uploadUrl = `${WORKER_URL}/api/upload?filename=${encodeURIComponent(fileName)}`;
    
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: uploadFile
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

    const order = allOrders.find(o => o.ID === currentOrder.ID);
    let logs = [];
    try {
      logs = JSON.parse((order && order.Logs) || '[]');
      if (!Array.isArray(logs)) logs = [];
    } catch (e) {
      logs = [];
    }
    logs.push({
      action: "Picked & Proof Submitted",
      actionBy: pickerName,
      remark: "Goods Ready",
      timestamp: Date.now(),
      photoUrl: photoUrl
    });

    const submittedOrderId = currentOrder.ID;

    await silentSyncOrderUpdate(submittedOrderId, {
      Status: "Ready to Deliver",
      Photo_Picker_Proof: photoUrl,
      Logs: JSON.stringify(logs)
    });

    showToast("Order submitted successfully!", "success");
    
    closeAuthPage();
    const pickingPage = document.getElementById('picking-page');
    if (pickingPage) pickingPage.classList.remove('active');
    
    localStorage.removeItem(`picker_checked_${submittedOrderId}`);
    currentOrder = null;
    
    // Auto-trigger WhatsApp share drawer
    sharePickerOrderToWhatsApp(submittedOrderId);
  } catch (error) {
    console.error("Proof submission failed:", error);
    showToast("Submission failed: " + error.message, "error");
  }
}

// Authenticate PIN, compress/upload proof photo, and advance order state to "Ready to Deliver"
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

  const pickerName = matchedUser.Name || matchedUser.name || 'Picker';
  
  // Cache for 30 minutes
  setCachedAuth(pickerName);

  if (authPendingAction) {
    if (authPendingAction.type === 'start_pick') {
      proceedToPicking(pickerName);
      closeAuthPage();
    } else if (authPendingAction.type === 'submit_proof') {
      await proceedToSubmitProof(pickerName);
    } else if (authPendingAction.type === 'submit_handover') {
      await proceedToSubmitHandover(pickerName);
    }
    authPendingAction = null;
  } else {
    closeAuthPage();
  }
}

// Revert Confirmation Modal logic
let orderToRevert = null;

function confirmRevertOrder(order) {
  orderToRevert = order;
  const modal = document.getElementById('revert-modal');
  if (modal) {
    modal.style.display = 'flex';
  }
}

function closeRevertModal() {
  orderToRevert = null;
  const modal = document.getElementById('revert-modal');
  if (modal) {
    modal.style.display = 'none';
  }
}

async function executeRevertOrder() {
  if (!orderToRevert) return;
  const orderId = orderToRevert.ID;
  
  closeRevertModal();
  showToast("Reverting order status...", "info");

  try {
    const pickerName = getCachedAuth() || "Picker";
    const order = allOrders.find(o => o.ID === orderId);
    let logs = [];
    try {
      logs = JSON.parse((order && order.Logs) || '[]');
      if (!Array.isArray(logs)) logs = [];
    } catch (e) {
      logs = [];
    }
    logs.push({
      action: "Picking Reverted",
      actionBy: pickerName,
      remark: "Reverted back to Ready to Pick from Goods Ready",
      timestamp: Date.now()
    });

    await silentSyncOrderUpdate(orderId, {
      Status: "Ready to Pick",
      Photo_Picker_Proof: "",
      Picker_Photo: "",
      Logs: JSON.stringify(logs)
    });

    showToast("Order reverted back to picking!", "success");
  } catch (e) {
    console.error("Revert failed:", e);
    showToast("Failed to revert order: " + e.message, "error");
  }
}

function isOrderPickedByMe(order) {
  const me = getCachedAuth();
  return me && (order.Picker || '').trim() === me;
}

// Option 4: Revert status to Ready to Pick if browser is closed/tab is hidden during picking
// pagehide auto-revert listener disabled to allow picker to continue picking

// WhatsApp sharing modal and file downloader
async function sharePickerOrderToWhatsApp(orderId) {
  const order = allOrders.find(o => o.ID === orderId);
  if (!order) return;

  const id = order.ID || 'N/A';
  const deliverTo = order.Deliver_To || order.deliver_to || order.DeliverTo || 'N/A';
  const imgUrl = order.Photo_Handover_Proof || order.photo_handover_proof || order.Photo_Picker_Proof || order.photo_picker_proof || order.Picker_Photo || order.picker_photo || '';

  // Setup UI components
  const overlay = document.getElementById('whatsapp-prep-overlay');
  const drawer = document.getElementById('whatsapp-prep-drawer');
  const statusText = document.getElementById('whatsapp-prep-status');
  const progressBar = document.getElementById('whatsapp-prep-progress-bar');
  const cancelBtn = document.getElementById('whatsapp-prep-cancel-btn');
  const sendBtn = document.getElementById('whatsapp-prep-send-btn');

  if (!overlay || !drawer || !statusText || !progressBar || !cancelBtn || !sendBtn) {
    console.error("WhatsApp prep UI components not found");
    return;
  }

  // Populate info fields
  const storeNameEl = document.getElementById('whatsapp-prep-store-name');
  const retailerNameEl = document.getElementById('whatsapp-prep-retailer-name');
  const imagesListEl = document.getElementById('whatsapp-prep-images-list');
  const imagesSectionEl = document.getElementById('whatsapp-prep-images-section');

  if (storeNameEl) storeNameEl.textContent = id;
  if (retailerNameEl) retailerNameEl.textContent = deliverTo;

  if (imagesListEl) {
    imagesListEl.innerHTML = '';
    if (!imgUrl) {
      if (imagesSectionEl) imagesSectionEl.classList.add('hidden');
    } else {
      if (imagesSectionEl) imagesSectionEl.classList.remove('hidden');
      const thumbWrapper = document.createElement('div');
      thumbWrapper.style.cssText = 'flex-shrink: 0; width: 56px; aspect-ratio: 4 / 5; border-radius: 6px; border: 1px solid #E2E8F0; overflow: hidden; background: #F8FAFC; display: flex; align-items: center; justify-content: center;';
      
      const img = document.createElement('img');
      img.src = imgUrl;
      img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
      
      thumbWrapper.appendChild(img);
      imagesListEl.appendChild(thumbWrapper);
    }
  }

  statusText.textContent = "Preparing photo...";
  progressBar.style.width = "0%";
  sendBtn.disabled = true;
  sendBtn.style.opacity = "0.5";
  sendBtn.style.cursor = "not-allowed";

  // Open Drawer
  overlay.classList.add('active');
  drawer.classList.add('active');

  let isCancelled = false;
  
  const closePrepDrawer = () => {
    overlay.classList.remove('active');
    drawer.classList.remove('active');
  };

  const handleCancel = () => {
    isCancelled = true;
    closePrepDrawer();
  };
  
  cancelBtn.onclick = handleCancel;
  overlay.onclick = handleCancel;

  let downloadedFile = null;

  if (!imgUrl) {
    statusText.textContent = "Complete";
    progressBar.style.width = "100%";
    sendBtn.disabled = false;
    sendBtn.style.opacity = "1";
    sendBtn.style.cursor = "pointer";
  } else {
    try {
      statusText.textContent = "Downloading photo...";
      progressBar.style.width = "40%";

      let fetchUrl = imgUrl;
      if (!imgUrl.startsWith('data:') && !imgUrl.startsWith('blob:') && !imgUrl.startsWith(WORKER_URL)) {
        fetchUrl = `${WORKER_URL}/api/proxy?url=${encodeURIComponent(imgUrl)}`;
      }

      const res = await fetch(fetchUrl);
      if (!res.ok) throw new Error("Download failed");

      const blob = await res.blob();
      if (isCancelled) return;

      const doNumber = order.DO_Number || order.do_number || 'order';
      downloadedFile = new File([blob], `${doNumber}_proof.jpg`, { type: 'image/jpeg' });

      statusText.textContent = "Complete";
      progressBar.style.width = "100%";
      sendBtn.disabled = false;
      sendBtn.style.opacity = "1";
      sendBtn.style.cursor = "pointer";
    } catch (err) {
      console.warn("Failed to download proof image:", err);
      statusText.textContent = "Download failed (sharing text only)";
      progressBar.style.width = "100%";
      sendBtn.disabled = false;
      sendBtn.style.opacity = "1";
      sendBtn.style.cursor = "pointer";
    }
  }

  const ts = Number(order.Timestamp || Date.now());
  const d = new Date(ts);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const formattedDateTime = `${day}/${month}/${year} ${hours}:${minutes}`;

  let statusHeader = '';
  let statusRemark = '';

  if (order.Status === 'Delivered') {
    statusHeader = 'Goods Delivered';
    let handoverRemark = '';
    try {
      const logs = JSON.parse(order.Logs || '[]');
      const handoverLog = logs.find(l => l.action === "Handover Completed" || (l.action && l.action.toLowerCase().includes("handover")));
      if (handoverLog && handoverLog.remark) {
        handoverRemark = handoverLog.remark.replace("Handed over directly to", "Handover to");
      }
    } catch (_) {}
    
    if (!handoverRemark) {
      handoverRemark = "Handover Completed";
    }
    statusRemark = handoverRemark;
  } else {
    statusHeader = 'Goods Ready to Deliver';
    let pickerRemark = '';
    try {
      const logs = JSON.parse(order.Logs || '[]');
      const pickLog = logs.find(l => l.action === "Picked & Proof Submitted" || (l.action && l.action.toLowerCase().includes("picked")));
      if (pickLog && pickLog.remark) {
        pickerRemark = pickLog.remark;
      }
    } catch (_) {}
    
    if (!pickerRemark) {
      pickerRemark = "Goods Ready";
    }
    statusRemark = pickerRemark;
  }

  let itemsListText = '';
  try {
    const items = typeof order.Items === 'string' ? JSON.parse(order.Items || '[]') : (order.Items || []);
    if (Array.isArray(items) && items.length > 0) {
      itemsListText = `\n\nSKU........QTY\n` + items.map(item => {
        const skuRaw = String(item.sku || item.Sku || 'Unknown');
        const qty = item.qty || item.Qty || 0;
        return `${skuRaw}........${qty}`;
      }).join('\n');
    }
  } catch (e) {
    console.warn("Failed to parse items for WhatsApp share:", e);
  }

  const shareText = `\`${statusHeader}\`\nD - ${id}\n${deliverTo}\n${formattedDateTime}\n${statusRemark}${itemsListText}`;

  sendBtn.onclick = async () => {
    if (isCancelled) return;
    closePrepDrawer();

    let shared = false;

    if (navigator.share && downloadedFile) {
      try {
        if (navigator.canShare && navigator.canShare({ files: [downloadedFile] })) {
          await navigator.share({
            files: [downloadedFile],
            text: shareText,
            title: `Goods Ready - ${id}`
          });
          shared = true;
        }
      } catch (shareErr) {
        console.log("Web Share failed:", shareErr);
      }
    }

    if (!shared) {
      if (downloadedFile) {
        const fileUrl = URL.createObjectURL(downloadedFile);
        const a = document.createElement('a');
        a.href = fileUrl;
        a.download = downloadedFile.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(fileUrl);
        showToast("Photo downloaded. Redirecting to WhatsApp...", "success");
      }
      
      const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
      window.open(waUrl, '_blank');
    }
  };
}

// Handover Page View control functions
function openHandoverPage(order) {
  currentOrder = order;
  handoverPhotoFile = null;
  
  const page = document.getElementById('handover-page');
  if (page) {
    page.classList.add('active');
  }
  
  const markBox = document.getElementById('handover-order-mark');
  const idValue = document.getElementById('handover-order-id');
  const deliverValue = document.getElementById('handover-order-deliver');
  
  if (markBox) markBox.textContent = order.Mark || order.mark || '-';
  if (idValue) idValue.textContent = order.ID || 'N/A';
  if (deliverValue) {
    const deliverToVal = order.Deliver_To || order.deliver_to || order.DeliverTo || '';
    deliverValue.textContent = deliverToVal || 'No delivery destination specified';
  }
  
  // Clear inputs
  const nameInput = document.getElementById('handover-receiver-name');
  const phoneInput = document.getElementById('handover-receiver-phone');
  if (nameInput) nameInput.value = '';
  if (phoneInput) phoneInput.value = '';
  
  // Reset preview and placeholder
  const previewImg = document.getElementById('handover-page-preview-img');
  const placeholder = document.getElementById('handover-page-placeholder');
  const submitBtn = document.getElementById('handover-page-submit-btn');
  
  if (previewImg) {
    previewImg.classList.add('hidden');
    previewImg.src = '';
  }
  if (placeholder) {
    placeholder.style.display = 'flex';
  }
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.5';
    submitBtn.style.cursor = 'not-allowed';
  }
  
  // Clear file input
  const input = document.getElementById('handover-page-camera-input');
  if (input) input.value = '';
}

function closeHandoverPage() {
  const page = document.getElementById('handover-page');
  if (page) {
    page.classList.remove('active');
  }
  handoverPhotoFile = null;
  currentOrder = null;
}

function bindHandoverCamera() {
  const uploadBox = document.getElementById('handover-page-camera-box');
  const cameraInput = document.getElementById('handover-page-camera-input');
  const previewImg = document.getElementById('handover-page-preview-img');
  const placeholder = document.getElementById('handover-page-placeholder');
  const nameInput = document.getElementById('handover-receiver-name');
  const phoneInput = document.getElementById('handover-receiver-phone');

  // Input event listeners for live validation
  if (nameInput) {
    nameInput.addEventListener('input', validateHandoverForm);
    nameInput.addEventListener('focus', () => nameInput.style.borderColor = 'var(--app-color)');
    nameInput.addEventListener('blur', () => nameInput.style.borderColor = 'var(--border-color)');
  }
  if (phoneInput) {
    phoneInput.addEventListener('input', validateHandoverForm);
    phoneInput.addEventListener('focus', () => phoneInput.style.borderColor = 'var(--app-color)');
    phoneInput.addEventListener('blur', () => phoneInput.style.borderColor = 'var(--border-color)');
  }

  if (uploadBox && cameraInput) {
    uploadBox.addEventListener('click', () => {
      cameraInput.click();
    });

    cameraInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        handoverPhotoFile = file;
        
        const reader = new FileReader();
        reader.onload = (event) => {
          if (previewImg) {
            previewImg.src = event.target.result;
            previewImg.classList.remove('hidden');
          }
          if (placeholder) {
            placeholder.style.display = 'none';
          }
          validateHandoverForm();
        };
        reader.readAsDataURL(file);
      }
    });
  }
}

function validateHandoverForm() {
  const nameInput = document.getElementById('handover-receiver-name');
  const phoneInput = document.getElementById('handover-receiver-phone');
  const submitBtn = document.getElementById('handover-page-submit-btn');
  
  const nameVal = nameInput ? nameInput.value.trim() : '';
  const phoneVal = phoneInput ? phoneInput.value.trim() : '';
  
  const isValid = nameVal.length > 0 && phoneVal.length > 0 && handoverPhotoFile !== null;
  
  if (submitBtn) {
    submitBtn.disabled = !isValid;
    if (isValid) {
      submitBtn.style.opacity = '1';
      submitBtn.style.cursor = 'pointer';
    } else {
      submitBtn.style.opacity = '0.5';
      submitBtn.style.cursor = 'not-allowed';
    }
  }
}

async function proceedToSubmitHandover(pickerName) {
  const nameInput = document.getElementById('handover-receiver-name');
  const phoneInput = document.getElementById('handover-receiver-phone');
  
  const receiverName = nameInput ? nameInput.value.trim() : '';
  const receiverPhone = phoneInput ? phoneInput.value.trim() : '';

  if (!receiverName || !receiverPhone || !handoverPhotoFile) {
    showToast("Please fill in all mandatory fields", "error");
    return;
  }

  showToast("Submitting handover and updating status...", "info");
  
  try {
    let uploadFile = handoverPhotoFile;
    try {
      uploadFile = await compressImageToMax250kb(handoverPhotoFile);
    } catch (compressErr) {
      console.warn("Image compression failed, using original file:", compressErr);
    }
    
    const doNumber = currentOrder.DO_Number || currentOrder.do_number || 'UNKNOWN';
    const fileName = `Track_Orders/Handover_Proof/${doNumber}_${Date.now()}.jpg`;
    const uploadUrl = `${WORKER_URL}/api/upload?filename=${encodeURIComponent(fileName)}`;
    
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: uploadFile
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

    const order = allOrders.find(o => o.ID === currentOrder.ID);
    let logs = [];
    try {
      logs = JSON.parse((order && order.Logs) || '[]');
      if (!Array.isArray(logs)) logs = [];
    } catch (e) {
      logs = [];
    }
    logs.push({
      action: "Handover Completed",
      actionBy: pickerName,
      remark: `Handed over directly to ${receiverName} (${receiverPhone})`,
      timestamp: Date.now(),
      photoUrl: photoUrl
    });

    const submittedOrderId = currentOrder.ID;
    await silentSyncOrderUpdate(submittedOrderId, {
      Status: "Delivered",
      Photo_Handover_Proof: photoUrl,
      Logs: JSON.stringify(logs)
    });

    showToast("Handover completed successfully!", "success");
    
    closeAuthPage();
    closeHandoverPage();

    // Auto-trigger WhatsApp share drawer
    sharePickerOrderToWhatsApp(submittedOrderId);
    
  } catch (error) {
    console.error("Handover submission failed:", error);
    showToast("Handover failed: " + error.message, "error");
  }
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

function formatTimestamp(ts) {
  if (!ts) return "";
  const num = Number(ts);
  if (isNaN(num) || num <= 0) return String(ts);
  const date = new Date(num);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

// Expose to window object for inline HTML onclick triggers
window.sharePickerOrderToWhatsApp = sharePickerOrderToWhatsApp;
