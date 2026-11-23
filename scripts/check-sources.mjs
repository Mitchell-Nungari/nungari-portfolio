// Live check of the scrapers (no Gemini key: the text sources will report that).
import { SOURCES, extractJsonLdEvents, fetchPage, htmlToText } from '../netlify/lib/sources.mjs';

for (const source of SOURCES) {
  const t0 = Date.now();
  const page = await fetchPage(source.url, 20000);
  const ms = Date.now() - t0;

  if (page.status !== 'ok') {
    console.log(`${source.id.padEnd(26)} ${page.status.padEnd(8)} ${ms}ms  ${page.error}`);
    continue;
  }

  const ld = extractJsonLdEvents(page.html);
  const text = htmlToText(page.html, 30000);
  console.log(
    `${source.id.padEnd(26)} ok      ${String(ms).padStart(5)}ms  bytes=${String(page.html.length).padStart(7)}  ` +
    `jsonld=${String(ld.length).padStart(3)}  text=${String(text.length).padStart(6)}`
  );

  if (ld.length) {
    ld.slice(0, 2).forEach((event) => {
      console.log(`      · ${event.date}  ${event.title}  | ${event.venue}  | ${(event.locationText || '').slice(0, 60)}`);
    });
  } else if (text.length) {
    console.log(`      · text sample: ${text.slice(0, 220)}`);
  }
}
