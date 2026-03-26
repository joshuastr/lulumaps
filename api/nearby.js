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

  const { lat, lng, radius, type } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (isNaN(latNum) || isNaN(lngNum) || latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
    return res.status(400).json({ error: 'Invalid coordinates' });
  }

  const r = Math.min(Math.max(Number(radius) || 800, 100), 5000);

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
  if (cached) return res.status(200).json(cached);

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
            center: { latitude: latNum, longitude: lngNum },
            radius: r
          }
        },
        rankPreference: 'POPULARITY'
      })
    });

    if (!response.ok) return res.status(502).json({ error: 'Failed to fetch nearby places' });

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
    return res.status(200).json(places);
  } catch (err) {
    console.error('Nearby error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
