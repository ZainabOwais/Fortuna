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
    ? `Exclude types: ${learnedExclude.join(', ')}.` : '';

  const includeNote = learnedInclude && learnedInclude.length
    ? `Prioritise: ${learnedInclude.join(', ')}.` : '';

  let debugInfo = null;

  try {

    // ── STEP 1: Search the web for wealth events ─────────────────────────────
    const searchPrompt = `Today is ${today}. You are helping an Australian children's hospital non-profit find prospect research leads.

Search Australian news from the last 48 hours for wealth events involving NAMED INDIVIDUALS. Use web search to find real recent articles.

Search for:
1. Australian Rich List or net worth milestones (named person)
2. ASX share price surges benefiting named shareholders or founders
3. Major philanthropic donations by named Australians
4. Luxury property sales by named Australians
5. IPO or business sale proceeds going to named founders
6. Senior executive appointments with equity (named person)
7. Open grant rounds for children's health nonprofits
8. Corporate sponsorships of children's health causes

${excludeNote} ${includeNote}

After searching, summarise what you found as a plain list. For each item write:
ITEM: [type] | [person name if any] | [organisation] | [state] | [source] | [date] | [one sentence summary] | [paywalled yes/no]`;

    const searchResp = await fetch('https://api.anthropic.com/v1/messages', {
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
        messages: [{ role: 'user', content: searchPrompt }]
      })
    });

    if (!searchResp.ok) {
      const err = await searchResp.json();
      return res.status(searchResp.status).json({ error: err.error?.message || 'Search step failed' });
    }

    const searchData = await searchResp.json();
    const searchText = searchData.content
      .map(block => block.type === 'text' ? block.text : '')
      .filter(Boolean)
      .join('\n');

    if (!searchText || searchText.trim().length < 20) {
      return res.status(200).json({ events: [], scannedAt: new Date().toISOString(), debugInfo: 'Search returned empty response' });
    }

    // ── STEP 2: Format results as clean JSON ──────────────────────────────────
    const formatPrompt = `Convert this prospect research summary into a JSON array. Today is ${today}.

Research summary:
${searchText.slice(0, 3000)}

Return ONLY a valid JSON array (no markdown, no explanation):
[{"id":1,"type":"Individual Wealth","subtype":"Net Worth Milestone","title":"Short headline","source":"AFR","url":"","publishedDate":"3 May 2025","body":"Two plain English sentences.","individuals":["Full Name"],"orgs":["Org"],"state":"NSW","relevance":"Why this matters to children's hospital fundraising.","deadline":"","paywalled":true}]

Rules:
- type must be one of: Individual Wealth, IPO, Acquisition, Donation, Grant, Real Estate, Appointment, Sponsorship
- subtype only for Individual Wealth: Net Worth Milestone, Liquidity Event, Dividend Windfall, Philanthropic Signal, Inheritance, Corporate Gain, Property Gain — otherwise use ""
- individuals must be an array of real named people — leave empty [] only for Grant or Sponsorship types
- Exclude any event with no named individual unless it is a Grant or Sponsorship
- Return [] if no valid events found`;

    const formatResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{ role: 'user', content: formatPrompt }]
      })
    });

    if (!formatResp.ok) {
      const err = await formatResp.json();
      return res.status(formatResp.status).json({ error: err.error?.message || 'Format step failed' });
    }

    const formatData = await formatResp.json();
    const formatText = formatData.content
      .map(block => block.type === 'text' ? block.text : '')
      .filter(Boolean)
      .join('\n');

    let events = [];
    try {
      const cleaned = formatText.replace(/```json|```/g, '').trim();
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) {
        events = JSON.parse(match[0]);
      } else {
        debugInfo = 'Format step returned no JSON. Raw: ' + formatText.slice(0, 300);
      }
      // Enforce individuals rule server-side
      events = events.filter(e =>
        ['Grant', 'Sponsorship'].includes(e.type) ||
        (e.individuals && e.individuals.length > 0 && e.individuals[0].trim() !== '')
      );
    } catch (parseErr) {
      debugInfo = 'Parse error: ' + parseErr.message + ' | Raw: ' + formatText.slice(0, 200);
      events = [];
    }

    return res.status(200).json({ events, scannedAt: new Date().toISOString(), debugInfo });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
