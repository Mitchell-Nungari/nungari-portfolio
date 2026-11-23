/**
 * /.netlify/functions/posters/<key>
 *
 * Serves the poster images uploaded through admin.html out of the "posters"
 * Blobs store. The site maps /posters/* onto this function (see the
 * redirect in netlify.toml), so a poster URL looks like /posters/abc.jpg.
 */
import { openNamedStore } from '../lib/events.mjs';

const POSTER_STORE = 'posters';

const TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif'
};

export default async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(req.url);
  const key = decodeURIComponent(url.pathname.replace(/^\/+/, '').split('/').pop() || '');
  if (!key || !/^[A-Za-z0-9._-]+$/.test(key)) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const store = openNamedStore(POSTER_STORE);
    const { data, metadata } = await store.getWithMetadata(key);
    if (!data) return new Response('Not found', { status: 404 });

    const extension = key.split('.').pop().toLowerCase();
    const contentType = (metadata && metadata.contentType) || TYPES[extension] || 'application/octet-stream';

    return new Response(data, {
      status: 200,
      headers: {
        'content-type': contentType,
        'cache-control': 'public, max-age=31536000, immutable'
      }
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
};
