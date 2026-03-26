const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:3001/api' : '/api';

// State
let map;
let activeStore = null;
let activeFilter = 'all';
let activeRadius = 800;
let places = [];
let anchorMarker = null;
let radiusCircle = null;
let placeMarkers = [];
let storeMarkers = [];

// Boring chains and big-box stores to filter out
const CHAIN_BLACKLIST = [
  'walmart', 'target', 'costco', 'staples', 'best buy', 'home depot',
  'lowes', 'walgreens', 'cvs', 'rite aid', 'dollar tree', 'dollar general',
  'family dollar', 'marshalls', 'winners', 'homesense', 'tj maxx',
  'bed bath', 'michaels', 'joann', 'hobby lobby', 'office depot',
  'petco', 'petsmart', 'gamestop', 'radioshack', 'sprint', 'boost mobile',
  'subway', 'burger king', 'wendy', 'taco bell', 'kfc', 'popeyes',
  'pizza hut', 'domino', 'little caesars', 'papa john', 'dunkin',
  'tim hortons', 'mcdonald', 'arby', 'sonic drive', 'jack in the box',
  'carl\'s jr', 'hardee', 'checkers', 'rally\'s', 'white castle',
  'church\'s chicken', 'long john silver', 'captain d',
  '7-eleven', 'circle k', 'shell', 'exxon', 'chevron', 'bp',
  'h&r block', 'liberty tax', 'jackson hewitt',
  'fedex', 'ups store', 'usps',
  'wells fargo', 'chase bank', 'bank of america', 'td bank', 'cibc', 'rbc', 'scotiabank', 'bmo',
  'at&t', 't-mobile', 'verizon', 'rogers', 'bell', 'telus', 'fido',
  'jiffy lube', 'midas', 'firestone', 'goodyear',
  'superstore', 'no frills', 'food basics', 'freshco', 'metro',
  'shoppers drug mart', 'rexall', 'london drugs',
  'lcbo', 'beer store',
  'whole foods', 'trader joe', 'safeway', 'sobeys', 'loblaws',
  'kroger', 'publix', 'aldi', 'lidl', 'piggly wiggly',
  'save-on-foods', 'co-op grocery', 'grocery'
];

function isChainStore(name) {
  const lower = name.toLowerCase();
  return CHAIN_BLACKLIST.some(chain => lower.includes(chain));
}

// XSS protection
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Category type mapping (mirrors server-side)
const CATEGORY_MAP = {
  restaurant: 'food', bakery: 'food',
  cafe: 'coffee',
  bar: 'drinks', night_club: 'drinks',
  clothing_store: 'shopping', shoe_store: 'shopping', book_store: 'shopping', store: 'shopping',
  gym: 'wellness', spa: 'wellness',
  museum: 'culture', art_gallery: 'culture', library: 'culture'
};

const CATEGORY_COLORS = {
  food: 'hsl(28, 60%, 50%)',
  coffee: 'hsl(25, 45%, 40%)',
  drinks: 'hsl(340, 40%, 50%)',
  shopping: 'hsl(42, 50%, 50%)',
  wellness: 'hsl(155, 30%, 45%)',
  culture: 'hsl(255, 30%, 55%)'
};

// Init
function init() {
  initMap();
  bindEvents();
}

function initMap() {
  map = L.map('map', {
    zoomControl: true,
    attributionControl: true
  }).setView([43.65, -79.38], 13);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(map);
}

