const GAS_URL = 'https://script.google.com/macros/s/AKfycbyVxR8YKoo4sUHRlrh0TvVZiBDnZ-TfdoQ6uaP2-yJVnbPCCehlwvTh64-YNyRzjaXcsw/exec';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { action, data } = req.query;
    if (!action) {
      return res.status(400).json({ success: false, error: 'Missing action parameter' });
    }

    const params = new URLSearchParams({ action });
    if (data) params.append('data', data);

    const gasUrl = `${GAS_URL}?${params.toString()}`;

    const response = await fetch(gasUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Vercel-Proxy)',
        'Accept': 'application/json'
      }
    });

    const text = await response.text();

    if (!response.ok) {
      return res.status(200).json({
        success: false,
        error: `GAS HTTP ${response.status}: ${text.slice(0, 300)}`
      });
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch (parseErr) {
      return res.status(200).json({
        success: false,
        error: `GAS returned non-JSON: ${text.slice(0, 300)}`
      });
    }

    return res.status(200).json(json);

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(200).json({ success: false, error: 'Proxy fetch error: ' + err.message });
  }
};
