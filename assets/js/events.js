/* ============================================================
   Events — data layer, filters, views, lightbox, map, clock
   ============================================================ */
(() => {
  const hasGSAP = !!window.gsap;
  const hasST = !!(window.gsap && window.ScrollTrigger);
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const pad = (n) => String(n).padStart(2, '0');
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  /* ============================================================
     1. Data layer — the only place events come from
     ------------------------------------------------------------
     fetchEvents() is deliberately isolated: the UI never touches
     the network. It asks the Netlify function first and falls back
     to the static file when the function is not there (plain
     `python -m http.server`, offline, or a deploy without
     functions), so the page always works.
     ============================================================ */
  const EVENTS_SOURCE = {
    url: '/.netlify/functions/events',
    staticFallback: 'data/events.json'
  };

  const normalise = (raw, i) => {
    const date = new Date(raw.date);
    const end = raw.end ? new Date(raw.end) : new Date(date.getTime() + 3 * 60 * 60 * 1000);
    return {
      id: String(raw.id || ('ev-' + (i + 1))),
      title: raw.title || 'Untitled show',
      date,
      dateISO: raw.date,
      end: Number.isNaN(end.getTime()) ? date : end,
      venue: raw.venue || '',
      city: raw.city || '',
      poster: raw.poster || '',
      ticketUrl: raw.ticketUrl || '',
      source: raw.source || 'unknown',
      // a source that gave no time: the time is still to be announced
      timeKnown: raw.timeKnown !== false,
      allDay: Boolean(raw.allDay)
    };
  };

  const readEvents = async (url) => {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('events: HTTP ' + res.status);
    const payload = await res.json();
    const list = Array.isArray(payload)
      ? payload
      : (payload && Array.isArray(payload.events) ? payload.events : []);
    return list.map(normalise).sort((a, b) => a.date - b.date);
  };

  async function fetchEvents() {
    try {
      return await readEvents(EVENTS_SOURCE.url);
    } catch (err) {
      // The function is missing or unreachable — fall back to the file.
      console.warn('[events] falling back to ' + EVENTS_SOURCE.staticFallback, err);
      return await readEvents(EVENTS_SOURCE.staticFallback);
    }
  }

  window.MNEvents = {
    fetchEvents,
    setSource(url) { EVENTS_SOURCE.url = url; }
  };

  /* ============================================================
     2. Formatting — everything in Nairobi time (EAT, GMT+3)
     ============================================================ */
  const TZ = 'Africa/Nairobi';
  const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const dateFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit' });
  const monFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, month: 'short' });
  const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  const isoFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

  const parts = (ev) => {
    const d = ev.date;
    return {
      day: dayFmt.format(d),
      mon: monFmt.format(d).toUpperCase(),
      year: Number(isoFmt.format(d).slice(0, 4)),
      time: hourFmt.format(d),
      iso: isoFmt.format(d),
      y: Number(isoFmt.format(d).slice(0, 4)),
      m: Number(isoFmt.format(d).slice(5, 7)),
      d: Number(isoFmt.format(d).slice(8, 10))
    };
  };

  const timeLabel = (ev) => {
    // never invent a time: if the source did not give one, it stays TBA
    if (ev.timeKnown === false) return 'Time TBA';
    const start = hourFmt.format(ev.date);
    const doors = new Date(ev.date.getTime() - 60 * 60 * 1000);
    return start + ' EAT · Doors ' + hourFmt.format(doors);
  };

  /* ============================================================
     3. State
     ============================================================ */
  const CITIES = ['all', 'nairobi', 'mombasa', 'diani'];
  const state = {
    events: [],
    filtered: [],
    city: 'all',
    when: 'upcoming',
    view: 'grid',
    q: '',
    loading: true,
    month: null,
    monthManual: false
  };

  const gridEl = $('#viewGrid');
  const listEl = $('#viewList');
  const calEl = $('#viewCal');
  const viewsEl = $('#views');
  const emptyEl = $('#emptyState');
  const emptyTitle = $('#emptyTitle');
  const emptyBody = $('#emptyBody');
  const countEl = $('#eventCount');
  const searchInput = $('#searchInput');
  const cityTabs = $('#cityTabs');
  const whenToggle = $('#whenToggle');
  const viewSwitch = $('#viewSwitch');

  /* ============================================================
     4. Clock — live Nairobi time
     ============================================================ */
  const clockHM = $('#clockHM');
  const clockSec = $('#clockSec');
  const clockDate = $('#clockDate');
  let lastSec = null;
  let clockTimer = 0;

  const tickClock = () => {
    if (!clockHM || !clockSec) return;
    const now = new Date();
    // en-GB + hourCycle h23 + the Nairobi timeZone yields 24-hour HH:MM:SS.
    const [hh, mm, ss] = timeFmt.format(now).split(':');
    clockHM.textContent = hh + ':' + mm;
    clockSec.textContent = ':' + ss;
    if (lastSec !== null && lastSec !== ss && hasGSAP) {
      gsap.fromTo(clockSec, { y: -5, opacity: .5 }, { y: 0, opacity: 1, duration: .4, ease: 'power2.out' });
    }
    lastSec = ss;
    if (clockDate) clockDate.textContent = dateFmt.format(now);
  };
  // Re-arm just after each real second boundary so the clock never drifts.
  const scheduleTick = () => {
    const delay = 1000 - (Date.now() % 1000) + 8;
    clockTimer = window.setTimeout(() => { tickClock(); scheduleTick(); }, delay);
  };
  tickClock();
  scheduleTick();

  /* ============================================================
     5. Hero entrance — same choreography as the home page
     ============================================================ */
  const hero = $('.hero');
  if (hero) {
    if (!hasGSAP) {
      $$('.hero [data-intro]').forEach((el) => { el.style.opacity = '1'; el.style.transform = 'none'; });
      const line = $('.hero__title .line > span');
      if (line) line.style.transform = 'none';
    } else {
      const tl = gsap.timeline({ delay: .12 });
      tl.fromTo('.hero__title .line > span',
        { translateY: '112%' },
        { translateY: '0%', duration: 1.15, ease: 'expo.out', stagger: .1 }, .15)
        .to('.hero [data-intro]', { opacity: 1, y: 0, duration: .85, stagger: .11, ease: 'power3.out' }, .5)
        .fromTo('.hero__aside .btn', { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: .7, stagger: .08, ease: 'power3.out' }, .9);
    }
  }

  /* ============================================================
     6. Page curtain — a blackout between pages
     ============================================================ */
  const curtain = $('#curtain');
  if (curtain) {
    if (hasGSAP) {
      gsap.to(curtain, {
        opacity: 0, duration: .7, ease: 'power2.inOut', delay: .05,
        onComplete: () => curtain.classList.add('is-clear')
      });
    } else {
      curtain.classList.add('is-clear');
    }

    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href') || '';
      if (!href || href.startsWith('#') || a.target === '_blank') return;
      if (/^(https?:|mailto:|tel:|javascript:)/i.test(href)) return;
      e.preventDefault();
      const go = () => { window.location.href = a.href; };
      if (hasGSAP) {
        curtain.classList.remove('is-clear');
        gsap.to(curtain, { opacity: 1, duration: .42, ease: 'power2.in', onComplete: go });
      } else {
        go();
      }
    });
  }

  /* ============================================================
     7. Controls
     ============================================================ */
  const moveThumb = (seg) => {
    if (!seg) return;
    const active = seg.querySelector('.segment__btn.is-active');
    const thumb = seg.querySelector('.segment__thumb');
    if (!active || !thumb) return;
    thumb.style.width = active.offsetWidth + 'px';
    thumb.style.transform = 'translateX(' + (active.offsetLeft - 4) + 'px)';
  };

  const paintSegment = (seg, key, value) => {
    $$('.segment__btn', seg).forEach((b) => {
      const on = b.dataset[key] === value;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    moveThumb(seg);
  };

  const paintCities = () => {
    $$('.chip', cityTabs).forEach((c) => {
      const on = c.dataset.city === state.city;
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-pressed', String(on));
    });
  };

  const setCity = (city, opts = {}) => {
    if (!CITIES.includes(city)) return;
    state.city = city;
    paintCities();
    if (opts.updateHash !== false) {
      const hash = '#' + city;
      if (location.hash !== hash) history.replaceState(null, '', hash);
    }
    render();
  };

  if (cityTabs) {
    cityTabs.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (chip) setCity(chip.dataset.city);
    });
  }

  if (whenToggle) {
    whenToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.segment__btn');
      if (!btn) return;
      state.when = btn.dataset.when;
      paintSegment(whenToggle, 'when', state.when);
      render();
    });
  }

  if (viewSwitch) {
    viewSwitch.addEventListener('click', (e) => {
      const btn = e.target.closest('.segment__btn');
      if (!btn) return;
      state.view = btn.dataset.view;
      paintSegment(viewSwitch, 'view', state.view);
      showView();
      render();
    });
  }

  let searchTimer = 0;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.q = searchInput.value.trim().toLowerCase();
        render();
      }, 160);
    });
  }

  const emptyReset = $('#emptyReset');
  if (emptyReset) {
    emptyReset.addEventListener('click', () => {
      if (searchInput) { searchInput.value = ''; }
      state.q = '';
      setCity('all');
    });
  }

  const showView = () => {
    gridEl.hidden = state.view !== 'grid';
    listEl.hidden = state.view !== 'list';
    calEl.hidden = state.view !== 'calendar';
    if (hasGSAP) {
      const active = state.view === 'grid' ? gridEl : (state.view === 'list' ? listEl : calEl);
      // opacity only — a transform here would offset the FLIP measurements
      gsap.fromTo(active, { opacity: 0 }, { opacity: 1, duration: .45, ease: 'power2.out' });
    }
  };

  /* ============================================================
     8. Rendering
     ============================================================ */
  const applyFilters = () => {
    const now = new Date();
    state.filtered = state.events.filter((ev) => {
      if (state.city !== 'all' && ev.city.toLowerCase() !== state.city) return false;
      if (state.when === 'upcoming' && ev.date.getTime() < now.getTime()) return false;
      if (state.when === 'past' && ev.date.getTime() >= now.getTime()) return false;
      if (state.q) {
        const hay = (ev.title + ' ' + ev.venue + ' ' + ev.city + ' ' + ev.source).toLowerCase();
        if (hay.indexOf(state.q) === -1) return false;
      }
      return true;
    });
  };

  /* Poster artwork, or the generated city card when there is no poster. */
  const posterMarkup = (ev, alt) => {
    if (ev.poster) {
      return '<img src="' + escapeHtml(ev.poster) + '" alt="' + escapeHtml(alt) + '" loading="lazy" decoding="async" width="800" height="1000" />';
    }
    return '<span class="citycard" data-city="' + escapeHtml(ev.city) + '" aria-hidden="true">' +
      '<span class="citycard__city">' + escapeHtml(ev.city) + '</span>' +
      '<span class="citycard__rule"></span>' +
      '<span class="citycard__title">' + escapeHtml(ev.title) + '</span>' +
      '</span>';
  };

  const buildPoster = (ev) => {
    const p = parts(ev);
    const el = document.createElement('article');
    el.className = 'poster';
    el.dataset.id = ev.id;
    el.innerHTML =
      '<div class="poster__tilt">' +
        '<button class="poster__media" type="button" data-open="' + ev.id + '" aria-label="Open poster: ' + escapeHtml(ev.title) + '">' +
          posterMarkup(ev, ev.title + ' poster') +
          '<span class="poster__scrim"></span>' +
          '<span class="poster__glare"></span>' +
          '<span class="poster__badge"><b>' + p.day + ' ' + p.mon + '</b><span>' + p.year + '</span></span>' +
          '<span class="poster__city"><span class="dot"></span>' + escapeHtml(ev.city) + '</span>' +
        '</button>' +
        '<div class="poster__body">' +
          '<h3 class="poster__title">' + escapeHtml(ev.title) + '</h3>' +
          '<p class="poster__meta">' + escapeHtml(ev.venue) + (ev.city ? ' · ' + escapeHtml(ev.city) : '') + '</p>' +
          '<p class="poster__time">' + timeLabel(ev) + '</p>' +
          '<div class="poster__actions">' +
            '<a class="btn btn--solid" href="' + escapeHtml(ev.ticketUrl) + '" target="_blank" rel="noopener">Tickets <span class="btn__chip"><svg aria-hidden="true"><use href="#i-arrow"/></svg></span></a>' +
            '<button class="btn btn--ghost" type="button" data-ics="' + ev.id + '"><svg aria-hidden="true"><use href="#i-cal-plus"/></svg> Add to calendar</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    return el;
  };

  const buildRow = (ev) => {
    const p = parts(ev);
    const el = document.createElement('article');
    el.className = 'row';
    el.dataset.id = ev.id;
    el.innerHTML =
      '<button class="row__media" type="button" data-open="' + ev.id + '" aria-label="Open poster: ' + escapeHtml(ev.title) + '">' +
        posterMarkup(ev, '') +
      '</button>' +
      '<div class="row__date"><span class="row__day">' + p.day + '</span><span class="row__mon">' + p.mon + '</span><span class="row__year">' + p.year + '</span></div>' +
      '<div class="row__main">' +
        '<h3 class="row__title">' + escapeHtml(ev.title) + '</h3>' +
        '<p class="row__meta">' + escapeHtml(ev.venue) + (ev.city ? ' · ' + escapeHtml(ev.city) : '') + '</p>' +
        '<p class="row__time">' + timeLabel(ev) + '</p>' +
      '</div>' +
      '<span class="row__city">' + escapeHtml(ev.city) + '</span>' +
      '<div class="row__actions">' +
        '<a class="btn btn--solid" href="' + escapeHtml(ev.ticketUrl) + '" target="_blank" rel="noopener">Tickets <span class="btn__chip"><svg aria-hidden="true"><use href="#i-arrow"/></svg></span></a>' +
        '<button class="row__ics" type="button" data-ics="' + ev.id + '" aria-label="Add ' + escapeHtml(ev.title) + ' to calendar"><svg aria-hidden="true"><use href="#i-cal-plus"/></svg></button>' +
      '</div>';
    return el;
  };

  /* ---------- FLIP update of a card container ---------- */
  const updateContainer = (container, items, builder, animate) => {
    if (!container) return;
    // drop any leftover skeleton
    $$(':scope > *', container).forEach((el) => { if (!el.dataset.id) el.remove(); });

    const existing = new Map();
    $$('[data-id]', container).forEach((el) => existing.set(el.dataset.id, el));
    const wanted = new Set(items.map((i) => i.id));

    const oldRects = new Map();
    if (animate) {
      existing.forEach((el, id) => {
        if (wanted.has(id)) oldRects.set(id, el.getBoundingClientRect());
      });
    }

    const entering = [];
    items.forEach((item) => {
      if (!existing.has(item.id)) {
        const el = builder(item);
        container.appendChild(el);
        entering.push(el);
      }
    });

    if (!animate) {
      existing.forEach((el, id) => { if (!wanted.has(id)) el.remove(); });
      if (entering.length) {
        if (hasGSAP) {
          gsap.fromTo(entering, { opacity: 0, y: 22, scale: .98 }, { opacity: 1, y: 0, scale: 1, duration: .6, stagger: .05, ease: 'power3.out', clearProps: 'transform' });
        }
      }
      return;
    }

    // survivors: animate from their old position to the new one
    $$('[data-id]', container).forEach((el) => {
      const id = el.dataset.id;
      if (!wanted.has(id) || entering.indexOf(el) !== -1) return;
      const o = oldRects.get(id);
      if (!o) return;
      const n = el.getBoundingClientRect();
      const dx = o.left - n.left;
      const dy = o.top - n.top;
      if (!dx && !dy) return;
      if (hasGSAP) {
        gsap.fromTo(el, { x: dx, y: dy }, { x: 0, y: 0, duration: .75, ease: 'power3.out', overwrite: true });
      }
    });

    if (entering.length && hasGSAP) {
      gsap.fromTo(entering, { opacity: 0, y: 26, scale: .97 }, { opacity: 1, y: 0, scale: 1, duration: .7, stagger: .05, ease: 'power3.out', clearProps: 'transform' });
    }

    existing.forEach((el, id) => {
      if (wanted.has(id)) return;
      if (!hasGSAP) { el.remove(); return; }
      gsap.to(el, { opacity: 0, y: -14, scale: .98, duration: .32, ease: 'power2.in', onComplete: () => el.remove() });
    });
  };

  /* ---------- Calendar view ---------- */
  const calMonthLabel = (y, m) => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m, 1)));

  const renderCalendar = (items) => {
    if (!calEl) return;
    if (!items.length) {
      calEl.innerHTML = '<div class="cal"><p class="cal__empty">No dates in this view.</p></div>';
      return;
    }

    const byDate = new Map();
    items.forEach((ev) => {
      const p = parts(ev);
      const key = p.y + '-' + pad(p.m) + '-' + pad(p.d);
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push(ev);
    });

    // which month are we showing?
    let y = state.month ? state.month.y : new Date().getFullYear();
    let m = state.month ? state.month.m : (new Date().getMonth() + 1);
    const inMonth = (yy, mm) => {
      const prefix = yy + '-' + pad(mm);
      for (const key of byDate.keys()) if (key.indexOf(prefix) === 0) return true;
      return false;
    };
    if (!state.monthManual && !inMonth(y, m)) {
      const firstEvent = items[0];
      const fp = parts(firstEvent);
      y = fp.y; m = fp.m;
      state.month = { y, m };
    }

    const first = new Date(Date.UTC(y, m, 1));
    const startDow = (first.getUTCDay() + 6) % 7;      // Monday first
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const prevMonthDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const rows = Math.ceil((startDow + daysInMonth) / 7);
    const today = isoFmt.format(new Date());

    const cells = [];
    for (let i = 0; i < startDow; i++) {
      cells.push({ day: prevMonthDays - startDow + 1 + i, out: true, key: null });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const key = y + '-' + pad(m) + '-' + pad(d);
      cells.push({ day: d, out: false, key, events: byDate.get(key) || [] });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ day: cells.length - startDow - daysInMonth + 1, out: true, key: null });
    }

    const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    let html = '<div class="cal">';
    html += '<div class="cal__head">' +
      '<button class="cal__nav" type="button" data-month="-1" aria-label="Previous month"><svg aria-hidden="true"><use href="#i-left"/></svg></button>' +
      '<div style="text-align:center"><h3 class="cal__month">' + calMonthLabel(y, m) + '</h3>' +
      '<p class="cal__legend"><span class="dot"></span> Shows in East Africa Time</p></div>' +
      '<button class="cal__nav" type="button" data-month="1" aria-label="Next month"><svg aria-hidden="true"><use href="#i-right"/></svg></button>' +
      '</div>';
    html += '<div class="cal__grid">';
    dow.forEach((d) => { html += '<div class="cal__dow">' + d + '</div>'; });
    cells.forEach((c) => {
      const isToday = c.key && c.key === today;
      html += '<div class="cal__cell' + (c.out ? ' is-out' : '') + (isToday ? ' is-today' : '') + '">' +
        '<span class="cal__num">' + c.day + '</span>';
      if (c.events) {
        c.events.slice(0, 2).forEach((ev) => {
          html += '<button class="cal__chip" type="button" data-open="' + ev.id + '" title="' + escapeHtml(ev.title) + ' · ' + escapeHtml(ev.venue) + '">' + escapeHtml(ev.title) + '</button>';
        });
        if (c.events.length > 2) html += '<span class="cal__more">+' + (c.events.length - 2) + ' more</span>';
      }
      html += '</div>';
    });
    html += '</div></div>';
    calEl.innerHTML = html;
  };

  /* ---------- Master render ---------- */
  const render = () => {
    applyFilters();
    const items = state.filtered;

    if (countEl) countEl.textContent = pad(items.length);

    // legend counts (all events, per city)
    $$('[data-city-count]').forEach((el) => {
      const key = el.dataset.cityCount;
      el.textContent = pad(state.events.filter((e) => e.city.toLowerCase() === key).length);
    });

    updateContainer(gridEl, items, buildPoster, state.view === 'grid');
    updateContainer(listEl, items, buildRow, state.view === 'list');
    renderCalendar(items);

    initTilt();
    initDim();

    const none = !state.loading && items.length === 0;
    if (emptyEl) {
      emptyEl.classList.toggle('is-on', none);
      emptyEl.hidden = !none;
    }
    if (viewsEl) viewsEl.style.opacity = none ? '0' : '1';

    if (none) {
      const cityName = state.city === 'all'
        ? 'anywhere'
        : state.city.charAt(0).toUpperCase() + state.city.slice(1);
      if (emptyTitle) emptyTitle.textContent = 'Nothing in the diary — yet';
      if (emptyBody) {
        emptyBody.textContent = state.q
          ? 'No shows match “' + state.q + '” in ' + cityName + '. Try another city or clear the search.'
          : 'No ' + state.when + ' shows in ' + cityName + ' right now. The next one is being programmed.';
      }
    }

    if (hasST) ScrollTrigger.refresh();
  };

  /* ============================================================
     9. Tilt, glare and sibling blur
     ============================================================ */
  const initTilt = () => {
    if (!fine || !hasGSAP) return;
    $$('.poster').forEach((card) => {
      if (card.dataset.tilted) return;
      card.dataset.tilted = '1';
      const inner = card.querySelector('.poster__tilt');
      if (!inner) return;
      const setRX = gsap.quickTo(inner, 'rotationX', { duration: .6, ease: 'power3.out' });
      const setRY = gsap.quickTo(inner, 'rotationY', { duration: .6, ease: 'power3.out' });
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        setRX((0.5 - py) * 9);
        setRY((px - 0.5) * 11);
        inner.style.setProperty('--gx', (px * 100).toFixed(1) + '%');
        inner.style.setProperty('--gy', (py * 100).toFixed(1) + '%');
      }, { passive: true });
      card.addEventListener('pointerleave', () => { setRX(0); setRY(0); });
    });
  };

  const initDim = () => {
    if (!gridEl) return;
    $$('.poster', gridEl).forEach((card) => {
      if (card.dataset.dimmed) return;
      card.dataset.dimmed = '1';
      card.addEventListener('pointerenter', () => {
        $$('.poster', gridEl).forEach((p) => p.classList.toggle('is-dim', p !== card));
      });
      card.addEventListener('pointerleave', () => {
        $$('.poster', gridEl).forEach((p) => p.classList.remove('is-dim'));
      });
    });
  };

  /* ============================================================
     10. Magnetic buttons
     ============================================================ */
  if (fine && hasGSAP) {
    $$('.magnet').forEach((el) => {
      const setX = gsap.quickTo(el, 'x', { duration: .5, ease: 'power3.out' });
      const setY = gsap.quickTo(el, 'y', { duration: .5, ease: 'power3.out' });
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        setX(clamp(dx * .18, -14, 14));
        setY(clamp(dy * .18, -10, 10) - 2);
      }, { passive: true });
      el.addEventListener('pointerleave', () => { setX(0); setY(0); });
    });
  }

  /* ============================================================
     11. .ics generation
     ============================================================ */
  const icsStamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const icsDay = (d) => new Date(d.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  const icsEscape = (s) => String(s || '')
    .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

  const buildICS = (ev) => {
    // no time from the source: the entry is all day
    const allDay = ev.timeKnown === false;
    const start = allDay ? `DTSTART;VALUE=DATE:${icsDay(ev.date)}` : `DTSTART:${icsStamp(ev.date)}`;
    const end = allDay
      ? `DTEND;VALUE=DATE:${icsDay(new Date(ev.date.getTime() + 24 * 60 * 60 * 1000))}`
      : `DTEND:${icsStamp(ev.end)}`;
    const description = allDay
      ? 'Lighting design & programming by Mitchell Nungari. Time to be announced.'
      : 'Lighting design & programming by Mitchell Nungari. Doors one hour before the show.';

    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Nungari//Events//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:' + ev.id + '@nungari.netlify.app',
      'DTSTAMP:' + icsStamp(new Date()),
      start,
      end,
      'SUMMARY:' + icsEscape(ev.title),
      'LOCATION:' + icsEscape(ev.venue + ', ' + ev.city + ', Kenya'),
      'DESCRIPTION:' + icsEscape(description),
      'URL:' + icsEscape(ev.ticketUrl),
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');
  };

  const downloadICS = (ev) => {
    const blob = new Blob([buildICS(ev)], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    a.download = ev.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.ics';
    document.body.appendChild(a);
    a.click();
    // The anchor must outlive the click, or Chrome drops the filename.
    setTimeout(() => a.remove(), 0);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  /* ============================================================
     12. Lightbox — cycles through the filtered events only
     ============================================================ */
  const lb = $('#lightbox');
  const lbImage = $('#lbImage');
  const lbCard = $('#lbCard');
  const lbIndex = $('#lbIndex');
  const lbCity = $('#lbCity');
  const lbTitle = $('#lbTitle');
  const lbMeta = $('#lbMeta');
  const lbTime = $('#lbTime');
  const lbTicket = $('#lbTicket');
  const lbFrame = $('#lbFrame');
  let lbIndexNum = 0;
  let lastFocus = null;

  const openLightbox = (id) => {
    if (!lb) return;
    const idx = state.filtered.findIndex((e) => e.id === id);
    if (idx === -1) return;
    lbIndexNum = idx;
    paintLightbox();
    lb.classList.add('is-open');
    lb.setAttribute('aria-hidden', 'false');
    document.body.classList.add('menu-open');
    if (window.MN && window.MN.lenis) window.MN.lenis.stop();
    lastFocus = document.activeElement;
    const close = $('.lb__close', lb);
    if (close) setTimeout(() => close.focus({ preventScroll: true }), 60);
  };

  const closeLightbox = () => {
    if (!lb || !lb.classList.contains('is-open')) return;
    lb.classList.remove('is-open');
    lb.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('menu-open');
    if (window.MN && window.MN.lenis) window.MN.lenis.start();
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  };

  const stepLightbox = (dir) => {
    if (!state.filtered.length) return;
    lbIndexNum = (lbIndexNum + dir + state.filtered.length) % state.filtered.length;
    paintLightbox();
  };

  const paintLightbox = () => {
    const ev = state.filtered[lbIndexNum];
    if (!ev) return;
    const p = parts(ev);
    if (ev.poster) {
      lbImage.src = ev.poster;
      lbImage.alt = ev.title + ' poster';
      lbImage.hidden = false;
      lbCard.hidden = true;
    } else {
      lbImage.hidden = true;
      lbCard.hidden = false;
      lbCard.dataset.city = ev.city;
      const city = $('.citycard__city', lbCard);
      const title = $('.citycard__title', lbCard);
      if (city) city.textContent = ev.city;
      if (title) title.textContent = ev.title;
    }
    lbIndex.textContent = pad(lbIndexNum + 1) + ' / ' + pad(state.filtered.length);
    lbCity.textContent = ev.city;
    lbTitle.textContent = ev.title;
    lbMeta.textContent = ev.venue + (ev.city ? ' · ' + ev.city : '');
    lbTime.textContent = timeLabel(ev) + ' · ' + p.day + ' ' + p.mon + ' ' + p.year;
    lbTicket.href = ev.ticketUrl || '#';
    lb.dataset.id = ev.id;
  };

  if (lb) {
    lb.addEventListener('click', (e) => {
      const open = e.target.closest('[data-open]');
      if (open) { openLightbox(open.dataset.open); return; }
      if (e.target.closest('[data-close]')) closeLightbox();
    });
    const prev = $('#lbPrev');
    const next = $('#lbNext');
    if (prev) prev.addEventListener('click', () => stepLightbox(-1));
    if (next) next.addEventListener('click', () => stepLightbox(1));
    const icsBtn = $('#lbIcs');
    if (icsBtn) {
      icsBtn.addEventListener('click', () => {
        const ev = state.filtered[lbIndexNum];
        if (ev) downloadICS(ev);
      });
    }

    // swipe
    let sx = null;
    if (lbFrame) {
      lbFrame.addEventListener('pointerdown', (e) => { sx = e.clientX; }, { passive: true });
      lbFrame.addEventListener('pointerup', (e) => {
        if (sx === null) return;
        const dx = e.clientX - sx;
        sx = null;
        if (Math.abs(dx) > 48) stepLightbox(dx < 0 ? 1 : -1);
      });
    }
  }

  /* global delegation: posters, list rows, calendar chips, ics buttons */
  document.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    if (open) { openLightbox(open.dataset.open); return; }
    const ics = e.target.closest('[data-ics]');
    if (ics) {
      const ev = state.events.find((x) => x.id === ics.dataset.ics);
      if (ev) downloadICS(ev);
      return;
    }
    const month = e.target.closest('[data-month]');
    if (month) {
      const dir = Number(month.dataset.month);
      const cur = state.month || { y: new Date().getFullYear(), m: new Date().getMonth() + 1 };
      let y = cur.y, m = cur.m + dir;
      if (m < 1) { m = 12; y -= 1; }
      if (m > 12) { m = 1; y += 1; }
      state.month = { y, m };
      state.monthManual = true;
      renderCalendar(state.filtered);
      return;
    }
  });

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (lb && lb.classList.contains('is-open')) {
      if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); stepLightbox(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stepLightbox(-1); }
    }
  });

  /* ============================================================
     13. Map pins
     ============================================================ */
  const mapStage = $('.map__stage');
  const mapSvg = $('.map__svg');

  // Narrow screens zoom the map in — the strip keeps its shape, the land fills it.
  const setMapViewBox = () => {
    if (!mapSvg) return;
    const vb = window.innerWidth <= 640 ? '230 30 740 330' : '0 0 1000 380';
    if (mapSvg.getAttribute('viewBox') !== vb) mapSvg.setAttribute('viewBox', vb);
  };

  // The labels live in HTML so they stay crisp at any size; they are
  // positioned from the SVG's own viewBox so they never drift from the pins.
  const positionMapLabels = () => {
    if (!mapStage || !mapSvg) return;
    setMapViewBox();
    const sr = mapStage.getBoundingClientRect();
    if (!sr.width || !sr.height) return;
    const vb = mapSvg.viewBox && mapSvg.viewBox.baseVal;
    const vw = vb && vb.width ? vb.width : 1000;
    const vh = vb && vb.height ? vb.height : 380;
    const vx = vb ? vb.x : 0;
    const vy = vb ? vb.y : 0;
    const scale = Math.min(sr.width / vw, sr.height / vh);
    const offX = (sr.width - vw * scale) / 2 - vx * scale;
    const offY = (sr.height - vh * scale) / 2 - vy * scale;
    $$('.map__label').forEach((el) => {
      const x = parseFloat(el.dataset.x);
      const y = parseFloat(el.dataset.y);
      if (Number.isNaN(x) || Number.isNaN(y)) return;
      el.style.left = (offX + x * scale) + 'px';
      el.style.top = (offY + y * scale) + 'px';
    });
  };
  positionMapLabels();
  window.addEventListener('resize', positionMapLabels);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(positionMapLabels);

  $$('.map__pin, .map__label, .map__legend-btn').forEach((el) => {
    const city = el.dataset.pin || el.dataset.city;
    if (!city) return;
    const go = () => {
      setCity(city);
      const target = $('#lineup');
      if (target) {
        if (window.MN && window.MN.scrollTo) window.MN.scrollTo('#lineup', -20);
        else target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  });

  /* ============================================================
     14. Scroll cues, resize, hash
     ============================================================ */
  $$('[data-scroll]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sel = btn.dataset.scroll;
      if (window.MN && window.MN.scrollTo) window.MN.scrollTo(sel, -20);
      else {
        const el = document.querySelector(sel);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  window.addEventListener('resize', () => {
    moveThumb(whenToggle);
    moveThumb(viewSwitch);
  });

  const hashCity = () => {
    const h = (location.hash || '').replace('#', '').toLowerCase().trim();
    return CITIES.indexOf(h) !== -1 ? h : null;
  };
  window.addEventListener('hashchange', () => {
    const h = hashCity();
    if (h && h !== state.city) setCity(h, { updateHash: false });
  });

  /* ============================================================
     15. Boot
     ============================================================ */
  const skeleton = '<div class="skel"><div class="skel__media"></div><div class="skel__line"></div><div class="skel__line skel__line--short"></div></div>';
  if (gridEl) gridEl.innerHTML = skeleton.repeat(6);

  paintSegment(whenToggle, 'when', state.when);
  paintSegment(viewSwitch, 'view', state.view);
  paintCities();
  moveThumb(whenToggle);
  moveThumb(viewSwitch);

  const initial = hashCity();
  if (initial) state.city = initial;
  paintCities();

  fetchEvents()
    .then((events) => {
      state.events = events;
      state.loading = false;
      if (gridEl) gridEl.innerHTML = '';
      render();
    })
    .catch((err) => {
      state.loading = false;
      console.warn('[events] could not load events', err);
      if (gridEl) gridEl.innerHTML = '';
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.classList.add('is-on');
      }
      if (emptyTitle) emptyTitle.textContent = 'The line-up is offline';
      if (emptyBody) emptyBody.textContent = 'The event feed could not be reached. Try again in a moment.';
      if (viewsEl) viewsEl.style.opacity = '0';
    });
})();
