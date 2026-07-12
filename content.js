(function () {
  const INITIAL_ZOOM = 5;
  const COORD_THRESHOLD = 0.01;
  const PANEL_WIDTH = 360;
  const PANEL_HEIGHT = 400;
  const COLLAPSED_HEIGHT = 42;
  const DEFAULT_RADIUS_KM = 8;
  const MAX_RADIUS_KM = 120;
  const SUPPORT_URL = "https://buymeacoffee.com/revor";
  const SUPPORT_REMIND_MS = 60000;

  let shadowHost = null;
  let shadowRoot = null;
  let mapContainer = null;
  let coordsLabel = null;
  let statusLabel = null;
  let radiusLabel = null;
  let radiusSlider = null;
  let placeButton = null;
  let toggleButton = null;
  let leafletMap = null;
  let trueMarker = null;
  let guessMarker = null;
  let radiusCircle = null;
  let isExpanded = true;
  let displayedLat = null;
  let displayedLng = null;
  let radiusKm = DEFAULT_RADIUS_KM;
  let placeRequestId = 0;
  let supportTimer = null;

  function injectPageScript() {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("injector.js");
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }

  function configureLeafletIcons() {
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: chrome.runtime.getURL("leaflet/images/marker-icon-2x.png"),
      iconUrl: chrome.runtime.getURL("leaflet/images/marker-icon.png"),
      shadowUrl: chrome.runtime.getURL("leaflet/images/marker-shadow.png")
    });
  }

  function createNeonIcon(color) {
    const svg = encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40">
        <defs>
          <filter id="glow"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </defs>
        <path filter="url(#glow)" fill="${color}" stroke="#fff" stroke-width="1.2"
          d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.3 21.7 0 14 0z"/>
        <circle cx="14" cy="14" r="5" fill="#0a0a12"/>
      </svg>`
    );
    return L.icon({
      iconUrl: `data:image/svg+xml,${svg}`,
      iconSize: [28, 40],
      iconAnchor: [14, 40]
    });
  }

  const trueIcon = createNeonIcon("#ff2bd6");
  const guessIcon = createNeonIcon("#00f5ff");

  async function loadRadius() {
    try {
      const stored = await chrome.storage.local.get("radiusKm");
      if (typeof stored.radiusKm === "number") {
        radiusKm = Math.min(MAX_RADIUS_KM, Math.max(0, stored.radiusKm));
      }
    } catch (_) {
      // Use default radius.
    }
  }

  function saveRadius() {
    chrome.storage.local.set({ radiusKm }).catch(() => {});
  }

  async function createOverlay() {
    if (shadowHost) return;
    await loadRadius();

    shadowHost = document.createElement("div");
    shadowHost.id = "geoguessr-location-panel";
    Object.assign(shadowHost.style, {
      position: "fixed",
      top: "14px",
      right: "14px",
      width: `${PANEL_WIDTH}px`,
      height: `${PANEL_HEIGHT}px`,
      zIndex: "2147483647",
      borderRadius: "4px",
      overflow: "hidden",
      transition: "height 0.25s ease, box-shadow 0.25s ease"
    });
    document.body.appendChild(shadowHost);

    shadowRoot = shadowHost.attachShadow({ mode: "closed" });

    const cssResponse = await fetch(chrome.runtime.getURL("leaflet/leaflet.css"));
    const leafletCss = await cssResponse.text();

    const fontLink = document.createElement("link");
    fontLink.rel = "stylesheet";
    fontLink.href =
      "https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700&family=Share+Tech+Mono&display=swap";
    shadowRoot.appendChild(fontLink);

    const style = document.createElement("style");
    style.textContent = `
      ${leafletCss}
      * { box-sizing: border-box; }

      .panel {
        position: relative;
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        background: #07070f;
        color: #d8f7ff;
        font-family: "Share Tech Mono", Consolas, monospace;
        border: 1px solid #00f5ff44;
        box-shadow:
          0 0 18px #00f5ff33,
          inset 0 0 30px #ff2bd611;
      }

      .panel::before {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: repeating-linear-gradient(
          0deg,
          transparent,
          transparent 2px,
          rgba(0, 245, 255, 0.03) 2px,
          rgba(0, 245, 255, 0.03) 4px
        );
        z-index: 3;
      }

      .panel::after {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: linear-gradient(120deg, transparent 40%, rgba(255, 43, 214, 0.06) 50%, transparent 60%);
        z-index: 2;
      }

      .header {
        position: relative;
        z-index: 4;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 12px;
        background: linear-gradient(90deg, #12081f 0%, #071a2a 55%, #1a0530 100%);
        border-bottom: 1px solid #ff2bd655;
        flex-shrink: 0;
      }

      .title-wrap { min-width: 0; }

      .title {
        font-family: "Orbitron", sans-serif;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #00f5ff;
        text-shadow: 0 0 8px #00f5ffaa;
      }

      .coords {
        margin-top: 3px;
        font-size: 11px;
        color: #9be8ff;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .header-actions {
        display: flex;
        gap: 6px;
        flex-shrink: 0;
      }

      .btn {
        border: 1px solid #00f5ff66;
        border-radius: 2px;
        background: #0d1528;
        color: #00f5ff;
        cursor: pointer;
        font-family: "Orbitron", sans-serif;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        padding: 5px 8px;
        line-height: 1;
        text-transform: uppercase;
        transition: all 0.15s ease;
        box-shadow: 0 0 8px #00f5ff22;
      }

      .btn:hover {
        background: #122040;
        box-shadow: 0 0 14px #00f5ff55;
        border-color: #00f5ff;
      }

      .btn:active { transform: scale(0.97); }

      .btn-accent {
        border-color: #ff2bd688;
        color: #ff8be8;
        box-shadow: 0 0 8px #ff2bd633;
      }

      .btn-accent:hover {
        border-color: #ff2bd6;
        box-shadow: 0 0 16px #ff2bd666;
        color: #ffd0f5;
      }

      .btn-success {
        border-color: #39ff14aa;
        color: #39ff14;
        box-shadow: 0 0 10px #39ff1433;
      }

      .body {
        position: relative;
        z-index: 4;
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
      }

      .map {
        flex: 1;
        min-height: 0;
        background: #030308;
        filter: saturate(1.2) contrast(1.05);
      }

      .controls {
        padding: 10px 12px;
        background: linear-gradient(180deg, #0b1020 0%, #090912 100%);
        border-top: 1px solid #00f5ff33;
        display: grid;
        gap: 8px;
      }

      .control-row {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .place-btn {
        flex-shrink: 0;
        min-width: 108px;
      }

      .slider-wrap {
        flex: 1;
        min-width: 0;
      }

      .slider-label {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        color: #7fdfff;
        margin-bottom: 5px;
        letter-spacing: 0.06em;
      }

      .radius-value {
        color: #ff8be8;
        text-shadow: 0 0 6px #ff2bd666;
      }

      input[type="range"] {
        -webkit-appearance: none;
        width: 100%;
        height: 6px;
        border-radius: 3px;
        background: linear-gradient(90deg, #00f5ff, #ff2bd6);
        outline: none;
        box-shadow: 0 0 10px #00f5ff33;
      }

      input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: #0a0a12;
        border: 2px solid #00f5ff;
        box-shadow: 0 0 10px #00f5ff;
        cursor: pointer;
      }

      input[type="range"]::-moz-range-thumb {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: #0a0a12;
        border: 2px solid #00f5ff;
        box-shadow: 0 0 10px #00f5ff;
        cursor: pointer;
      }

      .footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 7px 12px;
        font-size: 10px;
        background: #06060d;
        border-top: 1px solid #ff2bd622;
      }

      .footer a {
        color: #00f5ff;
        text-decoration: none;
        letter-spacing: 0.05em;
      }

      .footer a:hover {
        text-shadow: 0 0 8px #00f5ff;
      }

      .status {
        color: #6ea6bb;
        letter-spacing: 0.04em;
      }

      .status.ok { color: #39ff14; text-shadow: 0 0 6px #39ff1466; }
      .status.err { color: #ff4d6d; text-shadow: 0 0 6px #ff4d6d66; }

      .collapsed .body { display: none; }

      .leaflet-control-zoom a {
        background: #0d1528 !important;
        color: #00f5ff !important;
        border-color: #00f5ff44 !important;
      }

      .support-link {
        color: #fcee0a !important;
        text-shadow: 0 0 6px #fcee0a66;
      }

      .support-link:hover {
        color: #fff3a0 !important;
      }

      .support-modal {
        position: absolute;
        inset: 0;
        z-index: 20;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 12px;
        background: rgba(2, 4, 12, 0.82);
        backdrop-filter: blur(3px);
      }

      .support-modal.hidden {
        display: none !important;
      }

      .support-card {
        position: relative;
        width: 100%;
        padding: 18px 14px 14px;
        text-align: center;
        background: linear-gradient(160deg, #140a24 0%, #081428 100%);
        border: 1px solid #fcee0a66;
        border-radius: 4px;
        box-shadow:
          0 0 24px #fcee0a33,
          0 0 40px #ff2bd622;
        animation: support-pulse 2.2s ease-in-out infinite;
      }

      @keyframes support-pulse {
        0%, 100% { box-shadow: 0 0 18px #fcee0a33, 0 0 34px #ff2bd622; }
        50% { box-shadow: 0 0 30px #fcee0a66, 0 0 50px #ff2bd644; }
      }

      .support-close {
        position: absolute;
        top: 6px;
        right: 8px;
        border: none;
        background: transparent;
        color: #9be8ff;
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
        padding: 2px 6px;
      }

      .support-close:hover { color: #ff2bd6; }

      .support-icon {
        font-size: 30px;
        margin-bottom: 8px;
        filter: drop-shadow(0 0 8px #fcee0a88);
      }

      .support-title {
        font-family: "Orbitron", sans-serif;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.1em;
        color: #fcee0a;
        text-transform: uppercase;
        margin-bottom: 6px;
      }

      .support-text {
        font-size: 11px;
        color: #9be8ff;
        line-height: 1.45;
        margin-bottom: 12px;
      }

      .btn-coffee {
        width: 100%;
        margin-bottom: 6px;
        border-color: #fcee0a !important;
        color: #fcee0a !important;
        box-shadow: 0 0 12px #fcee0a44 !important;
      }

      .btn-coffee:hover {
        background: #2a2208 !important;
        box-shadow: 0 0 18px #fcee0a77 !important;
      }

      .btn-later {
        width: 100%;
        font-size: 10px !important;
        opacity: 0.85;
      }
    `;
    shadowRoot.appendChild(style);

    const panel = document.createElement("div");
    panel.className = "panel";
    panel.innerHTML = `
      <div class="header">
        <div class="title-wrap">
          <div class="title">// GEO_SIGNAL</div>
          <div class="coords">SCANNING…</div>
        </div>
        <div class="header-actions">
          <button class="btn btn-accent maps-btn" title="Open in Google Maps">MAPS</button>
          <button class="btn toggle-btn" title="Collapse panel">−</button>
        </div>
      </div>
      <div class="body">
        <div class="map"></div>
        <div class="controls">
          <div class="control-row">
            <button class="btn place-btn" title="Place pin on the GeoGuessr guess map">SET PIN</button>
            <div class="slider-wrap">
              <div class="slider-label">
                <span>SCATTER RADIUS</span>
                <span class="radius-value">${formatRadius(radiusKm)}</span>
              </div>
              <input type="range" class="radius-slider" min="0" max="${MAX_RADIUS_KM}" step="1" value="${radiusKm}">
            </div>
          </div>
        </div>
        <div class="footer">
          <span class="status">Ready</span>
          <a class="support-link" href="${SUPPORT_URL}" target="_blank" rel="noopener">☕ COFFEE</a>
        </div>
      </div>
      <div class="support-modal hidden">
        <div class="support-card">
          <button class="support-close" type="button" aria-label="Close">×</button>
          <div class="support-icon">☕</div>
          <div class="support-title">100% Free · by revor</div>
          <div class="support-text">Enjoying the overlay? Fuel the next update with a coffee.</div>
          <button class="btn btn-coffee support-open" type="button">☕ BUY REVOR A COFFEE</button>
          <button class="btn btn-later support-dismiss" type="button">MAYBE LATER</button>
        </div>
      </div>
    `;
    shadowRoot.appendChild(panel);

    coordsLabel = panel.querySelector(".coords");
    statusLabel = panel.querySelector(".status");
    radiusLabel = panel.querySelector(".radius-value");
    radiusSlider = panel.querySelector(".radius-slider");
    mapContainer = panel.querySelector(".map");
    placeButton = panel.querySelector(".place-btn");
    toggleButton = panel.querySelector(".toggle-btn");

    panel.querySelector(".maps-btn").addEventListener("click", openInGoogleMaps);
    toggleButton.addEventListener("click", togglePanel);
    placeButton.addEventListener("click", requestPlaceMarker);
    radiusSlider.addEventListener("input", onRadiusChange);
    wireSupportModal(panel);
    showSupportModal();
    startSupportReminderLoop();
  }

  function wireSupportModal(panel) {
    const openSupport = () => window.open(SUPPORT_URL, "_blank", "noopener");
    const dismissSupport = () => hideSupportModal();

    panel.querySelector(".support-open")?.addEventListener("click", openSupport);
    panel.querySelector(".support-dismiss")?.addEventListener("click", dismissSupport);
    panel.querySelector(".support-close")?.addEventListener("click", dismissSupport);
  }

  function showSupportModal() {
    shadowRoot?.querySelector(".support-modal")?.classList.remove("hidden");
  }

  function hideSupportModal() {
    shadowRoot?.querySelector(".support-modal")?.classList.add("hidden");
    scheduleSupportReminder();
  }

  function scheduleSupportReminder() {
    if (supportTimer) window.clearTimeout(supportTimer);
    supportTimer = window.setTimeout(() => {
      if (shadowHost && shadowHost.style.display !== "none") {
        showSupportModal();
      }
    }, SUPPORT_REMIND_MS);
  }

  function startSupportReminderLoop() {
    scheduleSupportReminder();
  }

  function formatRadius(km) {
    return km <= 0 ? "0 km · EXACT" : `± ${km} km`;
  }

  function onRadiusChange() {
    radiusKm = Number(radiusSlider.value);
    radiusLabel.textContent = formatRadius(radiusKm);
    saveRadius();
    updateRadiusCircle();
  }

  function setStatus(text, type) {
    if (!statusLabel) return;
    statusLabel.textContent = text;
    statusLabel.className = "status" + (type ? ` ${type}` : "");
  }

  function togglePanel() {
    isExpanded = !isExpanded;
    const panel = shadowRoot.querySelector(".panel");
    panel.classList.toggle("collapsed", !isExpanded);
    shadowHost.style.height = isExpanded ? `${PANEL_HEIGHT}px` : `${COLLAPSED_HEIGHT}px`;
    toggleButton.textContent = isExpanded ? "−" : "+";
    if (isExpanded) {
      showSupportModal();
      if (leafletMap) requestAnimationFrame(() => leafletMap.invalidateSize());
    }
  }

  function formatCoords(lat, lng) {
    return `${lat.toFixed(5)} · ${lng.toFixed(5)}`;
  }

  function openInGoogleMaps() {
    if (displayedLat == null || displayedLng == null) return;
    window.open(
      `https://www.google.com/maps?q=${displayedLat},${displayedLng}&z=10`,
      "_blank",
      "noopener"
    );
  }

  function updateMapsLink() {
    const link = shadowRoot?.querySelector(".maps-link");
    if (!link || displayedLat == null) return;
    link.href = `https://www.google.com/maps?q=${displayedLat},${displayedLng}&z=10`;
  }

  function updateRadiusCircle() {
    if (!leafletMap || displayedLat == null) return;

    if (radiusCircle) {
      leafletMap.removeLayer(radiusCircle);
      radiusCircle = null;
    }

    if (radiusKm > 0) {
      radiusCircle = L.circle([displayedLat, displayedLng], {
        radius: radiusKm * 1000,
        color: "#00f5ff",
        weight: 1.5,
        fillColor: "#ff2bd6",
        fillOpacity: 0.12,
        dashArray: "6 8"
      }).addTo(leafletMap);
    }
  }

  function updateMap(lat, lng) {
    if (!leafletMap) {
      leafletMap = L.map(mapContainer, {
        zoomControl: true,
        attributionControl: false
      }).setView([lat, lng], INITIAL_ZOOM);

      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        subdomains: "abcd",
        maxZoom: 19
      }).addTo(leafletMap);

      trueMarker = L.marker([lat, lng], { icon: trueIcon }).addTo(leafletMap);
    } else {
      leafletMap.setView([lat, lng], leafletMap.getZoom());
      trueMarker.setLatLng([lat, lng]);
      requestAnimationFrame(() => leafletMap.invalidateSize());
    }

    if (guessMarker) {
      leafletMap.removeLayer(guessMarker);
      guessMarker = null;
    }

    updateRadiusCircle();
  }

  function showGuessPreview(lat, lng) {
    if (!leafletMap) return;

    if (guessMarker) {
      guessMarker.setLatLng([lat, lng]);
    } else {
      guessMarker = L.marker([lat, lng], { icon: guessIcon }).addTo(leafletMap);
    }
  }

  function requestPlaceMarker() {
    if (displayedLat == null || displayedLng == null) {
      setStatus("No signal", "err");
      return;
    }

    const requestId = ++placeRequestId;
    setStatus("Placing pin…");
    placeButton.classList.remove("btn-success");
    window.postMessage(
      {
        type: "GEOGUESSR_PLACE_MARKER",
        requestId,
        lat: displayedLat,
        lng: displayedLng,
        radiusKm
      },
      "*"
    );
  }

  async function handleCoords(lat, lng) {
    const changed =
      displayedLat == null ||
      Math.abs(lat - displayedLat) > COORD_THRESHOLD ||
      Math.abs(lng - displayedLng) > COORD_THRESHOLD;

    if (!changed) return;

    displayedLat = lat;
    displayedLng = lng;

    if (!shadowHost) await createOverlay();

    shadowHost.style.display = "block";
    coordsLabel.textContent = formatCoords(lat, lng);
    updateMapsLink();
    updateMap(lat, lng);
    if (placeButton) placeButton.classList.remove("btn-success");
    setStatus("Signal acquired");
    showSupportModal();
  }

  function shouldHideOnPage() {
    const path = location.pathname;
    const gamePaths = [
      "/game/",
      "/challenge/",
      "/duels/",
      "/battle-royale/",
      "/live-challenge/",
      "/country-streak/",
      "/us-state-streak/",
      "/world-streak/"
    ];
    return !gamePaths.some((segment) => path.includes(segment));
  }

  function hideOverlay() {
    if (shadowHost) shadowHost.style.display = "none";
    displayedLat = null;
    displayedLng = null;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data) return;

    if (event.data.type === "GEOGUESSR_LOCATION") {
      const { lat, lng } = event.data;
      if (typeof lat === "number" && typeof lng === "number") {
        handleCoords(lat, lng);
      }
      return;
    }

    if (event.data.type === "GEOGUESSR_MARKER_PLACED") {
      if (event.data.requestId && event.data.requestId !== placeRequestId) return;

      if (event.data.success) {
        showGuessPreview(event.data.lat, event.data.lng);
        setStatus(
          radiusKm > 0
            ? `Pin placed · ±${radiusKm} km`
            : "Pin placed exactly",
          "ok"
        );
        placeButton.classList.add("btn-success");
        showSupportModal();
      } else {
        setStatus("Guess map not found", "err");
        placeButton.classList.remove("btn-success");
      }
    }
  });

  let lastHref = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      if (shouldHideOnPage()) hideOverlay();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  configureLeafletIcons();
  injectPageScript();
})();