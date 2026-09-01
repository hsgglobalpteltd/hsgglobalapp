// Project 3 - Centralized Employee PIN Login & Role-Based App Hub
const WORKER_URL = 'https://ib-v2.hsgglobalpteltd.workers.dev';
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 Days

let allEmployees = [];
let enteredPin = '';
let isAuthenticating = false;

// App Definitions Registry
const APP_REGISTRY = [
  {
    id: 'merchandiser',
    label: 'Merchandiser',
    url: 'merchandiser/index.html',
    className: 'merchandiser',
    roles: ['merchandiser'],
    icon: `<svg class="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
      <line x1="3" y1="6" x2="21" y2="6"></line>
      <path d="M16 10a4 4 0 0 1-8 0"></path>
    </svg>`
  },
  {
    id: 'picker',
    label: 'Picker',
    url: 'picker/index.html',
    className: 'picker',
    roles: ['picker'],
    icon: `<svg class="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
      <line x1="12" y1="22.08" x2="12" y2="12"></line>
    </svg>`
  },
  {
    id: 'driver',
    label: 'Driver',
    url: 'driver/index.html',
    className: 'driver',
    roles: ['driver'],
    icon: `<svg class="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="1" y="3" width="15" height="13"></rect>
      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon>
      <circle cx="5.5" cy="18.5" r="2.5"></circle>
      <circle cx="18.5" cy="18.5" r="2.5"></circle>
    </svg>`
  },
  {
    id: 'stock-flow',
    label: 'Stock Flow',
    url: 'stock-flow/index.html',
    className: 'stock-flow',
    roles: ['warehouse', 'stock flow', 'stock_flow', 'stock take', 'stock_take', 'stock inventory', 'stock_inventory'],
    icon: `<svg class="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
      <line x1="9" y1="14" x2="15" y2="14"></line>
      <line x1="9" y1="18" x2="15" y2="18"></line>
      <line x1="9" y1="10" x2="15" y2="10"></line>
    </svg>`
  },
  {
    id: 'tiktok',
    label: 'Tiktok',
    url: 'tiktok/index.html',
    className: 'tiktok',
    roles: ['tiktok', 'warehouse'],
    icon: `<svg class="app-icon" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.88 2.89 2.89 0 0 1-2.89-2.88 2.89 2.89 0 0 1 2.89-2.88c.32 0 .62.06.9.15V9.42a6.32 6.32 0 0 0-.9-.07A6.33 6.33 0 0 0 3 15.68 6.33 6.33 0 0 0 9.34 22a6.33 6.33 0 0 0 6.33-6.32V8.65a8.21 8.21 0 0 0 3.92 1.35V6.69z"/>
    </svg>`
  },
  {
    id: 'promoter',
    label: 'Promoter',
    url: 'promoter/index.html',
    className: 'promoter',
    roles: ['promoter'],
    icon: `<svg class="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
      <circle cx="9" cy="7" r="4"></circle>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
    </svg>`
  },
  {
    id: 'staff-claims',
    label: 'Staff Claims',
    url: 'staff-claims/index.html',
    className: 'staff-claims',
    roles: ['staff claim', 'staff_claim', 'staff claims', 'staff_claims', 'claims', 'claim'],
    icon: `<svg class="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
      <line x1="16" y1="13" x2="8" y2="13"></line>
      <line x1="16" y1="17" x2="8" y2="17"></line>
      <polyline points="10 9 9 9 8 9"></polyline>
    </svg>`
  }
];

// Document Initialization
document.addEventListener('DOMContentLoaded', () => {
  sessionStorage.setItem('from_pools', 'true');

  // Render Desktop QR code if on desktop viewport
  setupDesktopView();

  // Load cached employees immediately
  loadCachedEmployees();

  // Setup PIN inputs and Modals
  bindAuthPinInputs();
  setupLogout();

  // Check 30-Day Session
  checkExistingSession();

  // Background fetch fresh employees list
  fetchEmployees();
});

// Setup Desktop View QR Code
function setupDesktopView() {
  const currentUrl = window.location.href;
  const urlDisplay = document.getElementById('current-url-display');
  if (urlDisplay) urlDisplay.textContent = currentUrl;

  const qrImg = document.getElementById('qr-code-img');
  if (qrImg) {
    const size = 200;
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(currentUrl)}`;
  }
}

// Load Cached Employees
function loadCachedEmployees() {
  try {
    const cached = localStorage.getItem('ib_employees');
    if (cached) {
      allEmployees = JSON.parse(cached);
    }
  } catch (_) {}
}

// Fetch Centralized Employees from Worker & Live Sync Roles
async function fetchEmployees() {
  try {
    const res = await fetch(`${WORKER_URL}/api/app-auth/employees?t=${Date.now()}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        allEmployees = data;
        localStorage.setItem('ib_employees', JSON.stringify(data));

        // Live Role & Status Sync: If currently logged in, refresh active roles
        try {
          const currentSessionStr = localStorage.getItem('ib_auth_user');
          if (currentSessionStr) {
            const currentUser = JSON.parse(currentSessionStr);
            const freshEmp = data.find(e => e.id === currentUser.id || String(e.pin) === String(currentUser.pin));
            if (freshEmp) {
              localStorage.setItem('ib_auth_user', JSON.stringify(freshEmp));
              renderAuthorizedApps(freshEmp);
            }
          }
        } catch (_) {}
      }
    }
  } catch (err) {
    console.warn("Could not fetch centralized employees:", err);
  }
}