function bindEvents() {
  const cityInput = document.getElementById('city-input');
  const searchBtn = document.getElementById('search-btn');

  searchBtn.addEventListener('click', () => {
    hideSuggestions();
    searchCity(cityInput.value);
  });
  cityInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); moveFocus(-1); return; }
    if (e.key === 'Escape')    { hideSuggestions(); return; }
    if (e.key === 'Enter') {
      const focused = document.querySelector('.city-suggestion-item.focused');
      if (focused) {
        cityInput.value = focused.dataset.city;
        hideSuggestions();
        searchCity(cityInput.value);
      } else {
        hideSuggestions();
        searchCity(cityInput.value);
      }
    }
  });

  // Autocomplete
  let acDebounce = null;
  let acFocusIndex = -1;

  cityInput.addEventListener('input', () => {
    clearTimeout(acDebounce);
    acFocusIndex = -1;
    const q = cityInput.value.trim();
    if (q.length < 2) { hideSuggestions(); return; }
    acDebounce = setTimeout(() => fetchCitySuggestions(q), 280);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) hideSuggestions();
  });

  // Filter pills
  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeFilter = pill.dataset.type;
      fetchNearby();
    });
  });

  // Radius buttons
  document.querySelectorAll('.radius-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.radius-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeRadius = Number(btn.dataset.radius);
      fetchNearby();
    });
  });

  // Quick-select cities
  document.querySelectorAll('.quick-city').forEach(btn => {
    btn.addEventListener('click', () => {
      const city = btn.dataset.city;
      document.getElementById('city-input').value = city;
      searchCity(city);
    });
  });

  // Home link - reset to landing
  document.getElementById('home-link').addEventListener('click', () => {
    clearPlaces();
    clearStoreMarkers();
    activeStore = null;
    activeFilter = 'all';
    document.getElementById('city-input').value = '';
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    document.querySelector('.filter-pill[data-type="all"]').classList.add('active');
    hideElement('store-selector');
    hideElement('filters');
    hideElement('no-results');
    hideElement('loading-state');
    showElement('empty-state');
    showElement('places-list');
    map.setView([43.65, -79.38], 3, { animate: true });
  });
}

async function searchCity(city) {
  if (!city.trim()) return;

  showLoading();
  hideElement('empty-state');
  hideElement('no-results');
  clearPlaces();
  clearStoreMarkers();

  try {
    const res = await fetch(`${API_BASE}/stores?city=${encodeURIComponent(city)}`);
    if (!res.ok) throw new Error('Store search failed');
    const stores = await res.json();

    if (!stores.length) {
      hideLoading();
      showElement('no-results');
      document.querySelector('#no-results .empty-title').textContent = 'No Lululemon found';
      document.querySelector('#no-results .empty-body').textContent = `Could not find a Lululemon store in "${city}". Try another city.`;
      return;
    }

    renderStores(stores);
    selectStore(stores[0]);
  } catch (err) {
    console.error('Search failed:', err);
    hideLoading();
    showElement('no-results');
    document.querySelector('#no-results .empty-title').textContent = 'Something went wrong';
    document.querySelector('#no-results .empty-body').textContent = 'Could not connect to the server. Make sure the proxy is running on port 3001.';
  }
}

