const API_KEY = process.env.GOOGLE_PLACES_API_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (!API_KEY) return res.status(500).json({ error: 'API key not configured' });

  const { name } = req.query;
  if (!name || typeof name !== 'string' || !name.startsWith('places/')) {
    return res.status(400).json({ error: 'Invalid photo name' });
  }

  try {
    const photoUrl = `https://places.googleapis.com/v1/${name}/media?maxWidthPx=400&key=${API_KEY}`;
    const response = await fetch(photoUrl, { redirect: 'follow' });

    if (!response.ok) return res.status(502).json({ error: 'Failed to fetch photo' });

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');

    const buffer = Buffer.from(await response.arrayBuffer());
    res.end(buffer);
  } catch (err) {
    console.error('Photo error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
