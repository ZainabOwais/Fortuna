export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured.' });

  const { learnedExclude, learnedInclude } = req.body;

  const today = new Date().toLocaleDateString('en-AU', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  try {
    // ── Confirmed working Australian RSS feeds ────────────────────────────────
    const RSS_FEEDS = [
      { url: 'https://www.smh.com.au/rss/feed.xml',              label: 'SMH' },
      { url: 'https://www.smh.com.au/rss/business.xml',          label: 'SMH Business' },
      { url: 'https://www.abc.net.au/news/feed/45910/rss.xml',   label: 'ABC News' },
      { url: 'https://www.9news.com.au/rss',                     label: '9News' },
      { url: 'https://www.sbs.com.au/news/feed',                 label: 'SBS News' },
      { url: 'https://www.theage.com.au/rss/business.xml',       label: 'The Age Business' },
      { url: 'https://www.watoday.com.au/rss/feed.xml',          label: 'WAtoday' },
      { url: 'https://probononews.org/feed',                     label: 'Pro Bono Australia' },
    ];

    const allItems = [];
    const feedLog = [];

    for (const feed of RSS_FEEDS) {
      try {
        const r = await fetch(feed.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Fortuna/1.0)',
            'Accept': 'application/rss+xml, application/xml, text/xml, */*'
          }
        });
        if (!r.ok) { feedLog.push(`${feed.label}:${r.status}`); continue; }

        const xml = await r.text();
        const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
        feedLog.push(`${feed.label}:${items.length}`);

        for (const item of items) {
          const title   = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/))?.[1]?.trim() || '';
          const link    = (item.match(/<link>(.*?)<\/link>/))?.[1]?.trim() || item.match(/<guid[^>]*>(.*?)<\/guid>/)?.[1]?.trim() || '';
          const desc    = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || item.match(/<description>(.*?)<\/description>/))?.[1]?.replace(/<[^>]+>/g,'')?.trim() || '';
          const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() || '';
          const source  = item.match(/<source[^>]*>(.*?)<\/source>/)?.[1]?.trim() || feed.label;
          if (!title) continue;
          allItems.push({ title, link, desc, pubDate, source });
        }
      } catch(e) { feedLog.push(`${feed.label}:ERR`); }
    }

    // Filter to last 7 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const recent = allItems.filter(i => {
      if (!i.pubDate) return false;
      const pub = new Date(i.pubDate);
      return !isNaN(pub.getTime()) && pub >= cutoff;
    });

    // Sort newest first, deduplicate
    recent.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    const seen = new Set();
    const unique = recent.filter(i => {
      if (seen.has(i.title)) return false;
      seen.add(i.title); return true;
    });

    const top40 = unique.slice(0, 40);
    const debugInfo = `Feeds: ${feedLog.join(', ')}. After 7-day filter: ${recent.length}. Sending top ${top40.length}.`;

    if (!top40.length) {
      return res.status(200).json({ events: [], scannedAt: new Date().toISOString(), debugInfo });
    }

    // ── AI classifies into Fortuna wealth event cards ─────────────────────────
    const excludeNote = learnedExclude?.length ? `Exclude: ${learnedExclude.join(', ')}.` : '';
    const includeNote = learnedInclude?.length ? `Prioritise: ${learnedInclude.join(', ')}.` : '';

    const headlineList = top40.map((a, i) => {
      const pub = new Date(a.pubDate).toLocaleDateString('en-AU', { day:'numeric', month:'short', year:'numeric' });
      return `${i+1}. [${a.source}] [${pub}] ${a.title}`;
    }).join('\n');

    const classifyPrompt = `You are a prospect researcher for an Australian children's hospital non-profit. Today: ${today}. ${excludeNote} ${includeNote}

From these Australian news headlines identify ALL wealth events relevant to prospect research. Be generous — include anything that signals wealth, giving capacity or philanthropic intent.

Include: named Australians in financial contexts, business deals, property sales, donations, grants, executive appointments, ASX events, sponsorships of health or children causes, Rich List mentions, interest rate decisions affecting wealth.
Exclude: pure sport scores, weather, crime with no wealth angle, overseas news irrelevant to Australian wealth.

Headlines:
${headlineList}

Return ONLY a JSON array, no other text:
[{"id":1,"type":"Individual Wealth","subtype":"Net Worth Milestone","title":"clear headline","source":"publication","url":"","publishedDate":"5 May 2026","body":"Two plain English sentences.","individuals":["Full Name"],"orgs":["Org"],"state":"NSW","relevance":"Why this matters to children's hospital fundraising.","deadline":"","paywalled":false}]

Types: Individual Wealth, IPO, Acquisition, Donation, Grant, Real Estate, Appointment, Sponsorship
Individual Wealth subtypes: Net Worth Milestone, Liquidity Event, Dividend Windfall, Philanthropic Signal, Inheritance, Corporate Gain, Property Gain
subtype is "" for non-Individual-Wealth types.
individuals must be real named people — empty [] only for Grant or Sponsorship.
Return [] if nothing relevant.`;

    const classifyResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 4000, messages: [{ role: 'user', content: classifyPrompt }] })
    });

    let classifyData;
    try {
      classifyData = await classifyResp.json();
    } catch(e) {
      // Fall back to raw headlines
      const raw = top40.slice(0,20).map((a,i) => ({
        id:i+1, type:'News', subtype:'', title:a.title, source:a.source, url:a.link,
        publishedDate: new Date(a.pubDate).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'}),
        body:a.desc?.slice(0,200)||'', individuals:[], orgs:[], state:'National', relevance:'', deadline:'', paywalled:false
      }));
      return res.status(200).json({ events: raw, scannedAt: new Date().toISOString(), debugInfo: debugInfo + ' | AI failed, showing raw.' });
    }

    const classifyText = classifyData.content?.map(b => b.type==='text' ? b.text : '').filter(Boolean).join('\n') || '';

    let events = [];
    try {
      const cleaned = classifyText.replace(/```json|```/g,'').trim();
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) {
        events = JSON.parse(match[0]);
        // Enrich with original URLs
        events = events.map(e => {
          const orig = top40.find(a => a.title.toLowerCase().includes(e.title.toLowerCase().slice(0,20)));
          return { ...e, url: orig?.link || e.url || '' };
        });
      }
    } catch(e) { /* fall through */ }

    // If AI found nothing relevant, show top 20 raw
    if (!events.length) {
      events = top40.slice(0,20).map((a,i) => ({
        id:i+1, type:'News', subtype:'', title:a.title, source:a.source, url:a.link,
        publishedDate: new Date(a.pubDate).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'}),
        body:a.desc?.slice(0,200)||'', individuals:[], orgs:[], state:'National', relevance:'', deadline:'', paywalled:false
      }));
    }

    return res.status(200).json({ events, scannedAt: new Date().toISOString(), debugInfo });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
