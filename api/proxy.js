const GAS_URL = 'https://script.google.com/macros/s/AKfycbzL0zXoTughmH9QmlawlwFTU2b8EIbfpySlxXafZ9Tr2bfaPkeV4ZDblClOqb0n2f3XUw/exec';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    let action, data;

    // Accept POST (JSON body) or GET (query params) from browser
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      action = body?.action;
      data = body?.data;
    } else {
      action = req.query?.action;
      data = req.query?.data ? JSON.parse(req.query.data) : null;
    }

    if (!action) {
      return res.status(200).json({ success: false, error: 'Acción no especificada.' });
    }

    // ALWAYS call GAS via GET — GAS doPost has redirect issues (returns HTML login page)
    const params = new URLSearchParams({ action });
    if (data !== null && data !== undefined) {
      params.append('data', JSON.stringify(data));
    }

    const gasUrl = `${GAS_URL}?${params.toString()}`;

    const response = await fetch(gasUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'Accept': 'application/json' }
    });

    const text = await response.text();

    // Detect HTML response (login redirect from Google)
    if (text.trim().startsWith('<')) {
      return res.status(200).json({
        success: false,
        error: 'GAS devolvió HTML en lugar de JSON. Verifica que el script esté publicado para "Cualquier usuario" (Anyone).'
      });
    }

    try {
      const json = JSON.parse(text);
      return res.status(200).json(json);
    } catch (e) {
      return res.status(200).json({ success: false, error: 'Respuesta no-JSON: ' + text.substring(0, 200) });
    }

  } catch (err) {
    return res.status(200).json({ success: false, error: 'Error proxy: ' + err.message });
  }
};
