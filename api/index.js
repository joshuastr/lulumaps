const API_KEY = process.env.GOOGLE_PLACES_API_KEY;

// Simple in-memory cache
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { data, time: Date.now() });
}

function json(res, status, data) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.statusCode = status;
  res.end(JSON.stringify(data));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (!API_KEY) {
    return json(res, 500, { error: 'API key not configured' });
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname.replace('/api/', '').replace('/api', '');

  try {
    if (path === 'stores') {
      const city = url.searchParams.get('city');
      if (!city) return json(res, 400, { error: 'city parameter required' });

      const cacheKey = `stores:${city.toLowerCase()}`;
      const cached = getCached(cacheKey);
      if (cached) return json(res, 200, cached);

      const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': API_KEY,
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.id'
        },
        body: JSON.stringify({ textQuery: `Lululemon in ${city}`, maxResultCount: 10 })
      });

      if (!response.ok) return json(res, 502, { error: 'Failed to fetch stores' });

      const data = await response.json();
      const stores = (data.places || []).map(p => ({
        id: p.id,
        name: p.displayName?.text || 'Lululemon',
        address: p.formattedAddress || '',
        lat: p.location?.latitude,
        lng: p.location?.longitude
      }));

      setCache(cacheKey, stores);
      return json(res, 200, stores);

    } else if (path === 'nearby') {
      const lat = url.searchParams.get('lat');
      const lng = url.searchParams.get('lng');
      const type = url.searchParams.get('type');
      const radius = Number(url.searchParams.get('radius')) || 800;

      if (!lat || !lng) return json(res, 400, { error: 'lat and lng required' });

      const categoryTypes = {
        food: ['restaurant', 'bakery'],
        coffee: ['cafe'],
        drinks: ['bar', 'night_club'],
        shopping: ['clothing_store', 'shoe_store', 'book_store', 'store'],
        wellness: ['gym', 'spa'],
        culture: ['museum', 'art_gallery', 'library']
      };

      const includedTypes = type && categoryTypes[type] ? categoryTypes[type] : Object.values(categoryTypes).flat();

      const cacheKey = `nearby:${lat},${lng},${radius},${type || 'all'}`;
      const cached = getCached(cacheKey);
      if (cached) return json(res, 200, cached);

      const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': API_KEY,
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.id,places.rating,places.userRatingCount,places.priceLevel,places.types,places.photos,places.primaryType,places.primaryTypeDisplayName,places.businessStatus,places.websiteUri'
        },
        body: JSON.stringify({
          includedTypes,
          maxResultCount: 20,
          locationRestriction: {
            circle: {
              center: { latitude: Number(lat), longitude: Number(lng) },
              radius
            }
          },
          rankPreference: 'POPULARITY'
        })
      });

      if (!response.ok) return json(res, 502, { error: 'Failed to fetch nearby places' });

      const data = await response.json();
      const places = (data.places || []).map(p => ({
        id: p.id,
        name: p.displayName?.text || '',
        address: p.formattedAddress || '',
        lat: p.location?.latitude,
        lng: p.location?.longitude,
        rating: p.rating || null,
        ratingCount: p.userRatingCount || 0,
        priceLevel: p.priceLevel || null,
        types: p.types || [],
        primaryType: p.primaryTypeDisplayName?.text || p.primaryType || '',
        website: p.websiteUri || null,
        photoRef: p.photos?.[0]?.name || null,
        status: p.businessStatus || 'OPERATIONAL'
      }));

      setCache(cacheKey, places);
      return json(res, 200, places);

    } else if (path === 'photo') {
      const name = url.searchParams.get('name');
      if (!name) return json(res, 400, { error: 'name parameter required' });

      const photoUrl = `https://places.googleapis.com/v1/${name}/media?maxWidthPx=400&key=${API_KEY}`;
      const response = await fetch(photoUrl, { redirect: 'follow' });

      if (!response.ok) return json(res, 502, { error: 'Failed to fetch photo' });

      const contentType = response.headers.get('content-type') || 'image/jpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');

      const buffer = Buffer.from(await response.arrayBuffer());
      res.end(buffer);

    } else {
      return json(res, 404, { error: 'Not found' });
    }
  } catch (err) {
    console.error('API error:', err.message);
    return json(res, 500, { error: 'Internal server error' });
  }
}
