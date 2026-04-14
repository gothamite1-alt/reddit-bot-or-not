const { getStore } = require('@netlify/blobs');

const DAILY_FREE_LIMIT = 1;

function getTodayKey(ip) {
  const today = new Date().toISOString().slice(0, 10);
  return `${ip}_${today}`;
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const ip = event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || event.headers['client-ip']
    || 'unknown';

  try {
    const key = getTodayKey(ip);
    const store = getStore({ name: 'usage', consistency: 'strong' });
    const stored = await store.get(key, { type: 'json' });
    const currentCount = (stored && stored.count) || 0;
    const remaining = Math.max(0, DAILY_FREE_LIMIT - currentCount);

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ remaining })
    };
  } catch (err) {
    console.error('Blobs error:', err.message);
    // Deny by default: if we can't read usage, report 0 remaining
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ remaining: 0 })
    };
  }
};
