export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured on server.' });
  }

  const today = new Date().toLocaleDateString('en-AU', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  let debugInfo = null;

  try {

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1500,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [
          {
            role: 'user',
            content: `Search the web for "AFR news today ${today}" and list every article headline and summary you find. Return results as a JSON array like this:

[{"title":"Article headline","source":"AFR","publishedDate":"${today}","body":"One sentence summary.","url":"article url if found or empty string"}]

Return ONLY the JSON array, nothing else.`
          }
        ]
      })
    });

    if (!resp.ok) {
      const err = await resp.json();
      return res.status(resp.status).json({ error: err.error?.message || 'API error' });
    }

    const data = await resp.json();
    const fullText = data.content
      .map(b => b.type === 'text' ? b.text : '')
      .filter(Boolean)
      .join('\n');

    debugInfo = 'Raw: ' + fullText.slice(0, 500);

    let events = [];
    try {
      const cleaned = fullText.replace(/```json|```/g, '').trim();
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) {
        const articles = JSON.parse(match[0]);
        // Map raw articles to Fortuna event format
        events = articles.map((a, i) => ({
          id: i + 1,
          type: 'News',
          subtype: '',
          title: a.title || 'Untitled',
          source: a.source || 'AFR',
          url: a.url || '',
          publishedDate: a.publishedDate || today,
          body: a.body || '',
          individuals: [],
          orgs: [],
          state: 'National',
          relevance: '',
          deadline: '',
          paywalled: true
        }));
      } else {
        debugInfo = 'No JSON array found. Raw: ' + fullText.slice(0, 400);
      }
    } catch (e) {
      debugInfo = 'Parse error: ' + e.message + ' | Raw: ' + fullText.slice(0, 300);
    }

    return res.status(200).json({ events, scannedAt: new Date().toISOString(), debugInfo });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
