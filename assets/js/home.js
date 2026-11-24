/* Home — entrance, word reveal, stacking cards, nav spy */
(() => {
  const hasGSAP = !!window.gsap;
  if (!hasGSAP) return;
  const hasST = !!window.ScrollTrigger;

  /* ---------- Hero entrance ---------- */
  const hero = document.querySelector('.hero');
  if (hero) {
    const tl = gsap.timeline({ delay: .12 });
    tl.fromTo('.hero__title .line > span',
      { translateY: '112%' },
      { translateY: '0%', duration: 1.15, ease: 'expo.out', stagger: .1 }, .15)
      .to('.hero [data-intro]', {
        opacity: 1, y: 0, duration: .85, ease: 'power3.out', stagger: .11
      }, .55)
      .fromTo('.hero__aside .btn',
        { y: 14, opacity: 0 },
        { y: 0, opacity: 1, duration: .7, stagger: .08, ease: 'power3.out' }, .95);
  }

  /* ---------- Word reveal ---------- */
  const statement = document.querySelector('[data-words]');
  if (statement) {
    const raw = statement.textContent.trim().replace(/\s+/g, ' ');
    statement.innerHTML = raw.split(' ').map((word) => `<span class="word">${word}</span>`).join(' ');
    const words = statement.querySelectorAll('.word');
    if (hasST) {
      gsap.to(words, {
        opacity: 1,
        ease: 'none',
        stagger: .09,
        scrollTrigger: {
          trigger: statement,
          start: 'top 80%',
          end: 'bottom 58%',
          scrub: .55
        }
      });
    } else {
      gsap.set(words, { opacity: 1 });
    }
  }

  /* ---------- Intro image drift ---------- */
  if (hasST) {
    gsap.fromTo('.intro__frame img',
      { yPercent: -4, scale: 1.02 },
      {
        yPercent: 4, scale: 1.02, ease: 'none',
        scrollTrigger: { trigger: '.intro__frame', start: 'top bottom', end: 'bottom top', scrub: true }
      });
  }

  /* ---------- About photo stack ---------- */
  // Timing: how long a card rests at the front, then how long the move takes.
  const HOLD_MS = 5500;
  const TRANSITION_S = 1.6;
  const aboutStack = document.getElementById('aboutStack');
  if (aboutStack) {
    const cards = [...aboutStack.querySelectorAll('.about__card')];
    const n = cards.length;
    // Slot 0 is the front card, slot 2 the one at the back of the deck.
    // The cards behind sit straight above the front one — no sideways shift
    // and no turn — so their tops form even steps. The scale shrink pulls
    // each card's top down by (1 - scale) / 2 of its height, which is why
    // the offsets are a little larger than the visible step.
    const SLOTS = [
      { x: 0, y: 0, s: 1, ry: 0, z: 0, dim: 0 },
      { x: 0, y: -8, s: 0.94, ry: 0, z: -20, dim: 0.3 },
      { x: 0, y: -16, s: 0.88, ry: 0, z: -40, dim: 0.55 }
    ];
    const lerp = (a, b, t) => a + (b - a) * t;
    const state = { rot: 0, live: true };
    let tween = null;
    let hold = null;
    let hovered = false;
    let visible = false;
    const canHover = !!(window.matchMedia && window.matchMedia('(hover:hover) and (pointer:fine)').matches);
    const lastDim = cards.map(() => -1);

    // Every card is drawn from its distance behind the front of the deck, so
    // the rotation can keep going for ever without a jump at the wrap.
    const paint = () => {
      const ps = cards.map((_, i) => (((i - state.rot) % n) + n) % n);
      const zs = ps.map((p) => {
        const a = Math.floor(p) % n;
        return lerp(SLOTS[a].z, SLOTS[(a + 1) % n].z, p - Math.floor(p));
      });
      // The card closest to the viewer is the one with the greatest depth.
      const order = zs.map((z, i) => i).sort((a, b) => zs[b] - zs[a]);
      const rank = new Array(n);
      order.forEach((idx, r) => { rank[idx] = n - r; });
      cards.forEach((card, i) => {
        const p = ps[i];
        const a = Math.floor(p) % n;
        const b = (a + 1) % n;
        const t = p - Math.floor(p);
        const A = SLOTS[a];
        const B = SLOTS[b];
        gsap.set(card, {
          xPercent: lerp(A.x, B.x, t),
          yPercent: lerp(A.y, B.y, t),
          scale: lerp(A.s, B.s, t),
          rotateY: lerp(A.ry, B.ry, t),
          z: lerp(A.z, B.z, t)
        });
        card.style.zIndex = rank[i];
        const dim = lerp(A.dim, B.dim, t);
        if (Math.abs(dim - lastDim[i]) > 0.004) {
          card.style.setProperty('--dim', dim.toFixed(3));
          lastDim[i] = dim;
        }
      });
    };

    const sync = () => {
      const paused = state.live && ((canHover && hovered) || !visible);
      // Only the automatic loop waits for the pointer to move away.
      [tween, hold].forEach((item) => {
        if (!item) return;
        if (paused && !item.userDriven) item.pause();
        else item.resume();
      });
    };

    const startHold = () => {
      hold = gsap.delayedCall(HOLD_MS / 1000, () => {
        hold = null;
        step(1);
      });
      sync();
    };

    const step = (dir, user) => {
      if (hold) { hold.kill(); hold = null; }
      if (tween) tween.kill();
      tween = gsap.to(state, {
        rot: state.rot + dir,
        duration: TRANSITION_S,
        ease: 'power2.inOut',
        onUpdate: paint,
        onComplete: () => {
          tween = null;
          if (state.live) startHold();
        }
      });
      tween.userDriven = !!user;
      sync();
    };

    // Keys take over: the automatic loop stops for good.
    const takeOver = (dir) => { state.live = false; step(dir, true); };

    paint();
    startHold();

    aboutStack.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); takeOver(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); takeOver(1); }
    });

    aboutStack.addEventListener('mouseenter', () => { hovered = true; sync(); });
    aboutStack.addEventListener('mouseleave', () => { hovered = false; sync(); });

    // Swipe left / right on touch screens; the loop keeps running.
    let sx = 0;
    let sy = 0;
    let tracking = false;
    aboutStack.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      sx = e.clientX;
      sy = e.clientY;
      tracking = true;
    });
    aboutStack.addEventListener('pointerup', (e) => {
      if (!tracking) return;
      tracking = false;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1, true);
    });
    aboutStack.addEventListener('pointercancel', () => { tracking = false; });

    // Only animate while the stack is on screen.
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        visible = entries[0].isIntersecting;
        sync();
      }, { threshold: 0.15 });
      io.observe(aboutStack);
    } else {
      visible = true;
    }

    // Light cursor tilt, fine pointers only.
    if (canHover) {
      const holder = aboutStack.querySelector('.about__stack');
      if (holder) {
        const tiltX = gsap.quickTo(holder, 'rotationX', { duration: 0.7, ease: 'power3.out' });
        const tiltY = gsap.quickTo(holder, 'rotationY', { duration: 0.7, ease: 'power3.out' });
        aboutStack.addEventListener('mousemove', (e) => {
          const r = aboutStack.getBoundingClientRect();
          const px = (e.clientX - r.left) / r.width - 0.5;
          const py = (e.clientY - r.top) / r.height - 0.5;
          tiltY(px * 7);
          tiltX(-py * 5);
        });
        aboutStack.addEventListener('mouseleave', () => { tiltX(0); tiltY(0); });
      }
    }
  }

  /* ---------- Sticky work cards ---------- */
  const stack = document.getElementById('workStack');
  if (stack && hasST) {
    const cards = [...stack.querySelectorAll('.work-card')];
    const n = cards.length;
    const clamp = (v) => Math.min(1, Math.max(0, v));
    let ticking = false;
    const update = () => {
      ticking = false;
      const r = stack.getBoundingClientRect();
      const p = clamp(-r.top / Math.max(1, r.height - window.innerHeight));
      cards.forEach((card, i) => {
        const target = 1 - (n - 1 - i) * 0.026;
        const t = clamp((p - i / n) / (1 - i / n));
        card.style.transform = `scale(${(1 + (target - 1) * t).toFixed(4)})`;
        // Progress of this card being covered — used by the phone layout
        // to dim the card that is sliding behind.
        card.style.setProperty('--stack-t', t.toFixed(4));
      });
    };
    const request = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', request);
    update();
  }

  /* ---------- Nav spy ---------- */
  const links = [...document.querySelectorAll('.nav__links a[href^="#"]')];
  const sections = links
    .map((a) => document.querySelector(a.getAttribute('href')))
    .filter(Boolean);
  if (sections.length && 'IntersectionObserver' in window) {
    const map = new Map();
    links.forEach((a) => map.set(a.getAttribute('href').slice(1), a));
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        links.forEach((a) => a.classList.remove('is-active'));
        const link = map.get(entry.target.id);
        if (link) link.classList.add('is-active');
      });
    }, { rootMargin: '-38% 0px -56% 0px', threshold: 0 });
    sections.forEach((section) => io.observe(section));

    // Above the first section (in the hero) nothing should stay highlighted.
    const clearInHero = () => {
      if (!sections.length) return;
      if (window.scrollY < sections[0].offsetTop - window.innerHeight * 0.45) {
        links.forEach((a) => a.classList.remove('is-active'));
      }
    };
    window.addEventListener('scroll', clearInHero, { passive: true });
    clearInHero();
  }

  /* ---------- Image load refresh ---------- */
  window.addEventListener('load', () => { if (hasST) ScrollTrigger.refresh(); });
})();
