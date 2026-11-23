/* Gallery — cue stack, follow spot, grand master, contact sheet */
(() => {
  const hasGSAP = !!window.gsap;
  const hasST = !!(window.gsap && window.ScrollTrigger);
  const coarse = window.matchMedia('(pointer: coarse)').matches;

  const CUES = [
    { ch: '001', name: 'KCB M-Pesa', year: '2015', cat: 'Corporate', slug: 'corporate', src: 'images/site/kcb-mpesa-2015-1000.v1.webp', alt: 'KCB M-Pesa launch with confetti falling over the stage' },
    { ch: '002', name: 'Jameson', year: '2016', cat: 'Clubs', slug: 'clubs', src: 'images/site/jameson-2016-624.v1.webp', alt: 'Jameson event lit in blue and red' },
    { ch: '003', name: 'Diani Beach', year: '2017', cat: 'Festivals', slug: 'festivals', src: 'images/site/diani-beach-2017-682.v1.webp', alt: 'Diani Beach festival stage lit against the night sky' },
    { ch: '004', name: 'Groove Worship', year: '2017', cat: 'Concerts', slug: 'concerts', src: 'images/site/groove-worship-2017-764.v1.webp', alt: 'Groove Worship concert stage with warm side light' },
    { ch: '005', name: 'Jameson', year: '2017', cat: 'Clubs', slug: 'clubs', src: 'images/site/jameson-2017-1000.v1.webp', alt: 'Pink and red stage light over a packed Jameson crowd' },
    { ch: '006', name: 'Jazz Festival', year: '2017', cat: 'Festivals', slug: 'festivals', src: 'images/site/jazz-festival-2017-1280.v1.webp', alt: 'Safaricom Jazz Festival stage with white beams cutting through the night' },
    { ch: '007', name: 'Aretha', year: '2018', cat: 'Concerts', slug: 'concerts', src: 'images/site/aretha-2018-1019.v1.webp', alt: 'Aretha Franklin tribute concert in warm amber light' },
    { ch: '008', name: 'Praise Fest', year: '2018', cat: 'Festivals', slug: 'festivals', src: 'images/site/praise-fest-2018-640.v1.webp', alt: 'Praise Fest congregation under blue and white stage light' },
    { ch: '009', name: 'Luther', year: '2019', cat: 'Concerts', slug: 'concerts', src: 'images/site/luther-2019-1080.v1.webp', alt: 'Luther performing in a yellow suit under warm stage light' }
  ];

  const $ = (sel, root = document) => root.querySelector(sel);
  const pad = (n) => String(n).padStart(2, '0');
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ---------------- Hero entrance ---------------- */
  const hero = $('.gallery-hero');
  if (hero) {
    if (!hasGSAP) {
      document.querySelectorAll('[data-g-intro]').forEach((el) => {
        el.style.opacity = '1';
        el.style.transform = 'none';
      });
      const line = $('.gallery-hero h1 .line > span');
      if (line) line.style.transform = 'none';
      document.querySelectorAll('[data-g-fan] .fan__item').forEach((el) => { el.style.opacity = '1'; });
    } else {
      const tl = gsap.timeline({ delay: 0.12 });
      tl.fromTo('.gallery-hero h1 .line > span',
        { translateY: '112%' },
        { translateY: '0%', duration: 1.15, ease: 'expo.out' }, 0)
        .to('[data-g-intro]', { opacity: 1, y: 0, duration: 0.85, stagger: 0.11, ease: 'power3.out' }, 0.28)
        .to('[data-g-fan] .fan__item', { opacity: 1, duration: 0.8, stagger: 0.1, ease: 'power2.out' }, 0.42)
        .fromTo('[data-g-fan] .fan__item', { y: 34 }, { y: 0, duration: 1.05, stagger: 0.1, ease: 'power3.out' }, 0.42);

      if (hasST) {
        gsap.to('.fan', {
          y: 26,
          ease: 'none',
          scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 1 }
        });
      }
    }
  }

  /* ---------------- Cue console ---------------- */
  const viewer = $('#stageViewer');
  const baseImg = $('#stageBase');
  const spotImg = $('#stageSpot');
  const blackoutEl = $('#stageBlackout');
  const stageCh = $('#stageCh');
  const stageName = $('#stageName');
  const stageCat = $('#stageCat');
  const stageYear = $('#stageYear');
  const hintCh = $('#hintCh');
  const cueButtons = [...document.querySelectorAll('.cue__item')];
  const wallItems = [...document.querySelectorAll('.wall__item')];
  const cueCount = $('#cueCount');
  const gm = $('#gmFader');
  const gmValue = $('#gmValue');
  const wallPin = $('#wallPin');
  const wallViewport = $('#wallViewport');
  const wallTrack = $('#wallTrack');
  const wallProgress = $('#wallProgress');
  const desktop = window.matchMedia('(min-width: 821px)');

  let current = 5;
  let filter = 'all';

  // Warm the cache so a cue change never waits on the network.
  CUES.forEach((cue) => { const img = new Image(); img.src = cue.src; });

  const paintActive = (index) => {
    cueButtons.forEach((b) => {
      const on = Number(b.dataset.index) === index;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    wallItems.forEach((b) => b.classList.toggle('is-current', Number(b.dataset.index) === index));
  };

  const writeCue = (index) => {
    const cue = CUES[index];
    baseImg.src = cue.src;
    baseImg.alt = cue.alt;
    spotImg.src = cue.src;
    stageCh.textContent = cue.ch;
    stageName.textContent = cue.name;
    stageCat.textContent = cue.cat;
    stageYear.textContent = cue.year;
    hintCh.textContent = cue.ch;
  };

  const setCue = (index) => {
    const next = ((index % CUES.length) + CUES.length) % CUES.length;
    current = next;
    paintActive(next);

    if (!hasGSAP) {
      writeCue(next);
      return;
    }
    gsap.killTweensOf(blackoutEl);
    gsap.timeline()
      .to(blackoutEl, { opacity: 1, duration: 0.16, ease: 'power1.in' })
      .add(() => writeCue(next))
      .to(blackoutEl, { opacity: 0, duration: 0.4, ease: 'power2.out' }, '+=0.06');
  };

  const flashBlackout = () => {
    if (!hasGSAP || !blackoutEl) return;
    gsap.killTweensOf(blackoutEl);
    gsap.timeline()
      .to(blackoutEl, { opacity: 1, duration: 0.12, ease: 'power1.in' })
      .to(blackoutEl, { opacity: 0, duration: 0.55, ease: 'power2.out' }, '+=0.12');
  };

  const applyFilter = (cat) => {
    filter = cat;
    let visible = 0;
    cueButtons.forEach((b) => {
      const show = cat === 'all' || b.dataset.cat === cat;
      b.classList.toggle('is-hidden', !show);
      if (show) visible++;
    });
    cueCount.textContent = pad(visible);
    document.querySelectorAll('.filter').forEach((f) => {
      const on = f.dataset.filter === cat;
      f.classList.toggle('is-active', on);
      f.setAttribute('aria-pressed', String(on));
    });
    if (cat !== 'all' && CUES[current].slug !== cat) {
      const first = cueButtons.find((b) => !b.classList.contains('is-hidden'));
      if (first) setCue(Number(first.dataset.index));
    }
    if (hasST) ScrollTrigger.refresh();
  };

  if (viewer) {
    paintActive(current);
    setCue(current);

    cueButtons.forEach((b) => b.addEventListener('click', () => setCue(Number(b.dataset.index))));
    document.querySelectorAll('.filter').forEach((f) => f.addEventListener('click', () => applyFilter(f.dataset.filter)));

    const prev = $('#prevCue');
    const next = $('#nextCue');
    const go = $('#goCue');
    const bo = $('#blackoutBtn');
    if (prev) prev.addEventListener('click', () => setCue(current - 1));
    if (next) next.addEventListener('click', () => setCue(current + 1));
    if (go) go.addEventListener('click', () => setCue(current + 1));
    if (bo) bo.addEventListener('click', flashBlackout);

    wallItems.forEach((b) => {
      b.addEventListener('click', () => {
        setCue(Number(b.dataset.index));
        window.setTimeout(() => {
          if (window.MN && window.MN.scrollTo) window.MN.scrollTo('#cue');
          else {
            const cueSection = document.getElementById('cue');
            if (cueSection) cueSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 90);
      });
    });

    /* ----- Grand master ----- */
    const setGM = (value) => {
      const v = clamp(Number(value) || 0, 0, 100);
      viewer.style.setProperty('--gm', String(v / 100));
      gmValue.textContent = String(Math.round(v));
      gm.style.setProperty('--fill', v + '%');
      gm.value = String(v);
    };
    if (gm) {
      gm.addEventListener('input', () => setGM(gm.value));
      setGM(gm.value);
    }

    /* ----- Follow spot ----- */
    let tx = 50, ty = 44, cx = 50, cy = 44;
    let sweep = coarse;
    let visible = true;
    let sweepTimer = 0;

    const place = () => {
      viewer.style.setProperty('--mx', cx.toFixed(2) + '%');
      viewer.style.setProperty('--my', cy.toFixed(2) + '%');
    };
    place();

    viewer.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' && e.buttons === 0) return;
      const r = viewer.getBoundingClientRect();
      if (!r.width || !r.height) return;
      tx = clamp(((e.clientX - r.left) / r.width) * 100, -4, 104);
      ty = clamp(((e.clientY - r.top) / r.height) * 100, -4, 104);
      sweep = false;
      viewer.classList.remove('is-left');
    }, { passive: true });

    viewer.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'touch') return;
      tx = 50; ty = 44;
      sweep = coarse;
    });

    viewer.addEventListener('pointerup', () => {
      if (!coarse) return;
      window.clearTimeout(sweepTimer);
      sweepTimer = window.setTimeout(() => { sweep = true; }, 2800);
    }, { passive: true });

    const tick = () => {
      if (!visible || document.hidden) return;
      if (sweep) {
        const t = performance.now() / 1000;
        tx = 50 + Math.sin(t * 0.42) * 25;
        ty = 46 + Math.cos(t * 0.31) * 12;
      }
      cx += (tx - cx) * 0.12;
      cy += (ty - cy) * 0.12;
      place();
    };

    if (hasGSAP) {
      gsap.ticker.add(tick);
    } else {
      const loop = () => { tick(); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { threshold: 0.05 });
      io.observe(viewer);
    }

    /* ----- Keyboard control ----- */
    document.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (document.body.classList.contains('menu-open')) return;
      const r = viewer.getBoundingClientRect();
      const inView = r.bottom > 0 && r.top < window.innerHeight;
      if (!inView) return;

      if (e.key === 'ArrowRight') { e.preventDefault(); setCue(current + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setCue(current - 1); }
      else if (e.key === 'g' || e.key === 'G') { e.preventDefault(); setCue(current + 1); }
      else if (e.key === 'b' || e.key === 'B') { e.preventDefault(); flashBlackout(); }
    });

    /* ----- Wall lighting ----- */
    const lightWall = () => {
      if (!wallViewport) return;
      const vr = wallViewport.getBoundingClientRect();
      if (!vr.width) return;
      const center = vr.left + vr.width / 2;
      const span = vr.width * 0.68;
      wallItems.forEach((item) => {
        const image = item.querySelector('img');
        if (!image) return;
        const ir = item.getBoundingClientRect();
        const d = Math.abs(ir.left + ir.width / 2 - center);
        const k = clamp(d / span, 0, 1);
        image.style.filter = `brightness(${(1 - k * 0.38).toFixed(3)}) grayscale(${(k * 0.55).toFixed(3)})`;
        item.style.opacity = String((1 - k * 0.1).toFixed(3));
      });
    };

    if (wallViewport) {
      wallViewport.addEventListener('scroll', lightWall, { passive: true });
      lightWall();
    }

    /* ----- Wall horizontal pin ----- */
    const syncWallMode = () => {
      if (!wallPin) return;
      const native = !hasST || !desktop.matches;
      wallPin.classList.toggle('is-native', native);
      if (native) lightWall();
    };
    syncWallMode();
    if (desktop.addEventListener) desktop.addEventListener('change', syncWallMode);

    if (hasST) {
      const mm = gsap.matchMedia();
      mm.add('(min-width: 821px)', () => {
        const distance = () => Math.max(0, wallTrack.scrollWidth - wallViewport.clientWidth);

        const tween = gsap.to(wallTrack, {
          x: () => -distance(),
          ease: 'none',
          scrollTrigger: {
            trigger: wallPin,
            start: 'top top',
            end: () => '+=' + (distance() + window.innerHeight * 0.35),
            pin: true,
            scrub: 0.6,
            anticipatePin: 1,
            invalidateOnRefresh: true,
            onUpdate: (self) => {
              if (wallProgress) wallProgress.style.width = (self.progress * 100).toFixed(2) + '%';
              lightWall();
            }
          }
        });

        return () => {
          if (tween.scrollTrigger) tween.scrollTrigger.kill();
          tween.kill();
          gsap.set(wallTrack, { x: 0 });
          if (wallProgress) wallProgress.style.width = '0%';
        };
      });
    }

    window.addEventListener('resize', () => {
      if (hasST) ScrollTrigger.refresh();
      lightWall();
    });
  }
})();
