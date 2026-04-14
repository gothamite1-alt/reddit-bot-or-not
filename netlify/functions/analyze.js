const { getStore } = require('@netlify/blobs');

const DAILY_FREE_LIMIT = 1;
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-pro-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function getTodayKey(ip) {
  const today = new Date().toISOString().slice(0, 10);
  return `${ip}_${today}`;
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const ip = event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || event.headers['client-ip']
    || 'unknown';

  const isPro = event.headers['x-pro-token'] === process.env.PRO_SECRET;

  let store;
  let currentCount = 0;
  let blobsAvailable = true;

  try {
    store = getStore({ name: 'usage', consistency: 'strong' });
    const stored = await store.get(getTodayKey(ip), { type: 'json' });
    currentCount = (stored && stored.count) || 0;
  } catch (err) {
    console.error('Blobs read error:', err.message);
    blobsAvailable = false;
  }

  if (!isPro && currentCount >= DAILY_FREE_LIMIT) {
    return {
      statusCode: 429,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'LIMIT_REACHED', remaining: 0 })
    };
  }

  try {
    const { text } = JSON.parse(event.body);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{ role: 'user', content: `Analyze this Reddit post for AI vs human writing. Respond ONLY with JSON: {"verdict":"AI"|"HUMAN"|"MIXED","confidence":0-100,"signals":[{"type":"red"|"green"|"yellow","text":"signal"}],"summary":"analysis"}\n\n${text.slice(0,2000)}` }]
      })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    const raw = data.content.map(b => b.text || '').join('');
    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch (parseErr) {
      throw new Error('Failed to parse AI response. Please try again.');
    }

    if (!isPro && blobsAvailable && store) {
      try {
        await store.setJSON(getTodayKey(ip), { count: currentCount + 1 });
      } catch (err) {
        console.error('Blobs write error:', err.message);
      }
    }
    const remaining = isPro ? 999 : DAILY_FREE_LIMIT - (currentCount + 1);

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...parsed, remaining })
    };

  } catch (err) {
    console.error('Error:', err.message);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message })
    };
  }
};
