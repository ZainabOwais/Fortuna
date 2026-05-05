export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Test multiple ABC News RSS URL formats
    const ABC_URLS = [
      'https://www.abc.net.au/news/feed/2942460/rss.xml',
      'https://www.abc.net.au/news/feed/51120/rss.xml',
      'https://www.abc.net.au/news/feed/45910/rss.xml',
      'https://www.abc.net.au/news/business/feed/2942460/rss.xml',
    ];

    const results = [];

    for (const url of ABC_URLS) {
      try {
        const r = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Fortuna/1.0)',
            'Accept': 'application/rss+xml, application/xml, text/xml, */*'
          }
        });
        const xml = r.ok ? await r.text() : '';
        const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
        const firstTitle = items[0]
          ? (items[0].match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || items[0].match(/<title>(.*?)<\/title>/))?.[1]?.trim()
          : 'no items';
        results.push(`${url} → HTTP ${r.status}, ${items.length} items, first: "${firstTitle}"`);
      } catch(e) {
        results.push(`${url} → ERROR: ${e.message}`);
      }
    }

    return res.status(200).json({
      events: [],
      scannedAt: new Date().toISOString(),
      debugInfo: results.join(' | ')
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