function renderStores(stores) {
  const container = document.getElementById('store-list');
  container.innerHTML = '';

  stores.forEach((store, i) => {
    const shortAddress = store.address.split(',')[0];
    const el = document.createElement('div');
    el.className = 'store-item';
    el.textContent = shortAddress;
    el.addEventListener('click', () => selectStore(store));
    container.appendChild(el);

    // Add store marker to map
    if (store.lat && store.lng) {
      const marker = L.marker([store.lat, store.lng], {
        icon: L.divIcon({
          className: 'store-map-marker',
          html: `<div class="anchor-marker" style="opacity: ${i === 0 ? 1 : 0.4}"></div>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8]
        })
      }).addTo(map);
      marker.on('click', () => selectStore(store));
      marker._storeId = store.id;
      storeMarkers.push(marker);
    }
  });

  showElement('store-selector');
}

function selectStore(store) {
  activeStore = store;

  // Update store list UI
  const shortAddress = store.address.split(',')[0];
  document.querySelectorAll('.store-item').forEach((el) => {
    el.classList.toggle('active', el.textContent === shortAddress);
  });

  // Update store marker opacity
  storeMarkers.forEach(m => {
    const isActive = m._storeId === store.id;
    const markerEl = m.getElement();
    if (markerEl) {
      const dot = markerEl.querySelector('.anchor-marker');
      if (dot) dot.style.opacity = isActive ? '1' : '0.4';
    }
  });

  // Center map
  if (store.lat && store.lng) {
    map.setView([store.lat, store.lng], 15, { animate: true });
    setAnchorMarker(store.lat, store.lng);
  }

  showElement('filters');
  fetchNearby();
}

function setAnchorMarker(lat, lng) {
  if (anchorMarker) map.removeLayer(anchorMarker);
  if (radiusCircle) map.removeLayer(radiusCircle);

  anchorMarker = L.marker([lat, lng], {
    icon: L.divIcon({
      className: '',
      html: '<div class="anchor-marker"></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    }),
    zIndexOffset: 1000
  }).addTo(map);

  radiusCircle = L.circle([lat, lng], {
    radius: activeRadius,
    className: 'radius-circle',
    interactive: false
  }).addTo(map);
}

async function fetchNearby() {
  if (!activeStore) return;

  showLoading();
  hideElement('no-results');
  clearPlaces();

  const typeParam = activeFilter === 'all' ? '' : `&type=${activeFilter}`;

  try {
    const res = await fetch(
      `${API_BASE}/nearby?lat=${activeStore.lat}&lng=${activeStore.lng}&radius=${activeRadius}${typeParam}`
    );
    if (!res.ok) throw new Error('Nearby search failed');
    places = await res.json();

    // Filter out non-operational, chain stores, and grocery stores
    const boringTypes = ['grocery_store', 'supermarket', 'convenience_store', 'gas_station', 'car_dealer', 'car_repair', 'insurance_agency', 'real_estate_agency', 'laundry', 'storage', 'hotel', 'motel', 'lodging', 'extended_stay_hotel', 'resort_hotel'];
    places = places.filter(p =>
      p.status === 'OPERATIONAL' &&
      !isChainStore(p.name) &&
      !p.types.some(t => boringTypes.includes(t))
    );

    // Update radius circle
    if (radiusCircle) {
      map.removeLayer(radiusCircle);
    }
    radiusCircle = L.circle([activeStore.lat, activeStore.lng], {
      radius: activeRadius,
      className: 'radius-circle',
      interactive: false
    }).addTo(map);

    hideLoading();

    if (!places.length) {
      showElement('no-results');
      document.querySelector('#no-results .empty-title').textContent = 'Nothing here yet';
      document.querySelector('#no-results .empty-body').textContent = 'Try expanding the radius or choosing a different filter.';
      return;
    }

    renderPlaces(places);
  } catch (err) {
    console.error('Nearby fetch failed:', err);
    hideLoading();
    showElement('no-results');
  }
}

function renderPlaces(places) {
  const container = document.getElementById('places-list');
  container.innerHTML = '';

  places.forEach((place, index) => {
    const category = resolveCategory(place.types);
    const categoryColor = CATEGORY_COLORS[category] || 'var(--ink-muted)';
    const distance = activeStore ? getDistance(
      activeStore.lat, activeStore.lng, place.lat, place.lng
    ) : null;

    const card = document.createElement('div');
    card.className = 'place-card';
    card.style.animationDelay = `${index * 40}ms`;

    const photoHtml = place.photoRef
      ? `<img class="place-photo" src="${API_BASE}/photo?name=${encodeURIComponent(place.photoRef)}" alt="${escapeHtml(place.name)}" loading="lazy" onerror="this.outerHTML='<div class=\\'place-photo-placeholder\\'>No photo</div>'">`
      : '<div class="place-photo-placeholder">No photo</div>';

    const ratingHtml = place.rating
      ? `<span class="place-rating">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          ${escapeHtml(String(place.rating))}
        </span>`
      : '';

    const priceHtml = place.priceLevel
      ? `<span>${escapeHtml(priceLevelText(place.priceLevel))}</span>`
      : '';

    const distanceHtml = distance !== null
      ? `<span class="place-distance">${escapeHtml(formatDistance(distance))}</span>`
      : '';

    card.innerHTML = `
      ${photoHtml}
      <div class="place-info">
        <span class="place-type type-${escapeHtml(category)}">${escapeHtml(place.primaryType || category)}</span>
        <span class="place-name">${escapeHtml(place.name)}</span>
        <div class="place-meta">
          ${ratingHtml}
          ${priceHtml}
          ${distanceHtml}
        </div>
        <span class="place-address">${escapeHtml(place.address)}</span>
      </div>
    `;

    // Hover: highlight map marker
    card.addEventListener('mouseenter', () => highlightMarker(index, true));
    card.addEventListener('mouseleave', () => highlightMarker(index, false));

    // Click: open in Google Maps
    card.addEventListener('click', () => {
      const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}&query_place_id=${place.id}`;
      window.open(url, '_blank');
    });

    container.appendChild(card);

    // Add map marker
    if (place.lat && place.lng) {
      const marker = L.marker([place.lat, place.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div class="place-marker" style="background: ${categoryColor}"></div>`,
          iconSize: [10, 10],
          iconAnchor: [5, 5]
        })
      }).addTo(map);
      marker.bindTooltip(place.name, {
        direction: 'top',
        offset: [0, -8],
        className: 'place-tooltip'
      });
      placeMarkers.push(marker);
    }
  });
}

function highlightMarker(index, highlight) {
  if (placeMarkers[index]) {
    const el = placeMarkers[index].getElement();
    if (el) {
      const dot = el.querySelector('.place-marker');
      if (dot) {
        dot.classList.toggle('highlight', highlight);
      }
    }
    if (highlight) {
      placeMarkers[index].openTooltip();
    } else {
      placeMarkers[index].closeTooltip();
    }
  }
}

function resolveCategory(types) {
  if (!types) return 'other';
  for (const t of types) {
    if (CATEGORY_MAP[t]) return CATEGORY_MAP[t];
  }
  return 'other';
}

function priceLevelText(level) {
  const map = {
    PRICE_LEVEL_FREE: 'Free',
    PRICE_LEVEL_INEXPENSIVE: '$',
    PRICE_LEVEL_MODERATE: '$$',
    PRICE_LEVEL_EXPENSIVE: '$$$',
    PRICE_LEVEL_VERY_EXPENSIVE: '$$$$'
  };
  return map[level] || '';
}

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const toRad = (deg) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

function clearPlaces() {
  document.getElementById('places-list').innerHTML = '';
  placeMarkers.forEach(m => map.removeLayer(m));
  placeMarkers = [];
}

function clearStoreMarkers() {
  storeMarkers.forEach(m => map.removeLayer(m));
  storeMarkers = [];
  if (anchorMarker) { map.removeLayer(anchorMarker); anchorMarker = null; }
  if (radiusCircle) { map.removeLayer(radiusCircle); radiusCircle = null; }
}

function showElement(id) {
  document.getElementById(id).classList.remove('hidden');
}

function hideElement(id) {
  document.getElementById(id).classList.add('hidden');
}

function showLoading() {
  showElement('loading-state');
  hideElement('places-list');
}

function hideLoading() {
  hideElement('loading-state');
  showElement('places-list');
}

// ===== City Autocomplete =====
async function fetchCitySuggestions(query) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&featuretype=city&addressdetails=1&limit=6&format=json`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    if (!res.ok) return;
    const results = await res.json();
    // Filter to places classified as city/town/village and de-dupe display names
    const seen = new Set();
    const cities = results
      .filter(r => ['city','town','village','municipality'].includes(r.addresstype) || r.type === 'city')
      .filter(r => {
        const key = (r.address?.city || r.address?.town || r.address?.village || r.name) + '|' + (r.address?.country || '');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 5);
    renderSuggestions(cities);
  } catch (_) {
    // Silently fail — autocomplete is a nice-to-have
  }
}

function renderSuggestions(cities) {
  const box = document.getElementById('city-suggestions');
  if (!cities.length) { hideSuggestions(); return; }

  box.innerHTML = '';
  cities.forEach(city => {
    const cityName = city.address?.city || city.address?.town || city.address?.village || city.name;
    const country  = city.address?.country || '';
    const state    = city.address?.state || city.address?.province || '';
    const subtitle = [state, country].filter(Boolean).join(', ');
    const display  = subtitle ? `${cityName} — ${subtitle}` : cityName;

    const item = document.createElement('div');
    item.className = 'city-suggestion-item';
    item.dataset.city = cityName;
    item.textContent = display;
    item.addEventListener('mousedown', (e) => {
      e.preventDefault(); // keep focus on input
      document.getElementById('city-input').value = cityName;
      hideSuggestions();
      searchCity(cityName);
    });
    box.appendChild(item);
  });

  box.classList.remove('hidden');
}

function hideSuggestions() {
  const box = document.getElementById('city-suggestions');
  box.classList.add('hidden');
  box.innerHTML = '';
  document.querySelectorAll('.city-suggestion-item').forEach(el => el.classList.remove('focused'));
}

function moveFocus(dir) {
  const items = [...document.querySelectorAll('.city-suggestion-item')];
  if (!items.length) return;
  const current = items.findIndex(el => el.classList.contains('focused'));
  items.forEach(el => el.classList.remove('focused'));
  let next = current + dir;
  if (next < 0) next = items.length - 1;
  if (next >= items.length) next = 0;
  items[next].classList.add('focused');
}

// Boot
init();
