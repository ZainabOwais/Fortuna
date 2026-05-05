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

  const todayDate = new Date();
  todayDate.setHours(0, 0, 0, 0);

  let debugInfo = null;

  try {
    // ── Fetch AFR RSS feeds ───────────────────────────────────────────────────
    const RSS_FEEDS = [
      { url: 'https://www.afr.com/rss', label: 'AFR' },
      { url: 'https://www.afr.com/rss/companies', label: 'AFR Companies' },
      { url: 'https://www.afr.com/rss/markets', label: 'AFR Markets' },
      { url: 'https://www.afr.com/rss/wealth', label: 'AFR Wealth' },
      { url: 'https://www.afr.com/rss/property', label: 'AFR Property' },
    ];

    const allItems = [];

    for (const feed of RSS_FEEDS) {
      try {
        const rssResp = await fetch(feed.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Fortuna/1.0)' }
        });
        if (!rssResp.ok) {
          debugInfo = (debugInfo || '') + ` | ${feed.label} fetch failed: ${rssResp.status}`;
          continue;
        }
        const xml = await rssResp.text();

        // Parse <item> blocks from RSS XML
        const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
        for (const item of items) {
          const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                         item.match(/<title>(.*?)<\/title>/))?.[1]?.trim() || '';
          const link  = (item.match(/<link>(.*?)<\/link>/))?.[1]?.trim() || '';
          const desc  = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
                         item.match(/<description>(.*?)<\/description>/))?.[1]
                         ?.replace(/<[^>]+>/g, '')?.trim() || '';
          const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/))?.[1]?.trim() || '';

          if (!title) continue;

          // Only include today's articles
          const pub = pubDate ? new Date(pubDate) : null;
          if (pub && pub < todayDate) continue;

          allItems.push({
            title,
            link,
            desc,
            pubDate,
            source: feed.label
          });
        }
      } catch (feedErr) {
        debugInfo = (debugInfo || '') + ` | ${feed.label} error: ${feedErr.message}`;
      }
    }

    debugInfo = `Fetched ${allItems.length} items from AFR RSS feeds today. ` + (debugInfo || '');

    if (!allItems.length) {
      return res.status(200).json({
        events: [],
        scannedAt: new Date().toISOString(),
        debugInfo: debugInfo + ' | No items found — RSS may be blocking or empty today.'
      });
    }

    // Deduplicate by title
    const seen = new Set();
    const unique = allItems.filter(i => {
      if (seen.has(i.title)) return false;
      seen.add(i.title);
      return true;
    });

    // Map to Fortuna event cards — just headlines for now
    const events = unique.slice(0, 30).map((a, i) => ({
      id: i + 1,
      type: 'News',
      subtype: '',
      title: a.title,
      source: a.source,
      url: a.link,
      publishedDate: a.pubDate
        ? new Date(a.pubDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
        : today,
      body: a.desc ? a.desc.slice(0, 200) : 'No description available.',
      individuals: [],
      orgs: [],
      state: 'National',
      relevance: '',
      deadline: '',
      paywalled: true
    }));

    return res.status(200).json({ events, scannedAt: new Date().toISOString(), debugInfo });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