// Check Existing 30-Day Session
function checkExistingSession() {
  try {
    const sessionStr = localStorage.getItem('ib_auth_user');
    const expiryStr = localStorage.getItem('ib_session_expiry');

    if (sessionStr && expiryStr) {
      const expiryTime = Number(expiryStr);
      if (Date.now() < expiryTime) {
        const user = JSON.parse(sessionStr);
        unlockMainHub(user);
        return;
      }
    }
  } catch (_) {}

  // No active session: Show PIN Gate
  lockMainHub();
}

// Lock Main Hub & Show PIN Overlay
function lockMainHub() {
  const overlay = document.getElementById('pin-auth-overlay');
  if (overlay) overlay.classList.remove('hidden');

  const welcomeText = document.getElementById('footer-welcome-text');
  if (welcomeText) welcomeText.style.display = 'none';

  const logoutBtn = document.getElementById('footer-logout-btn');
  if (logoutBtn) logoutBtn.style.display = 'none';

  const grid = document.getElementById('apps-grid');
  if (grid) grid.innerHTML = '';

  clearPin();
}

// Unlock Main Hub & Render Authorized Apps
function unlockMainHub(user) {
  const overlay = document.getElementById('pin-auth-overlay');
  if (overlay) overlay.classList.add('hidden');

  // Update Welcome Message in Footer
  const welcomeText = document.getElementById('footer-welcome-text');
  const userNameSpan = document.getElementById('welcome-user-name');
  if (welcomeText && userNameSpan) {
    userNameSpan.textContent = user.name || 'Staff';
    welcomeText.style.display = 'block';
  }

  // Show Footer Logout Button
  const logoutBtn = document.getElementById('footer-logout-btn');
  if (logoutBtn) logoutBtn.style.display = 'inline-flex';

  // Render Authorized Apps Grid
  renderAuthorizedApps(user);
}

