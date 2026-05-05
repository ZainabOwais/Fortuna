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
    // ── Google News RSS — surfaces AFR, SMH, The Australian, ABC etc ──────────
    const RSS_FEEDS = [
      {
        url: 'https://news.google.com/rss/search?q=Australia+wealth+billionaire+philanthropy+donation&hl=en-AU&gl=AU&ceid=AU:en',
        label: 'Google: Wealth & Philanthropy'
      },
      {
        url: 'https://news.google.com/rss/search?q=Australia+ASX+IPO+acquisition+merger+executive&hl=en-AU&gl=AU&ceid=AU:en',
        label: 'Google: ASX & Deals'
      },
      {
        url: 'https://news.google.com/rss/search?q=Australia+property+sale+real+estate+luxury&hl=en-AU&gl=AU&ceid=AU:en',
        label: 'Google: Property'
      },
      {
        url: 'https://news.google.com/rss/search?q=Australia+grant+children+health+foundation+nonprofit&hl=en-AU&gl=AU&ceid=AU:en',
        label: 'Google: Grants & Health'
      },
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

        if (!rssResp.ok) {
          debugInfo = (debugInfo||'') + `${feed.label}: HTTP ${rssResp.status}. `;
          continue;
        }

        const xml = await rssResp.text();
        const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
        debugInfo = (debugInfo||'') + `${feed.label}: ${items.length} items. `;

        for (const item of items) {
          const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                         item.match(/<title>(.*?)<\/title>/))?.[1]?.trim() || '';
          const link  = (item.match(/<link>(.*?)<\/link>/))?.[1]?.trim() ||
                         item.match(/<guid[^>]*>(.*?)<\/guid>/)?.[1]?.trim() || '';
          const desc  = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
                         item.match(/<description>(.*?)<\/description>/))?.[1]
                         ?.replace(/<[^>]+>/g, '')?.trim() || '';
          const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() || '';
          // Google News embeds source name in <source> tag
          const source  = item.match(/<source[^>]*>(.*?)<\/source>/)?.[1]?.trim() || feed.label;

          if (!title) continue;
          allItems.push({ title, link, desc, pubDate, source });
        }
      } catch (e) {
        debugInfo = (debugInfo||'') + `${feed.label} error: ${e.message}. `;
      }
    }

    if (!allItems.length) {
      return res.status(200).json({
        events: [],
        scannedAt: new Date().toISOString(),
        debugInfo: (debugInfo||'') + ' No items found.'
      });
    }

    // Deduplicate by title
    const seen = new Set();
    const unique = allItems.filter(i => {
      if (seen.has(i.title)) return false;
      seen.add(i.title); return true;
    });

    // Log a sample date so we can debug format
    const sampleDate = allItems[0]?.pubDate || 'no date found';
    debugInfo = (debugInfo||'') + ` Total unique: ${unique.length}. Sample date: "${sampleDate}".`;

    debugInfo = (debugInfo||'') + ` Total unique: ${unique.length}.`;

    // ── AI classifies into Fortuna wealth event cards ─────────────────────────
    const excludeNote = learnedExclude && learnedExclude.length
      ? `Exclude types: ${learnedExclude.join(', ')}.` : '';
    const includeNote = learnedInclude && learnedInclude.length
      ? `Prioritise: ${learnedInclude.join(', ')}.` : '';

    const headlineList = unique.slice(0, 30).map((a, i) => {
      const pubLabel = a.pubDate ? new Date(a.pubDate).toLocaleDateString('en-AU', { day:'numeric', month:'short', year:'numeric' }) : 'unknown date';
      return `${i + 1}. [${a.source}] [${pubLabel}] ${a.title}${a.desc ? ' — ' + a.desc.slice(0, 40) : ''}`;
    }).join('\n');

    const classifyPrompt = `You are a prospect researcher for an Australian children's hospital non-profit. Today: ${today}. ${excludeNote} ${includeNote}

Below are Australian news headlines. Each headline shows its publication date in brackets. Today is ${today}.

STRICT RULE: Only include articles published in the last 7 days. If the date shown is from 2024 or earlier, skip it entirely — do not include it under any circumstances.

Be GENEROUS with relevance — include any recent headline that signals wealth, giving capacity or philanthropic intent. When in doubt include it.

Include: named Australians in financial contexts, company deals, property transactions, donations, grants, executive appointments, Rich List mentions, sponsorships of health or children causes.
Exclude: pure sport, weather, crime, overseas news with no Australian wealth angle.

Headlines:
${headlineList}

Return ONLY a JSON array, no other text:
[{
  "id": 1,
  "type": "Individual Wealth",
  "subtype": "Net Worth Milestone",
  "title": "clear short headline",
  "source": "publication name from brackets above",
  "url": "",
  "publishedDate": "${today}",
  "body": "Two plain English sentences anyone can understand.",
  "individuals": ["Full Name"],
  "orgs": ["Organisation"],
  "state": "NSW",
  "relevance": "One sentence why this matters to children's hospital fundraising.",
  "deadline": "",
  "paywalled": false
}]

Types: Individual Wealth, IPO, Acquisition, Donation, Grant, Real Estate, Appointment, Sponsorship
Individual Wealth subtypes: Net Worth Milestone, Liquidity Event, Dividend Windfall, Philanthropic Signal, Inheritance, Corporate Gain, Property Gain
subtype is "" for all non-Individual-Wealth types.
individuals must be real named people — empty [] only for Grant or Sponsorship.
Return [] if nothing relevant found.`;

    const classifyResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        messages: [{ role: 'user', content: classifyPrompt }]
      })
    });

    // If AI fails fall back to raw headlines
    if (!classifyResp.ok) {
      const rawEvents = unique.slice(0, 25).map((a, i) => ({
        id: i + 1, type: 'News', subtype: '',
        title: a.title, source: a.source, url: a.link,
        publishedDate: a.pubDate ? new Date(a.pubDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : today,
        body: a.desc ? a.desc.slice(0, 250) : '',
        individuals: [], orgs: [], state: 'National',
        relevance: '', deadline: '', paywalled: false
      }));
      return res.status(200).json({ events: rawEvents, scannedAt: new Date().toISOString(), debugInfo: debugInfo + ' AI failed — showing raw.' });
    }

    let classifyData;
    try {
      classifyData = await classifyResp.json();
    } catch (e) {
      const rawEvents = unique.slice(0, 25).map((a, i) => ({
        id: i + 1, type: 'News', subtype: '',
        title: a.title, source: a.source, url: a.link,
        publishedDate: a.pubDate ? new Date(a.pubDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : today,
        body: a.desc ? a.desc.slice(0, 250) : '',
        individuals: [], orgs: [], state: 'National',
        relevance: '', deadline: '', paywalled: false
      }));
      return res.status(200).json({ events: rawEvents, scannedAt: new Date().toISOString(), debugInfo: debugInfo + ' AI JSON parse failed — showing raw.' });
    }

    const classifyText = classifyData.content
      .map(b => b.type === 'text' ? b.text : '')
      .filter(Boolean)
      .join('\n');

    let events = [];
    try {
      const cleaned = classifyText.replace(/```json|```/g, '').trim();
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) {
        events = JSON.parse(match[0]);
        // Enrich with original URLs from RSS
        events = events.map(e => {
          const original = unique.find(a =>
            a.title.toLowerCase().includes(e.title.toLowerCase().slice(0, 20))
          );
          return {
            ...e,
            url: original?.link || e.url || '',
            publishedDate: original?.pubDate
              ? new Date(original.pubDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
              : e.publishedDate
          };
        });
      } else {
        // Fall back to raw if no JSON found
        events = unique.slice(0, 25).map((a, i) => ({
          id: i + 1, type: 'News', subtype: '',
          title: a.title, source: a.source, url: a.link,
          publishedDate: a.pubDate ? new Date(a.pubDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : today,
          body: a.desc ? a.desc.slice(0, 250) : '',
          individuals: [], orgs: [], state: 'National',
          relevance: '', deadline: '', paywalled: false
        }));
        debugInfo += ' AI returned no JSON — showing raw headlines.';
      }
    } catch (parseErr) {
      debugInfo += ' Parse error: ' + parseErr.message;
    }

    return res.status(200).json({ events, scannedAt: new Date().toISOString(), debugInfo });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
