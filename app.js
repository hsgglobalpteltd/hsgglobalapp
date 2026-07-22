document.addEventListener('DOMContentLoaded', () => {
  sessionStorage.setItem('from_pools', 'true');
  // Get the current page URL
  const currentUrl = window.location.href;

  // Render the current URL text on the desktop screen
  const urlDisplay = document.getElementById('current-url-display');
  if (urlDisplay) {
    urlDisplay.textContent = currentUrl;
  }

  // Set the src for the QR Code image
  const qrImg = document.getElementById('qr-code-img');
  if (qrImg) {
    // We use a clean, public QR code generator API (qrserver.com) to render the URL
    const size = 200;
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(currentUrl)}`;
  }
});
