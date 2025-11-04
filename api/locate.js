module.exports = async (req, res) => {
  try {
    const upstream = 'https://locate.measurementlab.net/v2/nearest/ndt/ndt7';
    const r = await fetch(upstream, {
      headers: { 'accept': 'application/json' },
      cache: 'no-store'
    });
    const body = await r.text();
    res.setHeader('Content-Type', 'application/json');
    // Cache at the edge for 10 minutes to avoid 429 from frequent requests
    res.setHeader('Cache-Control', 'public, s-maxage=600, max-age=0');
    res.status(r.status).send(body);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
