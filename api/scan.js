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

  const prompt = `You are a prospect researcher for an Australian children's hospital non-profit. Today is ${today}.

YOUR PRIMARY FOCUS IS NAMED INDIVIDUALS — not companies. Every event you return must feature at least one real, named person. Events with no named individual must be excluded entirely.

Search Australian news published in the last 48 hours from: AFR, SMH, The Australian, ABC News, 9News, Daily Telegraph, Guardian Australia, Pro Bono Australia, Herald Sun, West Australian, Forbes Australia.

Look for these individual-focused wealth signals:
- Named individuals whose shareholding or net worth has surged (e.g. share price spike, Rich List update, net worth milestone)
- Founders or executives receiving IPO or merger proceeds
- Named individuals making philanthropic donations or pledges (signals wealth AND giving intent)
- Named individuals buying or selling luxury/prestige property
- Named individuals receiving dividends, bonuses or carried interest windfalls
- Named individuals mentioned in inheritance or estate news
- Named executives gaining equity through appointments or board roles
- Open grant rounds a children's hospital non-profit could apply for (no individual needed for Grant type only)
- Corporate sponsorships of health or children's causes (no individual needed for Sponsorship type only)

${excludeNote} ${includeNote}
Topics of interest: ${topicList}

RULES:
- The "individuals" array must never be empty EXCEPT for Grant or Sponsorship type events
- Only include events from the last 48 hours
- Return up to 10 events
- For "Individual Wealth" type events, choose the most accurate subtype from: "Net Worth Milestone", "Liquidity Event", "Dividend Windfall", "Philanthropic Signal", "Inheritance", "Corporate Gain", "Property Gain"

Return ONLY a valid JSON array, no other text:
[{"id":1,"type":"Individual Wealth","subtype":"Net Worth Milestone","title":"Short headline max 12 words","source":"AFR","url":"","publishedDate":"3 May 2025","body":"Two plain English sentences about the individual and what happened.","individuals":["Full Name"],"orgs":["Org Name"],"state":"NSW","relevance":"One sentence on why this matters to children's hospital fundraising.","deadline":"","paywalled":true}]

Valid types: "Individual Wealth", "IPO", "Acquisition", "Donation", "Grant", "Real Estate", "Appointment", "Sponsorship"
For non-Individual-Wealth types, "subtype" should be "".
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
        model: 'claude-sonnet-4-5-20250929',
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
      // Enforce: non-grant/sponsor events must have named individuals
      events = events.filter(e =>
        ['Grant', 'Sponsorship'].includes(e.type) ||
        (e.individuals && e.individuals.length > 0 && e.individuals[0] !== '')
      );
    } catch (e) {
      events = [];
    }

    return res.status(200).json({ events, scannedAt: new Date().toISOString(), debugInfo });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
