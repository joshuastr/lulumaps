const API_KEY = process.env.GOOGLE_PLACES_API_KEY;

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > CACHE_TTL) { cache.delete(key); return null; }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { data, time: Date.now() });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (!API_KEY) return res.status(500).json({ error: 'API key not configured' });

  const { city } = req.query;
  if (!city || typeof city !== 'string' || city.length > 100) {
    return res.status(400).json({ error: 'city parameter required' });
  }

  const cacheKey = `stores:${city.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return res.status(200).json(cached);

  try {
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.id'
      },
      body: JSON.stringify({ textQuery: `Lululemon in ${city}`, maxResultCount: 10 })
    });

    if (!response.ok) return res.status(502).json({ error: 'Failed to fetch stores' });

    const data = await response.json();
    const stores = (data.places || []).map(p => ({
      id: p.id,
      name: p.displayName?.text || 'Lululemon',
      address: p.formattedAddress || '',
      lat: p.location?.latitude,
      lng: p.location?.longitude
    }));

    setCache(cacheKey, stores);
    return res.status(200).json(stores);
  } catch (err) {
    console.error('Stores error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
