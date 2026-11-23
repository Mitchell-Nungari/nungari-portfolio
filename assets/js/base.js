/* Shared behaviour: Lenis, menu, reveals, nav */
(() => {
  const doc = document.documentElement;
  const body = document.body;
  const hasGSAP = !!window.gsap;
  const hasST = !!(window.gsap && window.ScrollTrigger);

  if (hasGSAP && hasST) gsap.registerPlugin(ScrollTrigger);

  /* ---------- Ambient video + parallax ---------- */
  const ambient = document.querySelector('.ambient__video');
  if (ambient) {
    const play = () => { const p = ambient.play(); if (p && p.catch) p.catch(() => {}); };
    play();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) play(); });
    if (hasST) {
      gsap.fromTo(ambient,
        { yPercent: -4 },
        { yPercent: 4, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: true } });
    }
  }

  /* ---------- Smooth scroll ---------- */
  let lenis = null;
  if (window.Lenis) {
    lenis = new Lenis({
      duration: 1.15,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1.15
    });
    if (hasGSAP) {
      lenis.on('scroll', () => { if (hasST) ScrollTrigger.update(); });
      gsap.ticker.add((time) => lenis.raf(time * 1000));
      gsap.ticker.lagSmoothing(0);
    } else {
      const raf = (time) => { lenis.raf(time); requestAnimationFrame(raf); };
      requestAnimationFrame(raf);
    }
  }

  const lock = (on) => {
    body.classList.toggle('menu-open', on);
    if (lenis) { on ? lenis.stop() : lenis.start(); }
  };

  const scrollToTarget = (target, offset) => {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return;
    const gap = typeof offset === 'number' ? offset : 0;
    if (lenis) lenis.scrollTo(el, { offset: gap, duration: 1.3 });
    else el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /* ---------- Fallback if GSAP failed ---------- */
  if (!hasGSAP) {
    doc.classList.remove('js');
    document.querySelectorAll('.nav__island').forEach((el) => {
      el.style.opacity = '1';
      el.style.transform = 'none';
    });
  }

  /* ---------- Nav entrance + scrolled state ---------- */
  if (hasGSAP) {
    gsap.to('.nav__island', {
      opacity: 1, y: 0, duration: .85, delay: .08, stagger: .07, ease: 'power3.out'
    });
  }
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const nav = document.querySelector('.nav');
      if (nav) nav.classList.toggle('is-scrolled', window.scrollY > 40);
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- Menu ---------- */
  const menu = document.getElementById('menu');
  const burger = document.querySelector('.burger');
  const closeBtn = document.querySelector('.menu__close');
  let menuOpen = false;
  let lastFocus = null;

  if (menu) {
    menu.inert = true;
    const setMenuState = (open) => {
      menuOpen = open;
      menu.inert = !open;
      menu.setAttribute('aria-hidden', String(!open));
      menu.classList.toggle('is-open', open);
      if (burger) burger.setAttribute('aria-expanded', String(open));
      lock(open);
    };

    const openMenu = () => {
      if (menuOpen) return;
      lastFocus = document.activeElement;
      setMenuState(true);
      if (hasGSAP) {
        gsap.killTweensOf(menu);
        gsap.set(menu, { visibility: 'visible', opacity: 1 });
        gsap.fromTo('.menu__link', { y: 48, opacity: 0 }, {
          y: 0, opacity: 1, duration: .8, stagger: .06, delay: .12, ease: 'power3.out', overwrite: true
        });
        gsap.fromTo('.menu__top, .menu__foot', { opacity: 0 }, {
          opacity: 1, duration: .6, delay: .25, stagger: .08, overwrite: true
        });
      }
      const first = menu.querySelector('.menu__link');
      if (first) setTimeout(() => first.focus({ preventScroll: true }), 80);
    };

    const closeMenu = (restoreFocus = true) => {
      if (!menuOpen) return;
      setMenuState(false);
      if (hasGSAP) {
        gsap.to(menu, {
          opacity: 0, duration: .3, ease: 'power2.inOut',
          onComplete: () => gsap.set(menu, { visibility: 'hidden' })
        });
      }
      if (restoreFocus && lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    };

    burger && burger.addEventListener('click', openMenu);
    closeBtn && closeBtn.addEventListener('click', () => closeMenu());

    menu.querySelectorAll('a[href]').forEach((a) => {
      a.addEventListener('click', (e) => {
        const href = a.getAttribute('href');
        if (href && href.startsWith('#')) {
          e.preventDefault();
          closeMenu(false);
          setTimeout(() => scrollToTarget(href), 260);
        } else if (href && !href.startsWith('http') && !a.target) {
          closeMenu(false);
        } else {
          closeMenu(false);
        }
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menuOpen) closeMenu();
      if (e.key === 'Tab' && menuOpen) {
        const focusables = [...menu.querySelectorAll('a[href], button:not([disabled])')].filter((el) => el.offsetParent !== null);
        if (!focusables.length) return;
        const first = focusables[0], last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });

    window.addEventListener('resize', () => { if (menuOpen && window.innerWidth > 1180) closeMenu(false); });
    document.addEventListener('click', (e) => {
      if (menuOpen && e.target.closest('[data-menu-close]')) closeMenu();
    });
  }

  /* ---------- Anchor links ---------- */
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    const href = a.getAttribute('href');
    if (!href || href === '#') return;
    a.addEventListener('click', (e) => {
      const target = document.querySelector(href);
      if (!target) return;
      e.preventDefault();
      scrollToTarget(target);
      if (history.pushState) history.pushState(null, '', href);
    });
  });

  /* ---------- Scroll reveals ---------- */
  if (hasGSAP) {
    const items = gsap.utils.toArray('[data-reveal]');
    if (hasST) {
      items.forEach((el) => {
        gsap.to(el, {
          opacity: 1,
          y: 0,
          duration: .95,
          ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 89%', once: true }
        });
      });
    } else {
      gsap.set(items, { opacity: 1, y: 0 });
    }
  }

  /* ---------- Keep triggers honest after fonts/images ---------- */
  window.addEventListener('load', () => {
    if (hasST) ScrollTrigger.refresh();
  });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { if (hasST) ScrollTrigger.refresh(); });
  }

  /* ---------- Expose ---------- */
  window.MN = {
    lenis,
    scrollTo: scrollToTarget,
    closeMenu: () => { if (menuOpen) closeMenu(); }
  };
})();
