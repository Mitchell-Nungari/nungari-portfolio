/* Three.js stage: truss, moving heads, volumetric beams */
import * as THREE from 'three';

const hero = document.querySelector('.hero');
const canvas = document.getElementById('stageCanvas');

if (hero && canvas) {
  try {
    initStage();
  } catch (err) {
    // The hero's still image remains as the fallback.
    console.warn('[stage] falling back to still', err);
  }
}

function initStage() {
  const mobile = window.matchMedia('(max-width: 760px)').matches;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance'
  });
  renderer.setClearColor(0x050506, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.35 : 1.7));

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x050506, 0.038);

  const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 90);
  camera.position.set(0, 2.35, 11.6);

  /* ---------- shared textures / materials ---------- */
  const glowTexture = makeGlowTexture();
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x24272c, metalness: 0.82, roughness: 0.42 });
  const blackMetal = new THREE.MeshStandardMaterial({ color: 0x111216, metalness: 0.5, roughness: 0.55 });

  const ambient = new THREE.AmbientLight(0x24344a, 1.1);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0x8fbaff, 1.25);
  key.position.set(-4, 7, 4);
  scene.add(key);
  const blue = new THREE.PointLight(0x1198ff, 22, 26, 1.8);
  blue.position.set(0, 3.2, 1.5);
  scene.add(blue);

  /* ---------- floor ---------- */
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(70, 70),
    new THREE.MeshStandardMaterial({ color: 0x070708, roughness: 0.5, metalness: 0.35 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.72;
  scene.add(floor);

  /* ---------- truss ---------- */
  const truss = new THREE.Group();
  scene.add(truss);
  const bar = (a, b, radius = 0.03, mat = darkMetal) => {
    const start = new THREE.Vector3(...a);
    const end = new THREE.Vector3(...b);
    const len = start.distanceTo(end);
    if (!len) return;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 6), mat);
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize());
    truss.add(mesh);
  };

  const TRUSS_Y = 5.45;
  for (const z of [-2.55, -1.65, -0.75]) {
    bar([-9.2, TRUSS_Y, z], [9.2, TRUSS_Y, z], 0.032);
  }
  for (let x = -9; x <= 9.01; x += 1.5) {
    bar([x, TRUSS_Y + 0.34, -2.55], [x + 0.75, TRUSS_Y - 0.28, -1.65], 0.018);
    bar([x + 0.75, TRUSS_Y - 0.28, -1.65], [x + 1.5, TRUSS_Y + 0.34, -2.55], 0.018);
    bar([x, TRUSS_Y + 0.34, -0.75], [x + 0.75, TRUSS_Y - 0.28, -1.65], 0.018);
    bar([x + 0.75, TRUSS_Y - 0.28, -1.65], [x + 1.5, TRUSS_Y + 0.34, -0.75], 0.018);
    bar([x, TRUSS_Y, -2.55], [x, TRUSS_Y, -0.75], 0.016);
  }
  for (const x of [-9.2, 9.2]) {
    bar([x, TRUSS_Y, -2.55], [x, TRUSS_Y - 0.6, -1.65], 0.022);
    bar([x, TRUSS_Y, -0.75], [x, TRUSS_Y - 0.6, -1.65], 0.022);
    bar([x, 5.45, -1.65], [x, 3.4, -1.65], 0.016); // motor drop
  }

  /* ---------- LED points on the truss ---------- */
  const ledCount = 54;
  const ledPositions = new Float32Array(ledCount * 3);
  for (let i = 0; i < ledCount; i++) {
    ledPositions[i * 3] = -9 + (i / (ledCount - 1)) * 18;
    ledPositions[i * 3 + 1] = TRUSS_Y + 0.02;
    ledPositions[i * 3 + 2] = -1.65;
  }
  const ledGeo = new THREE.BufferGeometry();
  ledGeo.setAttribute('position', new THREE.BufferAttribute(ledPositions, 3));
  const leds = new THREE.Points(ledGeo, new THREE.PointsMaterial({
    color: 0x9fd8ff, size: 0.032, transparent: true, opacity: 0.75,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
  }));
  scene.add(leds);

  /* ---------- beams ---------- */
  const beamGeometry = new THREE.CylinderGeometry(0.035, 2.9, 12, 22, 1, true);
  const poolGeometry = new THREE.PlaneGeometry(6.4, 6.4);
  const UP = new THREE.Vector3(0, 1, 0);
  const colors = [0xbfe0ff, 0x1198ff, 0x84c7ff, 0xffbd7a, 0xdcecff, 0x9fd8ff];

  const beamVert = `
    varying vec2 vUv;
    varying vec3 vN;
    varying vec3 vV;
    void main(){
      vUv = uv;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }
  `;
  const beamFrag = `
    uniform vec3 uColor;
    uniform float uOpacity;
    varying vec2 vUv;
    varying vec3 vN;
    varying vec3 vV;
    void main(){
      float facing = pow(abs(dot(normalize(vN), normalize(vV))), 1.45);
      float vertical = pow(clamp(vUv.y, 0.0, 1.0), 1.45);
      float alpha = uOpacity * vertical * (0.16 + 0.94 * facing);
      if (alpha < 0.002) discard;
      gl_FragColor = vec4(uColor, alpha);
      #include <colorspace_fragment>
    }
  `;

  // An even fixture count guarantees every light has a mirror twin.
  const N = mobile ? 10 : 14;
  const PAIR_MAX = N / 2 - 1;             // 0 = innermost pair, grows outward
  const beams = [];
  for (let i = 0; i < N; i++) {
    const baseX = N === 1 ? 0 : -7.4 + (i / (N - 1)) * 14.8;
    const twin = N - 1 - i;                // the fixture mirrored across x = 0
    const pair = Math.min(i, twin);        // both twins share this id
    const side = baseX < 0 ? -1 : 1;       // -1 left of centre, +1 right
    const u = PAIR_MAX > 0 ? pair / PAIR_MAX : 0;   // 0 centre .. 1 outer
    const z = -1.65 + ((pair % 3) - 1) * 0.18;      // twins share a depth
    const color = new THREE.Color(colors[pair % colors.length]);
    const origin = new THREE.Vector3(baseX, TRUSS_Y - 0.44, z);

    const fixture = new THREE.Group();
    fixture.position.set(baseX, TRUSS_Y - 0.12, z);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.32, 12), blackMetal);
    body.position.y = -0.16;
    fixture.add(body);
    const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.022, 5, 14, Math.PI), darkMetal);
    yoke.rotation.x = Math.PI / 2;
    yoke.position.y = -0.02;
    fixture.add(yoke);
    const lens = new THREE.Mesh(
      new THREE.SphereGeometry(0.062, 8, 8),
      new THREE.MeshBasicMaterial({ color, toneMapped: false })
    );
    lens.position.y = -0.35;
    fixture.add(lens);
    scene.add(fixture);

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture, color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true
    }));
    glow.position.copy(origin);
    glow.scale.set(1.25, 1.25, 1);
    glow.renderOrder = 4;
    scene.add(glow);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: color },
        uOpacity: { value: 0 }
      },
      vertexShader: beamVert,
      fragmentShader: beamFrag,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const beam = new THREE.Mesh(beamGeometry, material);
    beam.frustumCulled = false;
    beam.renderOrder = 2;
    scene.add(beam);

    const pool = new THREE.Mesh(poolGeometry, new THREE.MeshBasicMaterial({
      map: glowTexture, color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(baseX, -1.7, -1.6);
    pool.renderOrder = 1;
    scene.add(pool);

    beams.push({
      baseX,
      origin,
      beam,
      material,
      glow,
      pool,
      color,
      side,
      u,
      pair,
      target: new THREE.Vector3(baseX * 0.8, -1.7, -1.6),
      baseOpacity: 0.36 + (pair % 3) * 0.03,
      strikeAt: 260 + pair * 105
    });
  }

  /* ---------- choreography ----------
     The rig is mirrored about world x = 0, the hero's vertical centreline.
     Every fixture has a twin at -baseX with the same depth, the same timing
     and the opposite azimuth, so the light is always symmetrical.
     Four patterns cycle: fan, sweep, cross over the centre, V-pulse.
  */
  const FLOOR_Y = -1.7;
  const PATTERN_DUR = 6.4;            // seconds per pattern
  const BLEND_START = 0.72;           // crossfade into the next pattern

  const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * 2 * x);   // 0 -> 1 -> 0
  const smoothstep = (x) => {
    const c = Math.min(1, Math.max(0, x));
    return c * c * (3 - 2 * c);
  };

  // Each pattern aims one mirror pair at local phase `tau`.
  //   horiz  = sideways travel of the floor pool, positive = away from the
  //            centreline, negative = toward and past it
  //   zdisp  = depth travel of that pool (towards the camera)
  // `u` is 0 for the innermost pair, 1 for the outermost; `a` is how far the
  // fixture sits from the centreline. Every shape is periodic in tau, so the
  // cycle wraps without a jump.
  const PATTERNS = [
    {
      name: 'fan',
      aim: (tau, u) => {
        const open = ease(tau);                       // 0 -> 1 -> 0
        return {
          horiz: open * (0.35 + 1.55 * u),
          zdisp: 3.3 + 0.5 * u
        };
      }
    },
    {
      name: 'sweep',
      aim: (tau, u) => {
        const sweep = -Math.sin(Math.PI * 2 * tau);   // -1 -> 1 -> -1
        const ripple = ease((tau + u * 0.18) % 1);
        return {
          horiz: (0.9 + 0.7 * u) * sweep * (0.72 + 0.28 * ripple),
          zdisp: 3.3 + 0.5 * u + 0.8 * sweep * u
        };
      }
    },
    {
      name: 'cross',
      aim: (tau, u, a) => {
        const x = ease(tau);                          // 0 -> 1 -> 0
        // The further out a fixture sits, the further it throws across, so
        // the two halves trade sides and the outer pair crosses the centre.
        const across = a * (0.15 + 0.95 * x * (0.2 + u));
        return {
          horiz: -across,
          zdisp: 0.5 + 1.6 * u + 0.5 * x
        };
      }
    },
    {
      name: 'v',
      aim: (tau, u) => {
        const pulse = ease((tau * 2) % 1);            // two beats per cycle
        return {
          horiz: (0.15 + 1.6 * u) * (0.45 + 0.55 * pulse),
          zdisp: 2.7 + 0.6 * u + 0.9 * pulse
        };
      }
    }
  ];

  // Aim helper: turns a pattern's aim into a floor point for one fixture.
  // The twin on the other side of the centreline gets the same travel with
  // the opposite sign, so the two are always exact mirrors.
  const aimPoint = new THREE.Vector3();
  const aimBlend = new THREE.Vector3();
  const aimDir = new THREE.Vector3();
  const aimUp = new THREE.Vector3();
  const aimFor = (pattern, tau, u, a, side, origin, out) => {
    const s = pattern.aim(tau, u, a);
    out.set(
      origin.x + side * s.horiz,
      FLOOR_Y,
      origin.z + s.zdisp
    );
    return out;
  };

  /* ---------- haze ---------- */
  const hazeCount = mobile ? 260 : 620;
  const hazePositions = new Float32Array(hazeCount * 3);
  for (let i = 0; i < hazeCount; i++) {
    hazePositions[i * 3] = (Math.random() - 0.5) * 24;
    hazePositions[i * 3 + 1] = -1.5 + Math.random() * 7.5;
    hazePositions[i * 3 + 2] = -7 + Math.random() * 11;
  }
  const hazeGeo = new THREE.BufferGeometry();
  hazeGeo.setAttribute('position', new THREE.BufferAttribute(hazePositions, 3));
  const haze = new THREE.Points(hazeGeo, new THREE.PointsMaterial({
    color: 0x9cc9ff, size: mobile ? 0.026 : 0.021, transparent: true, opacity: 0.32,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
  }));
  scene.add(haze);

  /* ---------- pointer + scroll ---------- */
  let pointerX = 0, pointerY = 0;
  let smoothX = 0, smoothY = 0;
  window.addEventListener('pointermove', (e) => {
    pointerX = (e.clientX / window.innerWidth - 0.5) * 2;
    pointerY = (e.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });

  let scrollP = 0;
  const readScroll = () => {
    scrollP = Math.min(1, Math.max(0, window.scrollY / Math.max(1, window.innerHeight)));
  };
  window.addEventListener('scroll', readScroll, { passive: true });
  readScroll();

  /* ---------- sizing ---------- */
  const resize = () => {
    const w = hero.clientWidth;
    const h = hero.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.35 : 1.7));
    // Let Three.js own the CSS size in explicit pixels. A percentage-sized
    // canvas can fail to composite in Chromium and stays an invisible layer.
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  ro.observe(hero);

  /* ---------- animation ---------- */
  let started = performance.now();
  let raf = 0;
  let visible = true;
  let dead = false;

  // One clock for the whole rig: every beam reads the same phase, so the
  // pattern never drifts out of sync.
  let simTime = 0;
  let lastNow = performance.now();

  const strike = (e) => {
    if (e < 0) return 0;
    if (e < 0.1) return 0;
    if (e < 0.18) return 1;
    if (e < 0.24) return 0.08;
    if (e < 0.34) return 0.94;
    if (e < 0.4) return 0.16;
    return 1;
  };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  const update = (now) => {
    const dt = Math.min(0.05, Math.max(0, (now - lastNow) / 1000));
    lastNow = now;
    simTime += dt;

    const t = simTime;
    const elapsed = now - started;

    smoothX += (pointerX - smoothX) * 0.035;
    smoothY += (pointerY - smoothY) * 0.035;

    // camera: subtle parallax, pull back with scroll
    const camX = smoothX * 0.48;
    const camY = 2.35 + smoothY * 0.18 + scrollP * 0.24;
    const camZ = 11.6 + scrollP * 1.5;
    camera.position.x += (camX - camera.position.x) * 0.04;
    camera.position.y += (camY - camera.position.y) * 0.04;
    camera.position.z += (camZ - camera.position.z) * 0.08;
    camera.lookAt(0, 2.32 + scrollP * 0.14, -1.2);

    // where are we in the pattern cycle?
    const cycle = t / PATTERN_DUR;
    const cycleIndex = Math.floor(cycle);
    const tau = cycle - cycleIndex;
    const pattern = PATTERNS[cycleIndex % PATTERNS.length];
    const nextPattern = PATTERNS[(cycleIndex + 1) % PATTERNS.length];
    const blend = smoothstep((tau - BLEND_START) / (1 - BLEND_START));

    beams.forEach((b) => {
      // Both halves of the rig aim from the same pattern, with mirrored
      // azimuths and identical timing.
      aimFor(pattern, tau, b.u, Math.abs(b.baseX), b.side, b.origin, aimPoint);
      if (blend > 0) {
        aimFor(nextPattern, tau, b.u, Math.abs(b.baseX), b.side, b.origin, aimBlend);
        aimPoint.lerp(aimBlend, blend);
      }
      b.target.lerp(aimPoint, 0.05);

      aimDir.subVectors(b.target, b.origin).normalize();
      b.beam.position.copy(b.origin).addScaledVector(aimDir, 6);
      aimUp.copy(aimDir).negate();
      b.beam.quaternion.setFromUnitVectors(UP, aimUp);

      const on = strike(elapsed - b.strikeAt);
      const pulse = 0.86 + 0.14 * Math.sin(t * 1.15 + b.pair * 0.9);
      const opacity = b.baseOpacity * on * pulse * (0.9 + scrollP * 0.18);
      b.material.uniforms.uOpacity.value = opacity;

      b.glow.position.copy(b.origin);
      b.glow.material.opacity = 0.9 * on * pulse;
      b.pool.position.set(b.target.x, FLOOR_Y, b.target.z);
      b.pool.material.opacity = 0.24 * on * pulse;

      b.glow.updateMatrix();
      // fixture body is deliberately left still: the beam is the story.
    });

    // haze drift
    const hp = haze.geometry.attributes.position;
    const arr = hp.array;
    for (let i = 0; i < hazeCount; i++) {
      arr[i * 3 + 1] += 0.0022 + (i % 5) * 0.0004;
      if (arr[i * 3 + 1] > 6.3) arr[i * 3 + 1] = -1.5;
      arr[i * 3] += Math.sin(t * 0.12 + i) * 0.0006;
    }
    hp.needsUpdate = true;
    haze.material.opacity = 0.24 + Math.sin(t * 0.35) * 0.04;

    leds.material.opacity = 0.5 + Math.sin(t * 1.4) * 0.12;

    renderer.render(scene, camera);
  };

  const loop = (now) => {
    raf = 0;
    if (dead) return;
    try {
      update(now);
    } catch (err) {
      console.error('[stage] loop error', err);
      return;
    }
    if (visible) raf = requestAnimationFrame(loop);
  };

  // Wake the loop and resume from the current time.
  const wake = () => {
    if (!visible || dead) return;
    started = performance.now();
    lastNow = performance.now();
    if (!raf) raf = requestAnimationFrame(loop);
  };

  wake();

  // reveal the canvas after the first rendered frame
  requestAnimationFrame(() => { hero.classList.add('is-live'); });

  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) {
      wake();
    } else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }, { threshold: 0.01 });
  io.observe(hero);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    } else if (visible) {
      wake();
    }
  });

  window.addEventListener('pagehide', () => {
    dead = true;
    if (raf) cancelAnimationFrame(raf);
    ro.disconnect();
    io.disconnect();
    renderer.dispose();
  }, { once: true });

}

function makeGlowTexture() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,.7)');
  g.addColorStop(0.5, 'rgba(255,255,255,.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
