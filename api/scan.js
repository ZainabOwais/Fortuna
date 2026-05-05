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
            content: `You are a research assistant. Search the web using these exact queries one at a time and report what you find:

Query 1: "Australian Financial Review" business news ${today}
Query 2: "Sydney Morning Herald" business news ${today}
Query 3: Australia billionaire donation philanthropy May 2026

For each article or story you find in the search results, output one line:
HEADLINE: [headline] | SOURCE: [publication name] | DATE: [date] | SUMMARY: [one sentence]

List every result you find. Do not explain or apologise — just list the headlines.`
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

    debugInfo = fullText.slice(0, 800);

    // Step 2 — Haiku formats whatever was found into event cards
    const formatResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `Convert these news headlines into a JSON array. Include ALL stories listed — do not filter any out.

${fullText.slice(0, 2000)}

Return ONLY a JSON array:
[{"id":1,"type":"News","subtype":"","title":"headline","source":"publication","url":"","publishedDate":"${today}","body":"one sentence summary","individuals":[],"orgs":[],"state":"National","relevance":"","deadline":"","paywalled":false}]

Return [] only if there are truly no headlines above.`
        }]
      })
    });

    const formatData = await formatResp.json();
    const formatText = formatData.content
      .map(b => b.type === 'text' ? b.text : '')
      .filter(Boolean)
      .join('\n');

    let events = [];
    try {
      const cleaned = formatText.replace(/```json|```/g, '').trim();
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) {
        events = JSON.parse(match[0]);
      } else {
        debugInfo += ' | Step2 no JSON: ' + formatText.slice(0, 200);
      }
    } catch (e) {
      debugInfo += ' | Parse error: ' + e.message;
    }

    return res.status(200).json({ events, scannedAt: new Date().toISOString(), debugInfo });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
