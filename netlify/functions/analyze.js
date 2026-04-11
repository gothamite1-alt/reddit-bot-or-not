exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { text } = JSON.parse(event.body);

    const prompt = `You are an expert at detecting AI-generated text trained on Reddit posting styles. Analyze this Reddit post/comment.

"""
${text.slice(0, 2000)}
"""

Respond ONLY with valid JSON, no markdown, no preamble:
{
  "verdict": "AI" | "HUMAN" | "MIXED",
  "confidence": <integer 0-100>,
  "signals": [
    { "type": "red" | "green" | "yellow", "text": "<specific signal, max 15 words>" }
  ],
  "summary": "<2-3 sentences explaining your reasoning>"
}

verdict: AI=likely AI-generated, HUMAN=likely human, MIXED=uncertain
confidence: certainty in your verdict
signals: 3-5 specific textual tells. red=AI indicator, green=human indicator, yellow=ambiguous
Analyze: hedging language, generic transitions, over-structured prose, lack of typos/slang, emotional authenticity, specific personal details, Reddit voice, casual markers.`;

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
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    const raw = data.content.map(b => b.text || '').join('');
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(parsed)
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
