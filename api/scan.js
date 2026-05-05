export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const today = new Date().toLocaleDateString('en-AU', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  try {
    const RSS_FEEDS = [
      { url: 'https://www.abc.net.au/news/feed/2942460/rss.xml', label: 'ABC News' },
      { url: 'https://www.theage.com.au/rss/business.xml',       label: 'The Age Business' },
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
          allItems.push({ title: `[${feed.label} FAILED: HTTP ${rssResp.status}]`, source: feed.label, link: '', desc: '', pubDate: '' });
          continue;
        }

        const xml = await rssResp.text();
        const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];

        for (const item of items) {
          const title   = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/))?.[1]?.trim() || '';
          const link    = (item.match(/<link>(.*?)<\/link>/))?.[1]?.trim() || item.match(/<guid[^>]*>(.*?)<\/guid>/)?.[1]?.trim() || '';
          const desc    = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || item.match(/<description>(.*?)<\/description>/))?.[1]?.replace(/<[^>]+>/g,'')?.trim() || '';
          const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() || '';
          if (!title) continue;
          allItems.push({ title, link, desc, pubDate, source: feed.label });
        }

      } catch (e) {
        allItems.push({ title: `[${feed.label} ERROR: ${e.message}]`, source: feed.label, link: '', desc: '', pubDate: '' });
      }
    }

    // Deduplicate
    const seen = new Set();
    const unique = allItems.filter(i => {
      if (seen.has(i.title)) return false;
      seen.add(i.title); return true;
    });

    const events = unique.slice(0, 30).map((a, i) => ({
      id: i + 1,
      type: 'News',
      subtype: '',
      title: a.title,
      source: a.source,
      url: a.link,
      publishedDate: a.pubDate,
      body: a.desc ? a.desc.slice(0, 200) : '',
      individuals: [],
      orgs: [],
      state: 'National',
      relevance: '',
      deadline: '',
      paywalled: false
    }));

    return res.status(200).json({
      events,
      scannedAt: new Date().toISOString(),
      debugInfo: `ABC News + The Age Business: ${unique.length} headlines total.`
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
