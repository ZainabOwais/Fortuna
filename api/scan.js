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

  let debugInfo = null;

  try {
    // ── STEP 1: Fetch SMH RSS feeds (no AI, no tokens) ───────────────────────
    const RSS_FEEDS = [
      { url: 'https://www.smh.com.au/rss/feed.xml',     label: 'SMH' },
      { url: 'https://www.smh.com.au/rss/business.xml', label: 'SMH Business' },
    ];

    const allItems = [];

    for (const feed of RSS_FEEDS) {
      try {
        const rssResp = await fetch(feed.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Fortuna/1.0)',
            'Accept': 'application/rss+xml, application/xml, text/xml, */*'
          }
        });
        if (!rssResp.ok) continue;

        const xml = await rssResp.text();
        const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];

        for (const item of items) {
          const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                         item.match(/<title>(.*?)<\/title>/))?.[1]?.trim() || '';
          const link  = (item.match(/<link>(.*?)<\/link>/))?.[1]?.trim() ||
                         item.match(/<guid[^>]*>(.*?)<\/guid>/)?.[1]?.trim() || '';
          const desc  = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
                         item.match(/<description>(.*?)<\/description>/))?.[1]
                         ?.replace(/<[^>]+>/g, '')?.trim() || '';
          const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() || '';

          if (!title) continue;
          allItems.push({ title, link, desc, pubDate, source: feed.label });
        }
      } catch (e) { /* skip failed feed */ }
    }

    if (!allItems.length) {
      return res.status(200).json({ events: [], scannedAt: new Date().toISOString(), debugInfo: 'No RSS items fetched' });
    }

    // Deduplicate
    const seen = new Set();
    const unique = allItems.filter(i => {
      if (seen.has(i.title)) return false;
      seen.add(i.title); return true;
    });

    debugInfo = `Fetched ${unique.length} headlines from SMH RSS.`;

    // ── STEP 2: AI classifies headlines as wealth events ──────────────────────
    const excludeNote = learnedExclude && learnedExclude.length
      ? `Exclude types: ${learnedExclude.join(', ')}.` : '';
    const includeNote = learnedInclude && learnedInclude.length
      ? `Prioritise: ${learnedInclude.join(', ')}.` : '';

    // Send headlines as a compact list to Haiku
    const headlineList = unique.slice(0, 40).map((a, i) =>
      `${i + 1}. [${a.source}] ${a.title}${a.desc ? ' — ' + a.desc.slice(0, 100) : ''}`
    ).join('\n');

    const classifyPrompt = `You are a prospect researcher for an Australian children's hospital non-profit. Today: ${today}. ${excludeNote} ${includeNote}

Below are today's headlines from the Sydney Morning Herald. Identify ONLY the ones that are wealth events relevant to prospect research — i.e. they involve named individuals or organisations gaining wealth, making donations, receiving grants, completing acquisitions, property sales, executive appointments with equity, or sponsorships of health/children causes.

Ignore sport, politics, weather, lifestyle, international news unrelated to Australian wealth.

Headlines:
${headlineList}

For each relevant wealth event, return a JSON object. Return ONLY a JSON array, no other text:
[{
  "id": 1,
  "type": "Individual Wealth",
  "subtype": "Net Worth Milestone",
  "title": "short clear headline",
  "source": "SMH",
  "url": "",
  "publishedDate": "${today}",
  "body": "Two plain English sentences anyone can understand in 2 minutes.",
  "individuals": ["Full Name"],
  "orgs": ["Organisation Name"],
  "state": "NSW",
  "relevance": "One sentence — why this matters to children's hospital fundraising.",
  "deadline": "",
  "paywalled": false
}]

Valid types: Individual Wealth, IPO, Acquisition, Donation, Grant, Real Estate, Appointment, Sponsorship
Individual Wealth subtypes: Net Worth Milestone, Liquidity Event, Dividend Windfall, Philanthropic Signal, Inheritance, Corporate Gain, Property Gain
subtype is "" for all non-Individual-Wealth types.
individuals must be real named people — empty [] only for Grant or Sponsorship.
Return [] if no headlines are relevant wealth events.`;

    const classifyResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{ role: 'user', content: classifyPrompt }]
      })
    });

    if (!classifyResp.ok) {
      const err = await classifyResp.json();
      // If AI fails, fall back to showing raw headlines
      const rawEvents = unique.slice(0, 20).map((a, i) => ({
        id: i + 1, type: 'News', subtype: '',
        title: a.title, source: a.source, url: a.link,
        publishedDate: a.pubDate ? new Date(a.pubDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : today,
        body: a.desc ? a.desc.slice(0, 250) : '',
        individuals: [], orgs: [], state: 'National',
        relevance: '', deadline: '', paywalled: false
      }));
      return res.status(200).json({ events: rawEvents, scannedAt: new Date().toISOString(), debugInfo: 'AI classify failed — showing raw headlines. Error: ' + (err.error?.message || '') });
    }

    let classifyData;
    try {
      classifyData = await classifyResp.json();
    } catch (e) {
      const rawText = await classifyResp.text().catch(() => 'unreadable');
      // Fall back to raw headlines if AI response is unparseable
      const rawEvents = unique.slice(0, 20).map((a, i) => ({
        id: i + 1, type: 'News', subtype: '',
        title: a.title, source: a.source, url: a.link,
        publishedDate: a.pubDate ? new Date(a.pubDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : today,
        body: a.desc ? a.desc.slice(0, 250) : '',
        individuals: [], orgs: [], state: 'National',
        relevance: '', deadline: '', paywalled: false
      }));
      return res.status(200).json({ events: rawEvents, scannedAt: new Date().toISOString(), debugInfo: 'AI response not valid JSON — showing raw headlines. Raw: ' + rawText.slice(0, 200) });
    }
    const classifyText = classifyData.content
      .map(b => b.type === 'text' ? b.text : '')
      .filter(Boolean)
      .join('\n');

    // ── STEP 3: Parse and enrich with original URLs ───────────────────────────
    let events = [];
    try {
      const cleaned = classifyText.replace(/```json|```/g, '').trim();
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) {
        events = JSON.parse(match[0]);
        // Enrich each event with the original article URL from RSS
        events = events.map(e => {
          const original = unique.find(a => a.title.toLowerCase().includes(e.title.toLowerCase().slice(0, 20)));
          return {
            ...e,
            url: original?.link || e.url || '',
            publishedDate: original?.pubDate
              ? new Date(original.pubDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
              : e.publishedDate
          };
        });
      } else {
        debugInfo += ' | AI returned no JSON — showing raw headlines.';
        events = unique.slice(0, 20).map((a, i) => ({
          id: i + 1, type: 'News', subtype: '',
          title: a.title, source: a.source, url: a.link,
          publishedDate: a.pubDate ? new Date(a.pubDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : today,
          body: a.desc ? a.desc.slice(0, 250) : '',
          individuals: [], orgs: [], state: 'National',
          relevance: '', deadline: '', paywalled: false
        }));
      }
    } catch (parseErr) {
      debugInfo += ' | Parse error: ' + parseErr.message;
    }

    return res.status(200).json({ events, scannedAt: new Date().toISOString(), debugInfo });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
