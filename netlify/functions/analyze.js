const { getStore } = require('@netlify/blobs');

const DAILY_FREE_LIMIT = 3;

function getTodayKey(ip) {
  const today = new Date().toISOString().slice(0, 10);
  return `usage_${ip}_${today}`;
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const ip = event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || event.headers['client-ip']
    || 'unknown';

  const isPro = event.headers['x-pro-token'] === process.env.PRO_SECRET;

  let currentCount = 0;

  if (!isPro) {
    try {
      const store = getStore('usage');
      const key = getTodayKey(ip);
      const val = await store.get(key);
      currentCount = val ? parseInt(val) : 0;

      if (currentCount >= DAILY_FREE_LIMIT) {
        return {
          statusCode: 429,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: 'LIMIT_REACHED', remaining: 0 })
        };
      }
    } catch (e) {
      console.error('Blob read error:', e.message);
      // fail open — let them through if blob store errors
    }
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
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());

    // Increment usage in blob store
    if (!isPro) {
      try {
        const store = getStore('usage');
        const key = getTodayKey(ip);
        await store.set(key, String(currentCount + 1));
      } catch (e) {
        console.error('Blob write error:', e.message);
      }
    }

    const remaining = isPro ? 999 : DAILY_FREE_LIMIT - (currentCount + 1);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ...parsed, remaining })
    };

  } catch (err) {
    console.error('Error:', err.message);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