// Render Authorized App Cards
function renderAuthorizedApps(user) {
  const grid = document.getElementById('apps-grid');
  if (!grid) return;

  const userRoles = Array.isArray(user.roles) ? user.roles : [];
  
  // Filter apps that match any user role or 'all'
  const authorizedApps = APP_REGISTRY.filter(app => {
    if (app.roles.includes('all')) return true;
    return app.roles.some(reqRole => userRoles.includes(reqRole.toLowerCase()));
  });

  if (authorizedApps.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px 16px; background: white; border-radius: 12px; border: 1px solid #E2E8F0;">
        <p style="font-size: 14px; font-weight: 700; color: #0F172A; margin-bottom: 6px;">No Apps Assigned</p>
        <p style="font-size: 12px; color: #64748B;">You do not currently have any active app roles assigned. Please contact your system administrator.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = authorizedApps.map(app => `
    <a href="${app.url}" class="app-card ${app.className}" data-app-id="${app.id}">
      <div class="app-icon-container">
        ${app.icon}
      </div>
      <span class="app-label">${app.label}</span>
    </a>
  `).join('');

  // Add prefetch & session sync listeners
  grid.querySelectorAll('.app-card').forEach(card => {
    const prefetchTarget = () => {
      const href = card.getAttribute('href');
      if (href && !card.dataset.prefetched) {
        card.dataset.prefetched = 'true';
        const link = document.createElement('link');
        link.rel = 'prefetch';
        link.href = href;
        document.head.appendChild(link);
      }
    };

    // Instant prefetch on touch/hover
    card.addEventListener('touchstart', prefetchTarget, { passive: true });
    card.addEventListener('mouseenter', prefetchTarget, { passive: true });

    card.addEventListener('click', () => {
      // Ensure sub-app recognizes the logged in employee
      const pickerName = user.name || 'picker';
      localStorage.setItem('auth_picker_name', pickerName);
      localStorage.setItem('auth_driver_name', pickerName);
      localStorage.setItem('auth_timestamp', String(Date.now()));
    });
  });

  // Background prefetch all authorized apps on idle
  const idleRunner = window.requestIdleCallback || ((cb) => setTimeout(cb, 200));
  idleRunner(() => {
    authorizedApps.forEach(app => {
      try {
        const link = document.createElement('link');
        link.rel = 'prefetch';
        link.href = app.url;
        document.head.appendChild(link);
      } catch (_) {}
    });
  });
}

// Bind Standard PIN Inputs Digit Behavior (Native Keyboard)
function bindAuthPinInputs() {
  const hiddenInput = document.getElementById('auth-pin-hidden');
  const displays = document.querySelectorAll('#pin-auth-overlay .pin-digit-display');
  const pinInput = document.getElementById('auth-pin-input');
  const wrapper = document.getElementById('pin-digits-wrapper');

  if (!hiddenInput || !wrapper) return;

  // Clicking anywhere on wrapper focuses the hidden input
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

    // Update masked displays
    displays.forEach((display, idx) => {
      if (idx < val.length) {
        display.textContent = '●';
        display.classList.remove('active');
        display.classList.remove('error');
      } else {
        display.textContent = '';
        display.classList.remove('error');
        if (idx === val.length) {
          display.classList.add('active');
        } else {
          display.classList.remove('active');
        }
      }
    });

    // Auto-authenticate when 4 digits completed and dismiss keyboard
    if (val.length === 4) {
      hiddenInput.blur();
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
      validateEnteredPin(val);
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

// Clear PIN Entry
function clearPin(shouldFocus = false) {
  const hiddenInput = document.getElementById('auth-pin-hidden');
  if (hiddenInput) {
    hiddenInput.value = '';
    hiddenInput.classList.remove('error');
    if (!shouldFocus) {
      hiddenInput.blur();
    }
  }

  const pinInput = document.getElementById('auth-pin-input');
  if (pinInput) {
    pinInput.value = '';
  }

  const displays = document.querySelectorAll('#pin-auth-overlay .pin-digit-display');
  displays.forEach((display, idx) => {
    display.textContent = '';
    display.classList.remove('error');
    if (idx === 0) {
      display.classList.add('active');
    } else {
      display.classList.remove('active');
    }
  });

  if (hiddenInput && shouldFocus) {
    setTimeout(() => {
      hiddenInput.focus();
    }, 200);
  }
}

// Validate Entered PIN against Centralized Employees
async function validateEnteredPin(pin) {
  isAuthenticating = true;
  const rawPin = String(pin).trim();
  const enteredInt = parseInt(rawPin, 10);

  // Force dismissal of mobile keyboard immediately
  const hiddenInput = document.getElementById('auth-pin-hidden');
  if (hiddenInput) hiddenInput.blur();
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }

  // If memory list is empty, retry from localStorage
  if (!allEmployees || allEmployees.length === 0) {
    loadCachedEmployees();
  }

  let matchedEmp = allEmployees.find(emp => {
    const empPin = String(emp.pin || '').trim();
    return empPin === rawPin || parseInt(empPin, 10) === enteredInt;
  });

  // If still not matched, perform rapid background network lookup
  if (!matchedEmp) {
    try {
      const res = await fetch(`${WORKER_URL}/api/app-auth/employees?t=${Date.now()}`);
      if (res.ok) {
        const freshList = await res.json();
        if (Array.isArray(freshList)) {
          allEmployees = freshList;
          localStorage.setItem('ib_employees', JSON.stringify(freshList));
          matchedEmp = allEmployees.find(emp => {
            const empPin = String(emp.pin || '').trim();
            return empPin === rawPin || parseInt(empPin, 10) === enteredInt;
          });
        }
      }
    } catch (_) {}
  }

  if (matchedEmp) {
    // 30-Day Session Persistence
    const expiryTimestamp = Date.now() + SESSION_DURATION_MS;
    localStorage.setItem('ib_auth_user', JSON.stringify(matchedEmp));
    localStorage.setItem('ib_session_expiry', String(expiryTimestamp));

    // Warm up sub-app sessions
    localStorage.setItem('auth_picker_name', matchedEmp.name || 'picker');
    localStorage.setItem('auth_driver_name', matchedEmp.name || 'driver');
    localStorage.setItem('auth_timestamp', String(Date.now()));

    showToast(`Welcome, ${matchedEmp.name}!`, "success");
    unlockMainHub(matchedEmp);
    clearPin(false); // Do not refocus keyboard
  } else {
    // Shake and display error
    const displays = document.querySelectorAll('#pin-auth-overlay .pin-digit-display');
    displays.forEach(d => d.classList.add('error'));
    showToast("Incorrect PIN. Please try again.", "error");

    setTimeout(() => {
      clearPin(true); // Refocus on error
    }, 600);
  }

  isAuthenticating = false;
}

// Setup Logout Action
function setupLogout() {
  const logoutBtn = document.getElementById('footer-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('ib_auth_user');
      localStorage.removeItem('ib_session_expiry');
      localStorage.removeItem('auth_picker_name');
      localStorage.removeItem('auth_driver_name');
      localStorage.removeItem('is_outsource');
      localStorage.removeItem('ib_os_session_id');

      showToast("Logged out successfully", "success");
      lockMainHub();
    });
  }
}

// Toast Notification Helper
let toastTimeout = null;
function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast-notification');
  if (!toast) return;

  if (toastTimeout) clearTimeout(toastTimeout);

  toast.textContent = msg;
  toast.style.backgroundColor = type === 'error' ? '#EF4444' : type === 'success' ? '#10B981' : '#0F172A';
  toast.classList.add('toast-visible');

  toastTimeout = setTimeout(() => {
    toast.classList.remove('toast-visible');
  }, 2200);
}

// Register Main Portal Service Worker for Centralized PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => {
        console.log('Main PWA Service Worker registered:', reg.scope);
        reg.update().catch(() => {});
      })
      .catch((err) => console.error('Service Worker registration failed:', err));
  });
}
