export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured on server.' });
  }

  const { topics, learnedExclude, learnedInclude } = req.body;
  const today = new Date().toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  const excludeNote = learnedExclude && learnedExclude.length
    ? `Do NOT include events of these types (team has marked them not relevant): ${learnedExclude.join(', ')}.`
    : '';

  const includeNote = learnedInclude && learnedInclude.length
    ? `Prioritise these event types (team has marked them highly relevant): ${learnedInclude.join(', ')}.`
    : '';

  const prompt = `You are Fortuna, a prospect research assistant for a non-profit organisation that raises funds for children's hospitals in Australia.

Today is ${today}. Search Australian news sources published in the last 48 hours only.

Search these sources: Australian Financial Review (AFR), Sydney Morning Herald, Daily Telegraph, The Australian, ABC News, 9News, News.com.au, The Guardian Australia, Sky News Australia, Forbes Australia, Pro Bono Australia, Broker Daily, Financial Newswire, Market Index, Herald Sun, Brisbane Times, The West Australian, realestate.com.au, Domain, NT News.

Look for wealth events anywhere in Australia relevant to prospect research for a children's hospital non-profit. The organisation has connections with high net worth individuals in Sydney (NSW), Perth (WA), and Canberra (ACT).

Topics to scan for: ${topics && topics.length ? topics.join(', ') : 'IPO, ASX listing, acquisition, major donation, philanthropy, real estate sale, executive appointment, board appointment, grant, sponsorship, partnership, inheritance, estate, business sale'}.

${excludeNote}
${includeNote}

A wealth event is any news story that signals:
- A person or family has gained, or is about to gain, significant wealth (IPO, acquisition, property sale, business exit, inheritance)
- A person or organisation has made or announced a major donation or philanthropic commitment
- A new grant or funding round has opened that a children's hospital non-profit could apply for
- A company has announced a new sponsorship or community partnership relevant to health or children
- A senior executive appointment that creates new wealth accumulation potential

For each wealth event found, return a JSON array. Each object must have exactly these fields:
- id: unique number
- type: one of "IPO", "Acquisition", "Donation", "Grant", "Real Estate", "Appointment", "Sponsorship", "Inheritance", "Business Sale"
- title: short clear headline (max 15 words)
- source: name of the publication
- url: direct URL to the article if available, otherwise ""
- publishedDate: date the article was published (e.g. "3 May 2025"), or "Date unknown"
- body: plain English 2-sentence summary anyone can understand in 2 minutes. No jargon.
- individuals: array of full names of people mentioned
- orgs: array of organisation names mentioned
- state: Australian state or territory (e.g. "NSW", "WA", "VIC", "National")
- relevance: one sentence explaining why this matters to a children's hospital fundraising team
- deadline: grant application deadline if applicable, otherwise ""
- paywalled: true if the source is behind a paywall (AFR, The Australian, Herald Sun), false otherwise

Return ONLY a valid JSON array. No preamble, no explanation, no markdown. If no events are found, return an empty array [].`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.error?.message || 'Anthropic API error' });
    }

    const data = await response.json();

    // Extract text from all content blocks
    const fullText = data.content
      .map(block => block.type === 'text' ? block.text : '')
      .filter(Boolean)
      .join('\n');

    // Parse JSON from response
    let events = [];
    try {
      const cleaned = fullText.replace(/```json|```/g, '').trim();
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) events = JSON.parse(match[0]);
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr);
      events = [];
    }

    return res.status(200).json({ events, scannedAt: new Date().toISOString() });

  } catch (err) {
    console.error('Scan error:', err);
    return res.status(500).json({ error: err.message });
  }
}
