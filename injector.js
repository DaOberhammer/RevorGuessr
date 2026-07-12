(function () {
  if (window.__geoguessrLocationInjected) return;
  window.__geoguessrLocationInjected = true;

  const COORD_PATTERN = /-?\d+\.\d+,-?\d+\.\d+/g;
  const API_PATHS = ["GetMetadata", "SingleImageSearch"];
  const STREAK_SIGNATURE = "(e.latLng.lat(),e.latLng.lng())}";

  let latestLat = null;
  let latestLng = null;
  let placeRequestId = 0;

  function isTargetRequest(method, url) {
    if (method.toUpperCase() !== "POST" || typeof url !== "string") return false;
    return API_PATHS.some((path) => url.includes(path));
  }

  function extractCoords(responseText) {
    let lat = NaN;
    let lng = NaN;

    try {
      const json = JSON.parse(responseText);
      const locationArray = json?.[1]?.[0]?.[5]?.[0]?.[1]?.[0];
      if (Array.isArray(locationArray) && locationArray.length >= 4) {
        const potentialLat = locationArray[2];
        const potentialLng = locationArray[3];
        if (typeof potentialLat === "number" && typeof potentialLng === "number") {
          lat = potentialLat;
          lng = potentialLng;
        } else if (typeof potentialLat === "string" && typeof potentialLng === "string") {
          lat = parseFloat(potentialLat);
          lng = parseFloat(potentialLng);
        }
      }
    } catch (_) {
      // Fallback to regex below.
    }

    if (isNaN(lat) || isNaN(lng)) {
      const matches = responseText.match(COORD_PATTERN);
      if (matches && matches.length > 0) {
        const [parsedLat, parsedLng] = matches[0].split(",").map(parseFloat);
        if (!isNaN(parsedLat) && !isNaN(parsedLng)) {
          lat = parsedLat;
          lng = parsedLng;
        }
      }
    }

    if (!isNaN(lat) && !isNaN(lng)) {
      latestLat = lat;
      latestLng = lng;
      window.postMessage({ type: "GEOGUESSR_LOCATION", lat, lng }, "*");
    }
  }

  function randomPointInRadius(lat, lng, radiusKm) {
    if (!radiusKm || radiusKm <= 0) return { lat, lng };

    const angle = Math.random() * Math.PI * 2;
    const distance = Math.sqrt(Math.random()) * radiusKm;
    const latOffset = (distance * Math.cos(angle)) / 111.32;
    const lngOffset =
      (distance * Math.sin(angle)) / (111.32 * Math.cos((lat * Math.PI) / 180));

    return { lat: lat + latOffset, lng: lng + lngOffset };
  }

  function getReactFiberKey(element) {
    return Object.keys(element).find(
      (key) =>
        key.startsWith("__reactFiber$") ||
        key.startsWith("__reactInternalInstance$") ||
        key.startsWith("__reactContainer$")
    );
  }

  function isVisible(element) {
    if (!element || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function elementArea(element) {
    const rect = element.getBoundingClientRect();
    return rect.width * rect.height;
  }

  function findMapClickFromFiber(element) {
    const reactKey = getReactFiberKey(element);
    if (!reactKey) return null;

    try {
      const direct = element[reactKey]?.return?.return?.memoizedProps?.map?.__e3_?.click;
      if (direct) return direct;
    } catch (_) {
      // Walk the fiber tree below.
    }

    let fiber = element[reactKey];
    for (let depth = 0; fiber && depth < 32; depth++) {
      const props = fiber.memoizedProps || fiber.pendingProps;
      if (props?.map?.__e3_?.click) return props.map.__e3_.click;
      fiber = fiber.return;
    }

    return null;
  }

  function createLatLngPayload(lat, lng) {
    return {
      latLng: {
        lat: () => lat,
        lng: () => lng
      }
    };
  }

  function invokeStandardHandlers(mapClick, lat, lng) {
    const payload = createLatLngPayload(lat, lng);
    const groupKeys = Object.keys(mapClick);
    if (groupKeys.length === 0) return false;

    let invoked = false;

    for (const groupKey of groupKeys) {
      const group = mapClick[groupKey];
      if (!group || typeof group !== "object") continue;

      for (const fnKey of Object.keys(group)) {
        const fn = group[fnKey];
        if (typeof fn === "function") {
          try {
            fn(payload);
            invoked = true;
          } catch (_) {
            // Keep trying remaining handlers.
          }
        }
      }
    }

    const lastGroupKey = groupKeys[groupKeys.length - 1];
    const lastGroup = mapClick[lastGroupKey];
    if (lastGroup && typeof lastGroup === "object") {
      for (const fnKey of Object.keys(lastGroup)) {
        const fn = lastGroup[fnKey];
        if (typeof fn === "function") {
          try {
            fn(payload);
            invoked = true;
          } catch (_) {
            // Keep trying remaining handlers.
          }
        }
      }
    }

    return invoked;
  }

  function invokeStreakHandlers(mapClick, lat, lng) {
    const payload = createLatLngPayload(lat, lng);
    let invoked = false;

    for (const group of Object.values(mapClick)) {
      if (!group || typeof group !== "object") continue;

      for (const fnKey of Object.keys(group)) {
        const fn = group[fnKey];
        if (typeof fn === "function" && fn.toString().slice(5) === STREAK_SIGNATURE) {
          try {
            fn(payload);
            invoked = true;
          } catch (_) {
            // Keep trying remaining handlers.
          }
        }
      }
    }

    return invoked;
  }

  function placeOnElement(element, lat, lng) {
    const mapClick = findMapClickFromFiber(element);
    if (!mapClick) return false;
    return invokeStandardHandlers(mapClick, lat, lng) || invokeStreakHandlers(mapClick, lat, lng);
  }

  function collectMapCandidates() {
    const selectors = [
      '[class*="guess-map_canvas"]',
      '[class*="region-map_mapCanvas"]',
      '[class*="guess-map"] [class*="canvas"]',
      '[class*="guess-map"] canvas',
      '[class*="region-map"] [class*="mapCanvas"]'
    ];

    const seen = new Set();
    const candidates = [];

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((element) => {
        if (seen.has(element)) return;
        seen.add(element);
        candidates.push(element);

        let parent = element.parentElement;
        for (let depth = 0; parent && depth < 6; depth++) {
          if (!seen.has(parent)) {
            seen.add(parent);
            candidates.push(parent);
          }
          parent = parent.parentElement;
        }
      });
    }

    return candidates.sort((a, b) => {
      const av = isVisible(a);
      const bv = isVisible(b);
      if (av !== bv) return bv - av;
      return elementArea(b) - elementArea(a);
    });
  }

  function tryPlaceMarker(lat, lng) {
    const candidates = collectMapCandidates();
    for (const element of candidates) {
      if (placeOnElement(element, lat, lng)) return true;
    }
    return false;
  }

  function postMarkerResult(requestId, success, lat, lng, radiusKm) {
    window.postMessage(
      {
        type: "GEOGUESSR_MARKER_PLACED",
        requestId,
        success,
        lat,
        lng,
        radiusKm: radiusKm || 0
      },
      "*"
    );
  }

  function placeGuessMarker(lat, lng, radiusKm, requestId, attempt) {
    const target = randomPointInRadius(lat, lng, radiusKm);
    const maxAttempts = 10;

    if (tryPlaceMarker(target.lat, target.lng)) {
      postMarkerResult(requestId, true, target.lat, target.lng, radiusKm);
      return;
    }

    if (attempt < maxAttempts) {
      window.setTimeout(
        () => placeGuessMarker(lat, lng, radiusKm, requestId, attempt + 1),
        60 + attempt * 50
      );
      return;
    }

    postMarkerResult(requestId, false, target.lat, target.lng, radiusKm);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data) return;

    if (event.data.type === "GEOGUESSR_PLACE_MARKER") {
      const lat = typeof event.data.lat === "number" ? event.data.lat : latestLat;
      const lng = typeof event.data.lng === "number" ? event.data.lng : latestLng;
      const radiusKm = Number(event.data.radiusKm) || 0;
      const requestId = event.data.requestId || ++placeRequestId;

      if (typeof lat === "number" && typeof lng === "number") {
        placeGuessMarker(lat, lng, radiusKm, requestId, 0);
      } else {
        postMarkerResult(requestId, false, null, null, radiusKm);
      }
    }
  });

  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__geoMethod = method;
    this.__geoUrl = url;
    return originalXhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    if (isTargetRequest(this.__geoMethod, this.__geoUrl)) {
      this.addEventListener("load", function () {
        extractCoords(this.responseText);
      });
    }
    return originalXhrSend.apply(this, arguments);
  };

  const originalFetch = window.fetch;
  window.fetch = async function (input, init) {
    const response = await originalFetch.apply(this, arguments);
    try {
      const url = typeof input === "string" ? input : input?.url;
      const method = init?.method || "GET";
      if (isTargetRequest(method, url)) {
        const clone = response.clone();
        clone.text().then(extractCoords).catch(() => {});
      }
    } catch (_) {
      // Ignore fetch interception errors.
    }
    return response;
  };
})();