/**
 * Event sources.
 *
 * One small config entry per working source, so a source that breaks, times
 * out or starts blocking never stops the others. Every page is fetched
 * exactly once, from the function, with a clear User-Agent.
 *
 * Only public pages are used, and each one was checked against its
 * robots.txt first:
 *   - allevents.in/nairobi, /mombasa   allowed (robots.txt disallows only
 *                                        year-pattern paths)
 *   - eventbrite.com/d/kenya--nairobi  allowed (robots.txt disallows the
 *                                        feed and query-parameter paths)
 *   - exploringmombasa.com/events/…     allowed (only /wp-admin/ is blocked)
 *   - www.hustle.events                 allowed (only /api/, /checkout/, /_next/)
 *   - ticketsasa.com/events             allowed (robots.txt has an empty
 *                                        Disallow and points at a sitemap)
 *   - mookh.com                         allowed on the home page (the
 *                                        /api/ and account paths are blocked)
 *
 * Dropped during the survey: kujivinjari.com (domain does not resolve),
 * discoverpwani.com (parked), mtickets.com (needs JavaScript and its API is
 * robots-disallowed), hustlesasa.com/events (404 — the listing moved to
 * hustle.events) and the Eventbrite Mombasa city page (404).
 */

export const USER_AGENT =
  'Mozilla/5.0 (compatible; NungariEventsBot/1.0; +https://nungari.netlify.app)';

export const FETCH_TIMEOUT_MS = 15000;
export const TEXT_CAP = 12000;

/**
 * kind: 'jsonld' — schema.org JSON-LD holds the events
 *       'text'   — plain HTML, the text is read by Gemini (no tools)
 * cities: the cities a source can deliver
 * city:   the default city for its events ('' means read it from the venue)
 */
export const SOURCES = [
  {
    id: 'allevents-nairobi',
    label: 'AllEvents — Nairobi',
    url: 'https://allevents.in/nairobi',
    kind: 'jsonld',
    cities: ['Nairobi'],
    city: 'Nairobi'
  },
  {
    id: 'allevents-mombasa',
    label: 'AllEvents — Mombasa',
    url: 'https://allevents.in/mombasa',
    kind: 'jsonld',
    cities: ['Mombasa', 'Diani'],
    city: 'Mombasa'
  },
  {
    id: 'eventbrite-nairobi',
    label: 'Eventbrite — Nairobi',
    url: 'https://www.eventbrite.com/d/kenya--nairobi/events/',
    kind: 'jsonld',
    cities: ['Nairobi'],
    city: 'Nairobi'
  },
  {
    id: 'exploringmombasa',
    label: 'Exploring Mombasa',
    url: 'https://exploringmombasa.com/events/',
    kind: 'text',
    cities: ['Mombasa', 'Diani'],
    city: 'Mombasa'
  },
  {
    id: 'exploringmombasa-diani',
    label: 'Exploring Mombasa — Diani',
    url: 'https://exploringmombasa.com/events/diani/',
    kind: 'text',
    cities: ['Diani'],
    city: 'Diani'
  },
  {
    id: 'hustlesasa',
    label: 'Hustlesasa',
    url: 'https://www.hustle.events/',
    kind: 'text',
    cities: ['Nairobi', 'Mombasa', 'Diani'],
    city: ''
  },
  {
    id: 'ticketsasa',
    label: 'Ticketsasa',
    url: 'https://ticketsasa.com/events',
    kind: 'text',
    cities: ['Nairobi', 'Mombasa', 'Diani'],
    city: ''
  },
  {
    id: 'mookh',
    label: 'Mookh',
    url: 'https://mookh.com/',
    kind: 'text',
    cities: ['Nairobi', 'Mombasa', 'Diani'],
    city: ''
  }
];

/** The sources that can deliver events for one city. */
export const sourcesForCity = (city) => {
  if (!city || city === 'all') return SOURCES;
  const wanted = String(city).toLowerCase();
  return SOURCES.filter((source) =>
    source.cities.some((name) => name.toLowerCase() === wanted)
  );
};

/* ------------------------------------------------------------------ */
/* Fetching                                                            */
/* ------------------------------------------------------------------ */

/**
 * Fetches one page. Never throws — the caller gets a status instead.
 * status: 'ok' | 'blocked' | 'error'
 */
export const fetchPage = async (url, timeoutMs = FETCH_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'en-KE,en;q=0.9'
      },
      redirect: 'follow',
      signal: controller.signal
    });

    const body = await res.text();

    if (res.status === 403 || res.status === 401 || res.status === 429) {
      return { status: 'blocked', httpStatus: res.status, html: '', error: `HTTP ${res.status}` };
    }
    if (!res.ok) {
      return { status: 'error', httpStatus: res.status, html: '', error: `HTTP ${res.status}` };
    }
    if (/just a moment|captcha|enable javascript and cookies/i.test(body.slice(0, 4000))) {
      return { status: 'blocked', httpStatus: res.status, html: '', error: 'bot check page' };
    }
    return { status: 'ok', httpStatus: res.status, html: body, error: null };
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    return {
      status: 'error',
      httpStatus: 0,
      html: '',
      error: aborted ? `timed out after ${timeoutMs}ms` : String(err && err.message)
    };
  } finally {
    clearTimeout(timer);
  }
};

