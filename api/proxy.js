const GAS_URL = 'https://script.google.com/macros/s/AKfycbz2-ESGyJtgXf47sav2RGfyCHkqb67TOcqdIoCidt5mQj3oKPuk4lhh2apwzHs7fjkD3A/exec';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    let action, data;
    if (req.method === 'POST') {
      // Vercel auto-parses JSON, but just in case it's a string
      let body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      action = body?.action;
      data = body?.data;
    } else {
      action = req.query?.action;
      data = req.query?.data ? JSON.parse(req.query.data) : null;
    }

    if (!action) {
      return res.status(200).json({ success: false, error: 'Acción no especificada.' });
    }

    let response;
    
    // ENVIAR POST DIRECTO A GOOGLE APPS SCRIPT
    if (req.method === 'POST') {
      response = await fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, data }),
        redirect: 'follow'
      });
    } else {
      // READ ONLY GET
      const params = new URLSearchParams({ action });
      if (data) params.append('data', JSON.stringify(data));
      response = await fetch(`${GAS_URL}?${params.toString()}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        redirect: 'follow'
      });
    }

    const text = await response.text();

    if (!response.ok) {
      return res.status(200).json({ success: false, error: `Error de red GAS ${response.status}: ${text.substring(0,200)}` });
    }

    try {
      const json = JSON.parse(text);
      return res.status(200).json(json);
    } catch (e) {
      return res.status(200).json({ success: false, error: `Respuesta inválida (no-JSON): ${text.substring(0,200)}` });
    }

  } catch (err) {
    return res.status(200).json({ success: false, error: 'Error interno del proxy: ' + err.message });
  }
};
