import express from 'express';
import cors from 'cors';
import { readFileSync } from 'fs';

// Load .env manually (no dotenv dependency)
try {
  const envFile = readFileSync('.env', 'utf8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const val = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch (e) {
  console.log('No .env file found, using environment variables directly');
}

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!API_KEY) {
  console.error('GOOGLE_PLACES_API_KEY is not set. Add it to .env');
  process.exit(1);
}

const app = express();
app.use(cors());

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

// Find Lululemon stores in a city
app.get('/api/stores', async (req, res) => {
  const { city } = req.query;
  if (!city) return res.status(400).json({ error: 'city parameter required' });

  const cacheKey = `stores:${city.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.id'
      },
      body: JSON.stringify({
        textQuery: `Lululemon in ${city}`,
        maxResultCount: 10
      })
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Places API error:', response.status, text);
      return res.status(502).json({ error: 'Failed to fetch stores' });
    }

    const data = await response.json();
    const stores = (data.places || []).map(p => ({
      id: p.id,
      name: p.displayName?.text || 'Lululemon',
      address: p.formattedAddress || '',
      lat: p.location?.latitude,
      lng: p.location?.longitude
    }));

    setCache(cacheKey, stores);
    res.json(stores);
  } catch (err) {
    console.error('Store search failed:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Find nearby places around a coordinate
app.get('/api/nearby', async (req, res) => {
  const { lat, lng, radius, type } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

  const r = Number(radius) || 800;
  const categoryTypes = {
    food: ['restaurant', 'bakery'],
    coffee: ['cafe'],
    drinks: ['bar', 'night_club'],
    shopping: ['clothing_store', 'shoe_store', 'book_store', 'store'],
    wellness: ['gym', 'spa'],
    culture: ['museum', 'art_gallery', 'library']
  };

  const includedTypes = type && categoryTypes[type] ? categoryTypes[type] : Object.values(categoryTypes).flat();

  const cacheKey = `nearby:${lat},${lng},${r},${type || 'all'}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
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
            radius: r
          }
        },
        rankPreference: 'POPULARITY'
      })
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Nearby search error:', response.status, text);
      return res.status(502).json({ error: 'Failed to fetch nearby places' });
    }

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
    res.json(places);
  } catch (err) {
    console.error('Nearby search failed:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Photo proxy
app.get('/api/photo', async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'name parameter required' });

  try {
    const url = `https://places.googleapis.com/v1/${name}/media?maxWidthPx=400&key=${API_KEY}`;
    const response = await fetch(url, { redirect: 'follow' });

    if (!response.ok) {
      return res.status(502).json({ error: 'Failed to fetch photo' });
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');

    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    console.error('Photo fetch failed:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Proxy server running on http://localhost:${PORT}`);
});
