export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured on server.' });
  }

  const { learnedExclude, learnedInclude } = req.body;
  const today = new Date().toLocaleDateString('en-AU', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  const excludeNote = learnedExclude && learnedExclude.length
    ? `Exclude: ${learnedExclude.join(', ')}.` : '';

  const includeNote = learnedInclude && learnedInclude.length
    ? `Prioritise: ${learnedInclude.join(', ')}.` : '';

  let debugInfo = null;

  try {

    // ── STEP 1: Search AFR only ───────────────────────────────────────────────
    const searchPrompt = `Today is ${today}. Search site:afr.com for Australian wealth news from the last 48 hours. ${excludeNote} ${includeNote}

Find up to 5 stories about: named individuals gaining wealth (share surge, IPO, property sale, donation, appointment with equity), open grant rounds, or corporate health sponsorships.

For each story found, write one line:
ITEM: [person name or "none"] | [org] | [event type] | [state] | [date] | [one sentence what happened]`;

    const searchResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: searchPrompt }]
      })
    });

    if (!searchResp.ok) {
      const err = await searchResp.json();
      return res.status(searchResp.status).json({ error: err.error?.message || 'Search failed' });
    }

    const searchData = await searchResp.json();
    const searchText = searchData.content
      .map(b => b.type === 'text' ? b.text : '')
      .filter(Boolean)
      .join('\n');

    debugInfo = 'Step 1 raw: ' + searchText.slice(0, 300);

    if (!searchText || searchText.trim().length < 10) {
      return res.status(200).json({ events: [], scannedAt: new Date().toISOString(), debugInfo: 'Search returned nothing' });
    }

    // ── STEP 2: Format as JSON using Haiku (no web search, cheap) ─────────────
    const formatPrompt = `Convert this research summary into a JSON array. Today: ${today}.

${searchText.slice(0, 1500)}

Return ONLY a JSON array, no other text:
[{"id":1,"type":"Individual Wealth","subtype":"Net Worth Milestone","title":"Short headline","source":"AFR","url":"","publishedDate":"3 May 2025","body":"Two plain English sentences.","individuals":["Full Name"],"orgs":["Org"],"state":"NSW","relevance":"Why this matters to children's hospital fundraising.","deadline":"","paywalled":true}]

Types: Individual Wealth, IPO, Acquisition, Donation, Grant, Real Estate, Appointment, Sponsorship
Individual Wealth subtypes: Net Worth Milestone, Liquidity Event, Dividend Windfall, Philanthropic Signal, Inheritance, Corporate Gain, Property Gain
subtype is "" for non-Individual-Wealth types.
individuals must have real named people — empty [] only for Grant or Sponsorship.
Return [] if no valid events.`;

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
        messages: [{ role: 'user', content: formatPrompt }]
      })
    });

    if (!formatResp.ok) {
      const err = await formatResp.json();
      return res.status(formatResp.status).json({ error: err.error?.message || 'Format step failed' });
    }

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
        debugInfo = 'No JSON found. Step2 raw: ' + formatText.slice(0, 200);
      }
      events = events.filter(e =>
        ['Grant', 'Sponsorship'].includes(e.type) ||
        (e.individuals && e.individuals.length > 0 && e.individuals[0].trim() !== '')
      );
    } catch (parseErr) {
      debugInfo = 'Parse error: ' + parseErr.message + ' | ' + formatText.slice(0, 150);
      events = [];
    }

    return res.status(200).json({ events, scannedAt: new Date().toISOString(), debugInfo });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
