const GAS_URL = 'https://script.google.com/macros/s/AKfycby-ariRLp968_JDkJaZmhRDkOcWsDQAPq3wiFjsKoi9su3vduwg_cTYYSm8CEjc5zzZLA/exec';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Accept both GET (query params) and POST (json body)
    let action, data;
    if (req.method === 'POST') {
      action = req.body?.action;
      data = req.body?.data;
    } else {
      action = req.query?.action;
      data = req.query?.data ? JSON.parse(req.query.data) : null;
    }

    if (!action) {
      return res.status(400).json({ success: false, error: 'Missing action parameter' });
    }

    // Always call GAS via GET with query params
    const params = new URLSearchParams({ action });
    if (data) params.append('data', JSON.stringify(data));

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
