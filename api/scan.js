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

  const excludeNote = learnedExclude && learnedExclude.length
    ? `Skip these types: ${learnedExclude.join(', ')}.` : '';

  const includeNote = learnedInclude && learnedInclude.length
    ? `Prioritise these types: ${learnedInclude.join(', ')}.` : '';

  const topicList = topics && topics.length
    ? topics.slice(0, 8).join(', ')
    : 'IPO, acquisition, donation, grant, property sale, executive appointment, sponsorship, net worth milestone, Rich List, dividend, inheritance';

  const prompt = `Prospect researcher for Australian children's hospital non-profit. Today: ${today}. ${excludeNote} ${includeNote}

Search Australian news last 48hrs (AFR, SMH, ABC, 9News, Herald Sun, Guardian AU, Pro Bono AU) for up to 6 wealth events. Focus on NAMED INDIVIDUALS. Skip events with no named person unless type is Grant or Sponsorship.

Signals: share price surge, Rich List mention, IPO proceeds, donation/pledge, luxury property sale, senior appointment with equity, dividend windfall, inheritance, grant round opening, corporate health sponsorship.

Return ONLY JSON array:
[{"id":1,"type":"Individual Wealth","subtype":"Net Worth Milestone","title":"headline","source":"AFR","url":"","publishedDate":"3 May 2025","body":"2 sentences.","individuals":["Name"],"orgs":["Org"],"state":"NSW","relevance":"1 sentence.","deadline":"","paywalled":true}]

Types: Individual Wealth|IPO|Acquisition|Donation|Grant|Real Estate|Appointment|Sponsorship
Individual Wealth subtypes: Net Worth Milestone|Liquidity Event|Dividend Windfall|Philanthropic Signal|Inheritance|Corporate Gain|Property Gain
Return [] if nothing found.`;

  let debugInfo = null;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2000,
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
      if (match) {
        events = JSON.parse(match[0]);
      } else {
        debugInfo = 'No JSON array found in response. Raw: ' + fullText.slice(0, 400);
      }
      // Enforce: non-grant/sponsor events must have named individuals
      events = events.filter(e =>
        ['Grant', 'Sponsorship'].includes(e.type) ||
        (e.individuals && e.individuals.length > 0 && e.individuals[0] !== '')
      );
    } catch (parseErr) {
      debugInfo = 'JSON parse error: ' + parseErr.message + ' | Raw: ' + fullText.slice(0, 300);
      events = [];
    }

    return res.status(200).json({ events, scannedAt: new Date().toISOString(), debugInfo });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
