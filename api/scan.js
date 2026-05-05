export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const RSS_FEEDS = [
      { url: 'https://www.abc.net.au/news/feed/45910/rss.xml', label: 'ABC News' },
      { url: 'https://www.9news.com.au/rss',                   label: '9News' },
      { url: 'https://www.sbs.com.au/news/feed',               label: 'SBS News' },
    ];

    const results = [];

    for (const feed of RSS_FEEDS) {
      try {
        const r = await fetch(feed.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Fortuna/1.0)',
            'Accept': 'application/rss+xml, application/xml, text/xml, */*'
          }
        });
        const xml = r.ok ? await r.text() : '';
        const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
        const firstTitle = items[0]
          ? (items[0].match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || items[0].match(/<title>(.*?)<\/title>/))?.[1]?.trim() || 'no title'
          : 'no items';
        const firstDate = items[0]
          ? items[0].match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() || 'no date'
          : 'no items';
        results.push(`${feed.label}: HTTP ${r.status}, ${items.length} items, first: "${firstTitle}" (${firstDate})`);
      } catch(e) {
        results.push(`${feed.label}: ERROR ${e.message}`);
      }
    }

    return res.status(200).json({
      events: [],
      scannedAt: new Date().toISOString(),
      debugInfo: results.join(' || ')
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
