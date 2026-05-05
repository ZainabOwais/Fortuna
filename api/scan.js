export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured on server.' });
  }

  const { topics, learnedExclude, learnedInclude } = req.body;
  const today = new Date().toLocaleDateString('en-AU', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  const topicList = topics && topics.length
    ? topics.slice(0, 6).join(', ')
    : 'IPO, acquisition, donation, grant, property sale, executive appointment, sponsorship';

  const excludeNote = learnedExclude && learnedExclude.length
    ? `Skip types: ${learnedExclude.join(', ')}.` : '';

  const includeNote = learnedInclude && learnedInclude.length
    ? `Prioritise: ${learnedInclude.join(', ')}.` : '';

  const prompt = `You are a prospect researcher for an Australian children's hospital non-profit. Today is ${today}.

Search Australian news (AFR, SMH, The Australian, ABC News, 9News, Daily Telegraph, Guardian Australia, Pro Bono Australia, Herald Sun, West Australian) from the last 48 hours.

Find up to 8 wealth events relevant to children's hospital fundraising. Topics: ${topicList}. ${excludeNote} ${includeNote}

Wealth events include: IPO, acquisition, major donation, philanthropy pledge, luxury property sale, senior executive appointment, open grant round, corporate sponsorship of health/children causes.

Return ONLY a JSON array, no other text:
[{"id":1,"type":"Donation","title":"Short headline","source":"AFR","url":"","publishedDate":"3 May 2025","body":"Two plain English sentences.","individuals":["Full Name"],"orgs":["Org Name"],"state":"NSW","relevance":"Why this matters to children's hospital fundraising.","deadline":"","paywalled":false}]

Return [] if nothing found.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.error?.message || 'Anthropic API error' });
    }

    const data = await response.json();

    const fullText = data.content
      .map(block => block.type === 'text' ? block.text : '')
      .filter(Boolean)
      .join('\n');

    let events = [];
    try {
      const cleaned = fullText.replace(/```json|```/g, '').trim();
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) events = JSON.parse(match[0]);
    } catch (e) {
      events = [];
    }

    return res.status(200).json({ events, scannedAt: new Date().toISOString() });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
