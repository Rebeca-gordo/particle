(() => {
  // ========= CONFIG =========
  const params = {
    particleCount: 12000,     // sube/baja
    radius: 180,
    baseSize: 1.15,
    cameraRadius: 260,
    cameraHeight: 140,
    damping: 0.985,
    noise: 0.00055,
    cursorLerp: 0.08,
    influenceNdcRadius: 0.22, // radio de influencia en pantalla (0..1)
    maxForce: 0.035,          // fuerza max hacia cursor
    swirlBase: 0.018,         // swirl base
    releaseKick: 0.11         // impulso al soltar
  };

  // ========= STATE / UNIFORMS CONTROLADOS POR GSAP =========
  const u = {
    attract: 0,   // 0..1 (click)
    swirl: 0,     // 0..1 (click)
    release: 0,   // 0..1 (al soltar)
    idle: 1       // 0..1 (para bajar movimiento si quieres)
  };

  // ========= DOM =========
  const canvas = document.getElementById("bg");
  if (!canvas) return;

  // ========= THREE GLOBALS =========
  let scene, camera, renderer, points;
  let positions, basePositions, velocities;
  let raycaster, plane;
  const mouseNdc = new THREE.Vector2(0, 0);
  const cursor3D = new THREE.Vector3();
  const targetCursor = new THREE.Vector3();
  let isPointerDown = false;

  // ========= HELPERS: resize al tamaño real del canvas (Webflow-friendly) =========
  function setRendererSize() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);

    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    // DPR adaptativo para no freír GPU
    const area = w * h;
    const isSmall = area < 900 * 300;
    const dpr = window.devicePixelRatio || 1;
    renderer.setPixelRatio(Math.min(dpr, isSmall ? 1 : 1.5));
  }

  // ========= INIT =========
  function init() {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 3000);
    camera.position.set(0, params.cameraHeight, params.cameraRadius);

    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setClearAlpha(0);

    // Color space (r152+)
    if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;

    raycaster = new THREE.Raycaster();
    plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

    createParticles();
    setRendererSize();

    // ResizeObserver (mejor que window.resize en Webflow)
    const ro = new ResizeObserver(() => setRendererSize());
    ro.observe(canvas);

    // Pointer events
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    window.addEventListener("pointercancel", onPointerUp, { passive: true });

    // Start cursor centered
    mouseNdc.set(0, 0);
    raycaster.setFromCamera(mouseNdc, camera);
    raycaster.ray.intersectPlane(plane, targetCursor);
    cursor3D.copy(targetCursor);

    animate();
  }

  // ========= PARTICLES =========
  function createParticles() {
    const count = params.particleCount;

    const geom = new THREE.BufferGeometry();
    positions = new Float32Array(count * 3);
    basePositions = new Float32Array(count * 3);
    velocities = new Float32Array(count * 3);

    // Distribución: esfera compacta
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;

      const r = Math.pow(Math.random(), 0.75) * params.radius;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);

      positions[i3] = x; positions[i3 + 1] = y; positions[i3 + 2] = z;
      basePositions[i3] = x; basePositions[i3 + 1] = y; basePositions[i3 + 2] = z;

      velocities[i3] = 0;
      velocities[i3 + 1] = 0;
      velocities[i3 + 2] = 0;
    }

    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    // Sprite circular hard-edge
    const sprite = document.createElement("canvas");
    sprite.width = 48; sprite.height = 48;
    const ctx = sprite.getContext("2d");
    ctx.clearRect(0, 0, 48, 48);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.arc(24, 24, 18, 0, Math.PI * 2);
    ctx.fill();

    const tex = new THREE.CanvasTexture(sprite);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;

    const mat = new THREE.PointsMaterial({
      size: params.baseSize,
      sizeAttenuation: true,
      map: tex,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false
    });
    mat.alphaTest = 0.05;

    points = new THREE.Points(geom, mat);
    points.frustumCulled = false;
    scene.add(points);
  }

  // ========= INPUT =========
  function onPointerMove(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    mouseNdc.x = x * 2 - 1;
    mouseNdc.y = -(y * 2 - 1);

    raycaster.setFromCamera(mouseNdc, camera);
    raycaster.ray.intersectPlane(plane, targetCursor);
  }

  function onPointerDown() {
    isPointerDown = true;

    // GSAP: entra la atracción (bonito y controlable)
    gsap.killTweensOf(u);
    gsap.to(u, { attract: 1, duration: 0.25, ease: "power2.out" });
    gsap.to(u, { swirl: 1, duration: 0.35, ease: "power2.out" });
    gsap.to(u, { release: 0, duration: 0.2, ease: "power2.out" });
  }

  function onPointerUp() {
    isPointerDown = false;

    // GSAP: suelta y “explosión” suave
    gsap.killTweensOf(u);
    gsap.to(u, { attract: 0, duration: 0.35, ease: "power2.out" });
    gsap.to(u, { swirl: 0, duration: 0.55, ease: "power2.out" });

    // release sube rápido y cae (impulso)
    u.release = 1;
    gsap.to(u, { release: 0, duration: 0.9, ease: "power3.out" });
  }

  // ========= LOOP =========
  const tmpV = new THREE.Vector3();
  const tmpN = new THREE.Vector3();
  let t = 0;

  function animate() {
    requestAnimationFrame(animate);
    t += 0.01;

    // Cámara: orbit lento para vida
    const ang = t * 0.08;
    camera.position.x = Math.sin(ang) * params.cameraRadius;
    camera.position.z = Math.cos(ang) * params.cameraRadius;
    camera.position.y = params.cameraHeight;
    camera.lookAt(0, 0, 0);

    // Cursor suavizado
    cursor3D.lerp(targetCursor, params.cursorLerp);

    const posAttr = points.geometry.attributes.position;
    const p = posAttr.array;

    for (let i = 0; i < p.length; i += 3) {
      let x = p[i], y = p[i + 1], z = p[i + 2];
      let vx = velocities[i], vy = velocities[i + 1], vz = velocities[i + 2];

      // Proyecta a NDC para decidir influencia por distancia en pantalla
      tmpV.set(x, y, z);
      tmpN.copy(tmpV).project(camera);

      const sd = Math.hypot(tmpN.x - mouseNdc.x, tmpN.y - mouseNdc.y);
      const infl = Math.max(0, 1 - Math.min(sd / params.influenceNdcRadius, 1));

      // Idle noise (barato)
      vx += (Math.random() - 0.5) * params.noise;
      vy += (Math.random() - 0.5) * params.noise;
      vz += (Math.random() - 0.5) * params.noise;

      // Atracción (con GSAP u.attract)
      if (u.attract > 0.001 && infl > 0.001) {
        const dx = cursor3D.x - x;
        const dy = cursor3D.y - y;
        const dz = cursor3D.z - z;

        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6;
        const pull = params.maxForce * u.attract * (infl * infl);

        vx += (dx / dist) * pull;
        vy += (dy / dist) * pull;
        vz += (dz / dist) * pull;

        // Swirl (tangente)
        if (u.swirl > 0.001) {
          // tangente simple alrededor del vector hacia cursor
          const sx = -dy;
          const sy = dx;
          const swirl = params.swirlBase * u.swirl * (infl * infl);

          vx += (sx / (dist + 1e-6)) * swirl;
          vy += (sy / (dist + 1e-6)) * swirl;
        }
      }

      // Release kick (al soltar)
      if (u.release > 0.001) {
        // empuja desde el cursor hacia afuera
        const rx = x - cursor3D.x;
        const ry = y - cursor3D.y;
        const rz = z - cursor3D.z;
        const rd = Math.sqrt(rx * rx + ry * ry + rz * rz) + 1e-6;

        const kick = params.releaseKick * u.release * (0.6 + Math.random() * 0.6);
        vx += (rx / rd) * kick;
        vy += (ry / rd) * kick;
        vz += (rz / rd) * kick;
      }

      // Damping
      vx *= params.damping; vy *= params.damping; vz *= params.damping;

      // Integración
      x += vx; y += vy; z += vz;

      // Bound suave: vuelve hacia dentro si se va demasiado lejos
      const len = Math.sqrt(x * x + y * y + z * z);
      if (len > params.radius * 1.25) {
        const k = (params.radius * 1.25) / (len + 1e-6);
        x *= k; y *= k; z *= k;
        vx *= 0.4; vy *= 0.4; vz *= 0.4;
      }

      p[i] = x; p[i + 1] = y; p[i + 2] = z;
      velocities[i] = vx; velocities[i + 1] = vy; velocities[i + 2] = vz;
    }

    posAttr.needsUpdate = true;
    renderer.render(scene, camera);
  }

  // ========= START =========
  function startWhenReady() {
    if (typeof THREE === "undefined" || typeof gsap === "undefined") {
      console.warn("Missing THREE or GSAP");
      return;
    }
    init();
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", startWhenReady);
  } else {
    startWhenReady();
  }
})();
