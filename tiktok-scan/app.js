// iB - TikTok Scan PWA Logic
const WORKER_URL = "https://ib.hsgglobalpteltd.workers.dev";
let operatorName = "";
let allOrders = [];
let allUsers = [];
let codeReader = null;
let activeDeviceId = null;
let isScanning = false;
let isProcessingScan = false;

// Web Audio API Sound Synthesizer (No external assets required)
function playBeep(type) {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    if (type === 'success') {
      // High-pitched double chime
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
      gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);
      osc.start();
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
      osc.stop(audioCtx.currentTime + 0.15);
      
      setTimeout(() => {
        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(1046.5, audioCtx.currentTime); // C6
        gain2.gain.setValueAtTime(0.15, audioCtx.currentTime);
        osc2.start();
        gain2.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
        osc2.stop(audioCtx.currentTime + 0.2);
      }, 100);
    } else if (type === 'reject') {
      // Low dual buzzing buzz
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(120, audioCtx.currentTime); 
      gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime);
      osc.start();
      gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime + 0.1);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
      osc.stop(audioCtx.currentTime + 0.4);
    }
  } catch (e) {
    console.warn("Audio playback failed:", e);
  }
}

// Custom Toast System
function showToast(message, type = "info") {
  const toast = document.getElementById("toast-notification");
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast-notification visible ${type}`;
  setTimeout(() => {
    toast.className = "toast-notification";
  }, 2500);
}

// App Initialization
document.addEventListener("DOMContentLoaded", () => {
  checkAuthSession();
  bindAuthInputs();
  
  // Register click to focus hidden input
  const pinWrapper = document.getElementById("pin-digits-wrapper");
  const hiddenInput = document.getElementById("auth-pin-hidden");
  if (pinWrapper && hiddenInput) {
    pinWrapper.addEventListener("click", () => {
      hiddenInput.focus();
    });
  }

  // Bind logout and back buttons
  document.getElementById("logout-btn").addEventListener("click", performLogout);
  document.getElementById("auth-exit-btn").addEventListener("click", () => {
    window.location.href = "../index.html"; // Go back to apps pool
  });
});

// Authentication Caching Check (30 mins validity)
function checkAuthSession() {
  const cachedOperator = localStorage.getItem("tiktok_operator_name");
  const cachedTime = localStorage.getItem("tiktok_operator_auth_time");
  
  if (cachedOperator && cachedTime && (Date.now() - parseInt(cachedTime) < 30 * 60 * 1000)) {
    // Valid cached session
    loginSuccess(cachedOperator);
  } else {
    // Show login page
    performLogout();
  }
}

function bindAuthInputs() {
  const hiddenInput = document.getElementById("auth-pin-hidden");
  const displays = document.querySelectorAll("#auth-page .pin-digit-display");
  
  if (!hiddenInput) return;
  
  // Refocus input automatically
  document.addEventListener("click", (e) => {
    const authPage = document.getElementById("auth-page");
    if (authPage.classList.contains("active") && !e.target.closest(".pin-digits-row") && !e.target.closest(".preview-back-btn")) {
      hiddenInput.focus();
    }
  });

  hiddenInput.addEventListener("input", (e) => {
    const val = e.target.value.replace(/[^0-9]/g, "");
    e.target.value = val;

    // Render masked digits
    displays.forEach((display, idx) => {
      if (idx < val.length) {
        display.textContent = "●";
        display.classList.add("active");
      } else {
        display.textContent = "";
        display.classList.remove("active");
      }
    });

    if (val.length === 4) {
      verifyPIN(val);
    }
  });

  // Auto-focus on start
  setTimeout(() => {
    if (document.getElementById("auth-page").classList.contains("active")) {
      hiddenInput.focus();
    }
  }, 300);
}

// Fetch all database users to match PIN locally
async function verifyPIN(pin) {
  const hiddenInput = document.getElementById("auth-pin-hidden");
  const displays = document.querySelectorAll("#auth-page .pin-digit-display");
  
  try {
    const response = await fetch(`${WORKER_URL}/api/app/tiktok-scan/users?t=${Date.now()}`);
    if (!response.ok) throw new Error("Could not fetch user database.");
    
    allUsers = await response.json();
    const matchedUser = allUsers.find(u => String(u.pin || u.PIN || u.Password_PIN || u.password_pin).trim() === pin.trim());
    
    if (matchedUser) {
      const name = matchedUser.name || matchedUser.Name || "Operator";
      localStorage.setItem("tiktok_operator_name", name);
      localStorage.setItem("tiktok_operator_auth_time", String(Date.now()));
      loginSuccess(name);
    } else {
      // Shake error animation
      hiddenInput.classList.add("error");
      displays.forEach(d => d.classList.add("error"));
      playBeep("reject");
      showToast("Invalid security PIN.", "error");
      
      setTimeout(() => {
        hiddenInput.value = "";
        hiddenInput.classList.remove("error");
        displays.forEach(d => {
          d.textContent = "";
          d.classList.remove("active", "error");
        });
        hiddenInput.focus();
      }, 600);
    }
  } catch (err) {
    showToast("Authentication Error: " + err.message, "error");
    hiddenInput.value = "";
    displays.forEach(d => {
      d.textContent = "";
      d.classList.remove("active");
    });
  }
}

function loginSuccess(name) {
  operatorName = name;
  document.getElementById("operator-name").textContent = name;
  document.getElementById("auth-page").classList.remove("active");
  document.getElementById("auth-pin-hidden").blur();
  
  // Launch scanner
  initializeScanner();
  fetchOrdersLoop();
}

function performLogout() {
  localStorage.removeItem("tiktok_operator_name");
  localStorage.removeItem("tiktok_operator_auth_time");
  
  // Stop scanner if active
  if (codeReader) {
    codeReader.reset();
    codeReader = null;
  }
  isScanning = false;
  
  document.getElementById("auth-page").classList.add("active");
  const hiddenInput = document.getElementById("auth-pin-hidden");
  if (hiddenInput) {
    hiddenInput.value = "";
    hiddenInput.focus();
  }
  const displays = document.querySelectorAll("#auth-page .pin-digit-display");
  displays.forEach(d => {
    d.textContent = "";
    d.classList.remove("active", "error");
  });
}

// Fetch active orders from Supabase via worker
async function fetchOrdersLoop() {
  if (!operatorName) return;
  try {
    const response = await fetch(`${WORKER_URL}/api/admin/cache?sheet=tiktok_orders&t=${Date.now()}`);
    if (response.ok) {
      allOrders = await response.json();
    }
  } catch (e) {
    console.warn("Failed to update orders cache:", e);
  }
  // Poll silently in background every 10 seconds while logged in
  setTimeout(fetchOrdersLoop, 10000);
}

// Start live camera stream
async function initializeScanner() {
  if (isScanning) return;
  isScanning = true;
  isProcessingScan = false;
  
  const statusBar = document.getElementById("scan-status-bar");
  statusBar.textContent = "Initializing camera stream...";
  statusBar.className = "status-bar active animate-pulse";
  
  try {
    codeReader = new ZXing.BrowserMultiFormatReader();
    const videoDevices = await codeReader.listVideoInputDevices();
    
    if (videoDevices.length === 0) {
      throw new Error("No camera devices found.");
    }
    
    // Choose back camera if available
    let selectedDevice = videoDevices[0].deviceId;
    const backCamera = videoDevices.find(device => 
      device.label.toLowerCase().includes("back") || 
      device.label.toLowerCase().includes("rear") || 
      device.label.toLowerCase().includes("environment")
    );
    if (backCamera) {
      selectedDevice = backCamera.deviceId;
    }
    
    activeDeviceId = selectedDevice;
    
    codeReader.decodeFromVideoDevice(selectedDevice, "preview-video", (result, err) => {
      if (result && !isProcessingScan) {
        handleBarcodeScanned(result.text);
      }
    });
    
    statusBar.textContent = "Live Camera Active: Align Barcode";
    statusBar.className = "status-bar active";
    
  } catch (err) {
    statusBar.textContent = "Camera error: " + err.message;
    statusBar.className = "status-bar";
    showToast("Camera access required: " + err.message, "error");
  }
}

// Process scanned order barcode
async function handleBarcodeScanned(barcode) {
  isProcessingScan = true;
  
  // Pause scanner internally
  const cleanBarcode = barcode.trim();
  const statusBar = document.getElementById("scan-status-bar");
  statusBar.textContent = `Analyzing barcode: ${cleanBarcode}`;
  
  showFeedbackCard("loading", "Validating Parcel", `Checking order database for ${cleanBarcode}...`);
  
  // Match barcode against Order ID or Tracking Number
  const matchedOrder = allOrders.find(o => 
    String(o.id || o.ID).trim() === cleanBarcode || 
    String(o.tracking_number || o.Tracking_Number).trim() === cleanBarcode
  );
  
  if (!matchedOrder) {
    // REJECT: Order not found
    playBeep("reject");
    showFeedbackCard("error", "REJECT: NOT FOUND", `Order barcode ${cleanBarcode} is not in the system database.`);
    setTimeout(resumeScan, 3000);
    return;
  }
  
  // Check if order has active pending issue
  let activeIssues = [];
  try {
    const rawIssues = matchedOrder.issues || matchedOrder.Issues || "[]";
    activeIssues = typeof rawIssues === "string" ? JSON.parse(rawIssues) : rawIssues;
  } catch (_) {}
  
  const hasPendingIssue = Array.isArray(activeIssues) && activeIssues.some(i => i.status === "pending");
  if (hasPendingIssue) {
    // REJECT: Order has active issue
    playBeep("reject");
    showFeedbackCard("error", "REJECT: ACTIVE ISSUE", "This parcel has an unresolved issue. Resolve in Admin Console.");
    setTimeout(resumeScan, 4000);
    return;
  }

  // Check order status
  const currentStatus = matchedOrder.status || matchedOrder.Status;
  
  if (currentStatus === "Packed") {
    // REJECT: Already Packed
    playBeep("reject");
    showFeedbackCard("error", "REJECT: ALREADY PACKED", `This parcel was already packed by ${matchedOrder.packed_by || 'operator'}.`);
    setTimeout(resumeScan, 3500);
    return;
  }
  
  if (currentStatus === "Picked Up") {
    // REJECT: Already Picked Up
    playBeep("reject");
    showFeedbackCard("error", "REJECT: HANDED OVER", "This parcel has already been handed over to the courier.");
    setTimeout(resumeScan, 3500);
    return;
  }
  
  if (currentStatus === "Pending Pack") {
    // SUCCESS: Proceed with pack and proof capture
    playBeep("success");
    showFeedbackCard("success", "PARCEL VERIFIED", "Order details verified. Processing proof photo...");
    
    try {
      // 1. Capture and compress frame under 100kb
      const photoBlob = await captureProofPhoto();
      
      // 2. Upload to Cloudflare R2 secure storage
      const orderId = matchedOrder.id || matchedOrder.ID;
      const fileName = `Tiktok_Fulfillment/Pack_Proof/${orderId}_${Date.now()}.jpg`;
      const uploadUrl = `${WORKER_URL}/api/upload?filename=${encodeURIComponent(fileName)}`;
      
      showFeedbackCard("loading", "Uploading Proof", "Saving proof image to secure cloud storage...");
      
      const uploadRes = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: photoBlob
      });
      
      if (!uploadRes.ok) throw new Error("Cloud upload failed.");
      
      const uploadJson = await uploadRes.json();
      const photoUrl = uploadJson.url;
      
      // 3. Compile timeline logs
      let existingLogs = [];
      try {
        const rawLogs = matchedOrder.logs || matchedOrder.Logs || "[]";
        existingLogs = typeof rawLogs === "string" ? JSON.parse(rawLogs) : rawLogs;
      } catch (_) {}
      
      const newLogEntry = {
        action: "Packed & Proof Submitted",
        actionBy: operatorName,
        remark: `Scanned and verified by PWA.`,
        timestamp: Date.now(),
        photoUrl: photoUrl
      };
      
      existingLogs.push(newLogEntry);
      
      // 4. Send update to Supabase Postgres
      showFeedbackCard("loading", "Updating Database", "Updating parcel status to Packed...");
      
      const writePayload = {
        sheet: "Tiktok_Orders",
        action: "update",
        data: {
          id: orderId,
          status: "Packed",
          packed_by: operatorName,
          packed_at: Date.now(),
          proof_photo: photoUrl,
          logs: JSON.stringify(existingLogs)
        }
      };
      
      const writeRes = await fetch(`${WORKER_URL}/api/app/tiktok-scan/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(writePayload)
      });
      
      if (!writeRes.ok) throw new Error("Database update failed.");
      
      // Update local cache item immediately
      matchedOrder.status = "Packed";
      matchedOrder.packed_by = operatorName;
      matchedOrder.packed_at = Date.now();
      matchedOrder.proof_photo = photoUrl;
      matchedOrder.logs = JSON.stringify(existingLogs);
      
      showFeedbackCard("success", "PACKED SUCCESSFULLY", `Parcel for order ${orderId} has been marked packed.`);
      setTimeout(resumeScan, 2000);
      
    } catch (err) {
      console.error("Packing submission failed:", err);
      showFeedbackCard("error", "SUBMISSION FAILED", "Error writing package updates: " + err.message);
      setTimeout(resumeScan, 4000);
    }
  } else {
    // Catch-all safety state reject
    playBeep("reject");
    showFeedbackCard("error", "REJECT: INVALID STATE", `Order status is in an invalid state: ${currentStatus}`);
    setTimeout(resumeScan, 3000);
  }
}