/* ------------------------------------------------------------------ */
/* JSON-LD                                                             */
/* ------------------------------------------------------------------ */

const decodeEntities = (value) =>
  String(value ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/&hellip;/gi, '...')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');

const addressOf = (location) => {
  if (!location || typeof location !== 'object') return '';
  const address = location.address || {};
  const parts = [
    location.name,
    address.streetAddress,
    address.addressLocality,
    address.addressRegion,
    address.addressCountry
  ];
  return decodeEntities(parts.filter(Boolean).join(', ')).trim();
};

const firstImage = (image) => {
  if (Array.isArray(image)) return image[0] || '';
  if (typeof image === 'string') return image;
  if (image && typeof image === 'object') return image.url || image.contentUrl || '';
  return '';
};

const offersUrl = (offers) => {
  if (!offers) return '';
  if (typeof offers === 'string') return offers;
  if (Array.isArray(offers)) {
    for (const offer of offers) {
      const url = offersUrl(offer);
      if (url) return url;
    }
    return '';
  }
  return offers.url || '';
};

/** Flattens the fields that say what kind of event it is. */
const categoryOf = (node) => {
  const parts = [
    node.category,
    node.genre,
    node.keywords,
    node.about,
    node.eventType,
    node.subEvent && node.subEvent.name
  ];
  return parts
    .map((value) => {
      if (!value) return '';
      if (Array.isArray(value)) {
        return value
          .map((item) => (item && typeof item === 'object' ? item.name || '' : String(item)))
          .filter(Boolean)
          .join(' ');
      }
      if (typeof value === 'object') return value.name || value.term || '';
      return String(value);
    })
    .filter(Boolean)
    .join(' ');
};

const eventFromLd = (node) => {
  if (!node || typeof node !== 'object') return null;
  const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
  if (!types.some((t) => typeof t === 'string' && /event/i.test(t))) return null;

  const title = decodeEntities(node.name || node.headline || '').trim();
  if (!title) return null;

  const url = typeof node.url === 'string' ? node.url : '';
  const ticket = offersUrl(node.offers);
  const start = node.startDate || node.dateStart || '';
  // a date with no time means the source did not say when it starts
  const timeKnown = /\d{1,2}:\d{2}/.test(String(start));

  return {
    title,
    date: start,
    endDate: node.endDate || '',
    url: url || ticket,
    ticketUrl: ticket && ticket !== url ? ticket : '',
    image: firstImage(node.image),
    venue: decodeEntities((node.location && node.location.name) || '').trim(),
    locationText: addressOf(node.location),
    description: decodeEntities(node.description || '').trim().slice(0, 400),
    category: categoryOf(node),
    genre: decodeEntities(
      Array.isArray(node.genre) ? node.genre.join(', ') : node.genre || ''
    ).trim(),
    keywords: decodeEntities(
      Array.isArray(node.keywords) ? node.keywords.join(', ') : node.keywords || ''
    ).trim(),
    timeKnown,
    allDay: !timeKnown
  };
};

const collectLd = (node, out) => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((item) => collectLd(item, out));
    return;
  }
  if (node.itemListElement) {
    const list = Array.isArray(node.itemListElement) ? node.itemListElement : [node.itemListElement];
    list.forEach((entry) => collectLd(entry && entry.item ? entry.item : entry, out));
    return;
  }
  if (node['@graph']) {
    collectLd(node['@graph'], out);
    return;
  }
  if (Array.isArray(node.events)) {
    collectLd(node.events, out);
    return;
  }
  const event = eventFromLd(node);
  if (event) out.push(event);
};

/** Does the page carry any JSON-LD block at all? */
export const hasJsonLd = (html) => {
  const re = /<script[^>]+type=["']application\/ld\+json["']/i;
  return re.test(String(html || ''));
};

/** Every schema.org Event found in the page's JSON-LD blocks. */
export const extractJsonLdEvents = (html) => {
  const events = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(String(html || '')))) {
    let parsed;
    try {
      parsed = JSON.parse(match[1].trim());
    } catch {
      continue;
    }
    collectLd(parsed, events);
  }
  return events;
};

/* ------------------------------------------------------------------ */
/* Plain HTML                                                          */
/* ------------------------------------------------------------------ */

/**
 * Strips a page to readable text. Link targets are kept as "[url]" so the
 * full event title can be recovered from a slug, and the result is capped.
 */
export const htmlToText = (html, cap = TEXT_CAP) => {
  let text = String(html || '');

  text = text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ');

  text = text.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (all, href, inner) => {
    const label = decodeEntities(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    return ` ${label} [${href}] `;
  });

  text = decodeEntities(text.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  return text.slice(0, cap);
};
