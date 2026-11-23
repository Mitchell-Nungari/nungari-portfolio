/* ============================================================
   Admin — the event desk
   Talks to /.netlify/functions/admin with a short-lived HMAC token.
   ============================================================ */
(() => {
  const hasGSAP = !!window.gsap;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const pad = (n) => String(n).padStart(2, '0');

  const ENDPOINT = '/.netlify/functions/admin';
  const TOKEN_KEY = 'nungari-admin-token';
  const CITIES = ['Nairobi', 'Mombasa', 'Diani'];

  const state = {
    token: sessionStorage.getItem(TOKEN_KEY) || '',
    expiresAt: 0,
    tab: 'pending',
    pending: [],
    approved: [],
    rejected: []
  };

  /* ---------------------------------------------------------------- */
  /* Small helpers                                                     */
  /* ---------------------------------------------------------------- */

  const toast = (message, isError) => {
    const box = $('#toast');
    if (!box) return;
    const item = document.createElement('div');
    item.className = 'toast__item' + (isError ? ' is-error' : '');
    item.textContent = message;
    box.appendChild(item);
    if (hasGSAP) {
      gsap.fromTo(item, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: .4, ease: 'power3.out' });
      gsap.to(item, { opacity: 0, y: -8, duration: .35, delay: 2.6, ease: 'power2.in', onComplete: () => item.remove() });
    } else {
      setTimeout(() => item.remove(), 3200);
    }
  };

  const api = async (action, body, method = 'POST') => {
    const res = await fetch(`${ENDPOINT}?action=${encodeURIComponent(action)}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(state.token ? { 'x-admin-token': state.token } : {})
      },
      body: method === 'POST' ? JSON.stringify(body || {}) : undefined
    });

    let payload = {};
    try {
      payload = await res.json();
    } catch {
      payload = {};
    }
    if (!res.ok) {
      const error = new Error(payload.error || `HTTP ${res.status}`);
      error.status = res.status;
      error.code = payload.code;
      throw error;
    }
    return payload;
  };

  const dateInputValue = (iso) => {
    if (!iso) return '';
    const match = String(iso).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
    return match ? `${match[1]}T${match[2]}` : '';
  };

  const dateFromInput = (value) => {
    if (!value) return '';
    const d = new Date(`${value}:00+03:00`);
    if (Number.isNaN(d.getTime())) return '';
    const iso = new Date(d.getTime() + 3 * 60 * 60 * 1000).toISOString();
    return `${iso.slice(0, 19)}+03:00`;
  };

  const prettyDate = (iso) => {
    if (!iso) return 'No date';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'No date';
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', year: 'numeric'
    }).format(d);
  };

  /* ---------------------------------------------------------------- */
  /* View switching                                                    */
  /* ---------------------------------------------------------------- */

  const showDesk = (on) => {
    const login = $('#loginView');
    const desk = $('#deskView');
    if (!login || !desk) return;
    login.hidden = on;
    desk.hidden = !on;
    const signOut = $('#signOut');
    if (signOut) signOut.hidden = !on;
    const info = $('#sessionInfo');
    if (info) info.textContent = on ? 'Signed in' : 'Not signed in';
  };

  const showLogin = () => {
    state.token = '';
    sessionStorage.removeItem(TOKEN_KEY);
    showDesk(false);
    const password = $('#password');
    if (password) password.value = '';
  };

  /* ---------------------------------------------------------------- */
  /* Rendering                                                         */
  /* ---------------------------------------------------------------- */

  const posterMarkup = (event, cls) => {
    if (event.poster) {
      return `<img src="${escapeHtml(event.poster)}" alt="" loading="lazy" decoding="async" />`;
    }
    return `<span class="citycard" data-city="${escapeHtml(event.city)}" aria-hidden="true">
      <span class="citycard__city">${escapeHtml(event.city)}</span>
      <span class="citycard__rule"></span>
      <span class="citycard__title">${escapeHtml(event.title)}</span>
    </span>`;
  };

  const eventCard = (event, list) => {
    const id = escapeHtml(event.id);
    const source = event.sourceUrl
      ? `<a class="ev__source" href="${escapeHtml(event.sourceUrl)}" target="_blank" rel="noopener">Source ↗</a>`
      : '<span class="ev__source">Manual</span>';

    const cityOptions = CITIES.map((city) =>
      `<option value="${city}"${city === event.city ? ' selected' : ''}>${city}</option>`).join('');

    const actions = list === 'pending'
      ? `<button class="btn btn--solid" type="button" data-action="approve">Approve</button>
         <button class="btn btn--glass" type="button" data-action="reject">Reject</button>
         <button class="btn btn--glass" type="button" data-action="save">Save</button>
         <button class="btn btn--ghost btn--danger" type="button" data-action="delete">Delete</button>`
      : `<button class="btn btn--glass" type="button" data-action="save">Save</button>
         <button class="btn btn--ghost btn--danger" type="button" data-action="delete">Delete</button>`;

    return `
      <article class="ev" data-id="${id}" data-list="${list}">
        <div class="ev__media">${posterMarkup(event)}</div>
        <div class="ev__body">
          <div class="ev__top">
            <span class="label">${escapeHtml(event.city || '')} <span class="sep">·</span> ${escapeHtml(prettyDate(event.date))} <span class="sep">·</span> ${escapeHtml(event.source || 'manual')}</span>
            ${source}
          </div>
          <div class="ev__grid">
            <div class="field field--wide ev__title-field">
              <label>Title</label>
              <input type="text" data-key="title" value="${escapeHtml(event.title || '')}" />
            </div>
            <div class="field field--wide">
              <label>Date (EAT)</label>
              <input type="datetime-local" data-key="date" value="${dateInputValue(event.date)}" />
            </div>
            <div class="field">
              <label>Venue</label>
              <input type="text" data-key="venue" value="${escapeHtml(event.venue || '')}" />
            </div>
            <div class="field">
              <label>City</label>
              <select data-key="city">${cityOptions}</select>
            </div>
            <div class="field">
              <label>Ticket URL</label>
              <input type="url" data-key="ticketUrl" value="${escapeHtml(event.ticketUrl || '')}" placeholder="https://" />
            </div>
            <div class="field field--wide">
              <label>Source URL</label>
              <input type="url" data-key="sourceUrl" value="${escapeHtml(event.sourceUrl || '')}" placeholder="https://" />
            </div>
            <div class="field field--wide">
              <label>Poster (optional)</label>
              <div class="poster-input">
                <input type="text" data-key="poster" value="${escapeHtml(event.poster || '')}" placeholder="Paste a URL" />
                <label class="btn btn--glass btn--file">Upload<input type="file" accept="image/*" data-upload></label>
                <button class="ev__clear" type="button" data-action="clear-poster">Clear</button>
              </div>
            </div>
          </div>
          <div class="ev__reject">
            <input type="text" data-reason placeholder="Why is this being rejected?" />
            <button class="btn btn--solid" type="button" data-action="reject-confirm">Confirm</button>
            <button class="btn btn--glass" type="button" data-action="reject-cancel">Cancel</button>
          </div>
          <div class="ev__actions">${actions}</div>
        </div>
      </article>`;
  };

  const emptyNote = (title, body) => `
    <div class="empty-note">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(body)}</p>
    </div>`;

  const render = () => {
    const panel = $('#panel');
    if (!panel) return;

    $('#countPending').textContent = pad(state.pending.length);
    $('#countApproved').textContent = pad(state.approved.length);
    $('#countRejected').textContent = pad(state.rejected.length);

    const list = state[state.tab] || [];
    let html = '';

    if (state.tab === 'pending') {
      html = list.length
        ? list.map((event) => eventCard(event, 'pending')).join('')
        : emptyNote('Nothing waiting', 'Discovered events land here. Run the daily discovery, or add an event by hand.');
    } else if (state.tab === 'approved') {
      html = list.length
        ? list.map((event) => eventCard(event, 'approved')).join('')
        : emptyNote('Nothing approved yet', 'Approved events show up on the events page straight away.');
      html += `<article class="ev ev--new" data-new="1">
        <div class="ev__media">Add</div>
        <div class="ev__body">
          <div class="ev__top"><span class="label">Manual event</span><span class="ev__source">Source · manual</span></div>
          <div class="ev__grid">
            <div class="field field--wide ev__title-field"><label>Title</label><input type="text" data-key="title" placeholder="Event name" /></div>
            <div class="field"><label>Date (EAT)</label><input type="datetime-local" data-key="date" /></div>
            <div class="field field--wide">
              <label>Venue</label>
              <input type="text" data-key="venue" placeholder="Venue" />
            </div>
            <div class="field">
              <label>City</label>
              <select data-key="city">${CITIES.map((c) => `<option value="${c}">${c}</option>`).join('')}</select>
            </div>
            <div class="field">
              <label>Date (EAT)</label>
              <input type="datetime-local" data-key="date" />
            </div>
            <div class="field"><label>Ticket URL</label><input type="url" data-key="ticketUrl" placeholder="https://" /></div>
            <div class="field field--wide"><label>Source URL</label><input type="url" data-key="sourceUrl" placeholder="https://" /></div>
            <div class="field field--wide"><label>Poster (optional)</label>
              <div class="poster-input">
                <input type="text" data-key="poster" placeholder="Paste a URL" />
                <label class="btn btn--glass btn--file">Upload<input type="file" accept="image/*" data-upload></label>
              </div>
            </div>
          </div>
          <div class="ev__actions"><button class="btn btn--solid" type="button" data-action="add">Add event</button></div>
        </div>
      </article>`;
    } else {
      html = list.length
        ? list.map((entry) => eventCard(entry.event || {}, 'rejected')).join('')
        : emptyNote('Nothing rejected', 'Rejected events are remembered and never proposed again.');
    }

    panel.innerHTML = html;

    if (hasGSAP) {
      const cards = $$('.ev', panel);
      if (cards.length) {
        gsap.fromTo(cards,
          { opacity: 0, y: 22 },
          { opacity: 1, y: 0, duration: .55, stagger: .045, ease: 'power3.out', clearProps: 'transform' });
      }
    }
  };

  /* ---------------------------------------------------------------- */
  /* Loading                                                           */
  /* ---------------------------------------------------------------- */

  const load = async () => {
    try {
      const data = await api('list', null, 'GET');
      state.pending = data.pending || [];
      state.approved = data.approved || [];
      state.rejected = data.rejected || [];
      state.expiresAt = data.expiresAt || 0;
      render();
    } catch (err) {
      if (err.status === 401) {
        toast('Session expired — sign in again', true);
        showLogin();
        return;
      }
      toast(err.message || 'Could not load the diary', true);
    }
  };

  /* ---------------------------------------------------------------- */
  /* Card actions                                                      */
  /* ---------------------------------------------------------------- */

  const readCard = (card) => {
    const values = {};
    $$('[data-key]', card).forEach((input) => {
      values[input.dataset.key] = input.value;
    });
    values.date = dateFromInput(values.date);
    return values;
  };

  const setPoster = (card, url) => {
    const input = $('[data-key="poster"]', card);
    if (input) input.value = url;
    const media = $('.ev__media', card);
    if (!media) return;
    if (url) {
      media.innerHTML = `<img src="${escapeHtml(url)}" alt="" />`;
    } else {
      const city = ($('[data-key="city"]', card) || {}).value || 'Nairobi';
      const title = ($('[data-key="title"]', card) || {}).value || '';
      media.innerHTML = `<span class="citycard" data-city="${escapeHtml(city)}" aria-hidden="true">
        <span class="citycard__city">${escapeHtml(city)}</span>
        <span class="citycard__rule"></span>
        <span class="citycard__title">${escapeHtml(title)}</span>
      </span>`;
    }
  };

  const uploadPoster = async (card, file) => {
    if (!file) return;
    toast('Uploading…');
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const base64 = String(dataUrl).split(',')[1] || '';
      const result = await api('upload', {
        filename: file.name,
        contentType: file.type || 'image/jpeg',
        data: base64
      });
      setPoster(card, result.url);
      toast('Poster uploaded — remember to save');
    } catch (err) {
      toast(err.message || 'Upload failed', true);
    }
  };

  const doAction = async (card, action, extra) => {
    const id = card.dataset.id;
    const list = card.dataset.list;

    if (action === 'reject') {
      card.classList.add('is-rejecting');
      const reason = $('[data-reason]', card);
      if (reason) reason.focus();
      return;
    }
    if (action === 'reject-cancel') {
      card.classList.remove('is-rejecting');
      return;
    }
    if (action === 'clear-poster') {
      setPoster(card, '');
      toast('Poster cleared — save to keep it');
      return;
    }
    if (action === 'save') {
      const values = readCard(card);
      try {
        await api('save', { list: list === 'approved' ? 'approved' : 'pending', id, event: values });
        card.classList.add('is-saved');
        toast('Saved');
        await load();
      } catch (err) {
        toast(err.message || 'Could not save', true);
      }
      return;
    }
    if (action === 'approve') {
      try {
        await api('approve', { id });
        toast('Approved — it is live on the site');
        await load();
      } catch (err) {
        toast(err.message || 'Could not approve', true);
      }
      return;
    }
    if (action === 'reject-confirm') {
      const reason = ($('[data-reason]', card) || {}).value || '';
      try {
        await api('reject', { id, reason });
        toast('Rejected — it will not be proposed again');
        await load();
      } catch (err) {
        toast(err.message || 'Could not reject', true);
      }
      return;
    }
    if (action === 'delete') {
      try {
        await api('delete', { list: list === 'approved' ? 'approved' : 'pending', id });
        toast('Deleted');
        await load();
      } catch (err) {
        toast(err.message || 'Could not delete', true);
      }
      return;
    }
    if (action === 'add') {
      const values = readCard(card);
      try {
        await api('add', { event: values });
        toast('Event added');
        await load();
      } catch (err) {
        toast(err.message || 'Could not add the event', true);
      }
    }
  };

  /* ---------------------------------------------------------------- */
  /* Wiring                                                            */
  /* ---------------------------------------------------------------- */

  const loginForm = $('#loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = $('#password').value;
      const error = $('#loginError');
      if (error) error.textContent = '';
      try {
        const result = await api('login', { password });
        state.token = result.token;
        state.expiresAt = result.expiresAt || 0;
        sessionStorage.setItem(TOKEN_KEY, state.token);
        showDesk(true);
        toast('Signed in');
        await load();
      } catch (err) {
        if (error) error.textContent = err.message || 'Could not sign in';
      }
    });
  }

  const signOut = $('#signOut');
  if (signOut) signOut.addEventListener('click', showLogin);

  const refresh = $('#refreshBtn');
  if (refresh) refresh.addEventListener('click', load);

  const addBtn = $('#addBtn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      state.tab = 'approved';
      $$('.tab').forEach((tab) => {
        const on = tab.dataset.tab === 'approved';
        tab.classList.toggle('is-active', on);
        tab.setAttribute('aria-pressed', String(on));
      });
      render();
      const card = $('.ev--new');
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const title = $('[data-key="title"]', card);
        if (title) title.focus();
      }
    });
  }

  const tabs = $('#tabs');
  if (tabs) {
    tabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      state.tab = tab.dataset.tab;
      $$('.tab', tabs).forEach((other) => {
        const on = other === tab;
        other.classList.toggle('is-active', on);
        other.setAttribute('aria-pressed', String(on));
      });
      render();
    });
  }

  const panel = $('#panel');
  if (panel) {
    panel.addEventListener('click', (e) => {
      const button = e.target.closest('[data-action]');
      if (!button) return;
      const card = button.closest('.ev');
      if (!card) return;
      doAction(card, button.dataset.action);
    });

    panel.addEventListener('change', (e) => {
      const upload = e.target.closest('[data-upload]');
      if (!upload) return;
      const card = upload.closest('.ev');
      if (card) uploadPoster(card, upload.files && upload.files[0]);
    });

    panel.addEventListener('input', (e) => {
      if (e.target.matches('[data-key="city"], [data-key="title"]')) {
        const card = e.target.closest('.ev');
        if (!card) return;
        const media = $('.ev__media', card);
        const city = ($('[data-key="city"]', card) || {}).value || 'Nairobi';
        const title = ($('[data-key="title"]', card) || {}).value || '';
        const card$ = $('.citycard', media);
        if (card$) {
          card$.dataset.city = city;
          const name = $('.citycard__city', card$);
          const headline = $('.citycard__title', card$);
          if (name) name.textContent = city;
          if (headline) headline.textContent = title;
        }
      }
    });
  }

  /* ---- boot ---- */
  if (state.token) {
    showDesk(true);
    load();
  } else {
    showDesk(false);
  }

  if (hasGSAP) {
    gsap.fromTo('.login__card', { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: .8, ease: 'power3.out' });
    gsap.fromTo('.admin__top', { opacity: 0, y: -12 }, { opacity: 1, y: 0, duration: .7, ease: 'power3.out' });
  }
})();