// Snaps frame from <video> and compresses to Blob under 100KB
function captureProofPhoto() {
  return new Promise((resolve) => {
    const video = document.getElementById("preview-video");
    const canvas = document.getElementById("capture-canvas");
    const ctx = canvas.getContext("2d");
    
    // Lock dimensions matching live camera source resolution
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    
    // Render current frame to canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Downscale quality constraint (70% quality typically gives ~40kb-60kb JPEG)
    const quality = 0.7;
    canvas.toBlob((blob) => {
      resolve(blob);
    }, "image/jpeg", quality);
  });
}

function resumeScan() {
  hideFeedbackCard();
  const statusBar = document.getElementById("scan-status-bar");
  statusBar.textContent = "Live Camera Active: Align Barcode";
  isProcessingScan = false;
}

function showFeedbackCard(type, title, desc) {
  const overlay = document.getElementById("scan-overlay");
  const iconContainer = document.getElementById("feedback-icon-container");
  const titleEl = document.getElementById("feedback-title");
  const descEl = document.getElementById("feedback-desc");
  
  titleEl.textContent = title;
  descEl.textContent = desc;
  
  // Icon styling and SVGs
  iconContainer.className = `feedback-icon ${type}`;
  if (type === 'success') {
    iconContainer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  } else if (type === 'error') {
    iconContainer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
  } else if (type === 'loading') {
    iconContainer.innerHTML = `<svg class="spinner-icon" xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>`;
  }
  
  overlay.classList.remove("hidden");
}

function hideFeedbackCard() {
  document.getElementById("scan-overlay").classList.add("hidden");
}
