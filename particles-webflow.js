/* particles-webflow.js — Webflow + Three.js + GSAP
   Efecto: cada CLICK crea un vórtice (remolino) en esa zona.
   - No hay zoom global.
   - Puedes ir clicando en diferentes puntos y se generan formas/remolinos.
*/
(() => {
  console.log("particles-webflow.js loaded (multi-vortex)");

  const params = {
    particleCount: 14000,
    radius: 190,
    baseSize: 1.15,

    cameraRadius: 280,
    cameraHeight: 150,

    damping: 0.985,
    noise: 0.00045,
    cursorLerp: 0.1,

    // Vortex behavior
    vortexLifeMs: 1400,       // cuánto dura un vórtice
    vortexMax: 7,             // máximo de vórtices simultáneos
    vortexRadius: 70,         // radio de influencia en mundo
    vortexPull: 0.020,        // atracción al centro del vórtice
    vortexSwirl: 0.060,       // fuerza de remolino
    vortexTurbulence: 0.012,  // jitter/turbulencia extra cerca del vórtice

    // Bound
    maxRadiusFactor: 1.35
  };

  if (typeof THREE === "undefined") {
    console.error("THREE is not loaded. Add three.min.js before this script.");
    return;
  }
  if (typeof gsap === "undefined") {
    console.error("GSAP is not loaded. Add gsap.min.js before this script.");
    return;
  }

  const canvas = document.getElementById("bg");
  if (!canvas) {
    console.error('Canvas #bg not found. Add: <canvas id="bg"></canvas>');
    return;
  }

  let scene, camera, renderer, points;
  let positions, velocities;

  let raycaster, plane;
  const mouseNdc = new THREE.Vector2(0, 0);
  const targetCursor = new THREE.Vector3();
  const cursor3D = new THREE.Vector3();

  // Guardamos múltiples vórtices
  const vortices = []; // { pos: Vector3, strength: number, swirl: number, created: number }

  function setRendererSize() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);

    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    const area = w * h;
    const isSmall = area < 900 * 300;
    const dpr = window.devicePixelRatio || 1;
    renderer.setPixelRatio(Math.min(dpr, isSmall ? 1 : 1.5));
  }

  function createParticles() {
    const count = params.particleCount;
    const geom = new THREE.BufferGeometry();
    positions = new Float32Array(count * 3);
    velocities = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;

      const r = Math.pow(Math.random(), 0.8) * params.radius;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      positions[i3]     = r * Math.sin(phi) * Math.cos(theta);
      positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i3 + 2] = r * Math.cos(phi);

      velocities[i3] = velocities[i3 + 1] = velocities[i3 + 2] = 0;
    }

    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    // hard-edge circle sprite
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
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false
    });
    mat.alphaTest = 0.05;

    points = new THREE.Points(geom, mat);
    points.frustumCulled = false;
    scene.add(points);
  }

  function init() {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 3000);
    camera.position.set(0, params.cameraHeight, params.cameraRadius);

    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setClearAlpha(0);
    if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;

    raycaster = new THREE.Raycaster();
    plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

    createParticles();
    setRendererSize();

    try {
      const ro = new ResizeObserver(() => setRendererSize());
      ro.observe(canvas);
    } catch {
      window.addEventListener("resize", setRendererSize);
    }

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });

    // init cursor en el centro
    mouseNdc.set(0, 0);
    raycaster.setFromCamera(mouseNdc, camera);
    raycaster.ray.intersectPlane(plane, targetCursor);
    cursor3D.copy(targetCursor);

    animate();
  }

  function onPointerMove(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    mouseNdc.x = x * 2 - 1;
    mouseNdc.y = -(y * 2 - 1);

    raycaster.setFromCamera(mouseNdc, camera);
    raycaster.ray.intersectPlane(plane, targetCursor);
  }

  function addVortex(worldPos) {
    // Limita cantidad
    if (vortices.length >= params.vortexMax) vortices.shift();

    const v = {
      pos: worldPos.clone(),
      strength: 0,   // lo animamos con GSAP
      swirl: 0,
      created: performance.now()
    };
    vortices.push(v);

    // Animación: sube rápido, luego cae suave
    gsap.to(v, { strength: 1, duration: 0.18, ease: "power2.out" });
    gsap.to(v, { swirl: 1, duration: 0.22, ease: "power2.out" });

    // fade-out con retraso leve (para que “dibuje”)
    gsap.to(v, {
      strength: 0,
      duration: params.vortexLifeMs / 1000,
      ease: "power3.out",
      delay: 0.05
    });
    gsap.to(v, {
      swirl: 0,
      duration: (params.vortexLifeMs / 1000) * 0.9,
      ease: "power3.out",
      delay: 0.08
    });
  }

  function onPointerDown() {
    // fija el cursor 3D justo en el click
    cursor3D.copy(targetCursor);

    // crea vórtice en esa posición
    addVortex(cursor3D);
  }

  const tmpV = new THREE.Vector3();
  let t = 0;

  function animate() {
    requestAnimationFrame(animate);
    t += 0.01;

    // Cámara con orbit suave (solo estética, no zoom)
    const ang = t * 0.06;
    camera.position.x = Math.sin(ang) * params.cameraRadius;
    camera.position.z = Math.cos(ang) * params.cameraRadius;
    camera.position.y = params.cameraHeight;
    camera.lookAt(0, 0, 0);

    // cursor suavizado (por si quieres usarlo luego)
    cursor3D.lerp(targetCursor, params.cursorLerp);

    // limpia vórtices “muertos”
    for (let i = vortices.length - 1; i >= 0; i--) {
      if (vortices[i].strength <= 0.0005 && vortices[i].swirl <= 0.0005) {
        vortices.splice(i, 1);
      }
    }

    const posAttr = points.geometry.attributes.position;
    const p = posAttr.array;

    for (let i = 0; i < p.length; i += 3) {
      let x = p[i], y = p[i + 1], z = p[i + 2];
      let vx = velocities[i], vy = velocities[i + 1], vz = velocities[i + 2];

      // ruido base (idle)
      vx += (Math.random() - 0.5) * params.noise;
      vy += (Math.random() - 0.5) * params.noise;
      vz += (Math.random() - 0.5) * params.noise;

      // Aplica cada vórtice (local)
      for (let k = 0; k < vortices.length; k++) {
        const v = vortices[k];
        if (v.strength <= 0.0001 && v.swirl <= 0.0001) continue;

        const dx = v.pos.x - x;
        const dy = v.pos.y - y;
        const dz = v.pos.z - z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6;

        // Solo afecta si está cerca del vórtice
        const R = params.vortexRadius;
        if (dist > R) continue;

        // Influencia fuerte cerca, cae hacia el borde
        const influence = 1 - (dist / R);
        const inf2 = influence * influence;

        // Pull hacia el centro (crea “forma”)
        const pull = params.vortexPull * v.strength * inf2;
        vx += (dx / dist) * pull;
        vy += (dy / dist) * pull;
        vz += (dz / dist) * pull;

        // Swirl en el plano XY (remolino alrededor del punto)
        const swirl = params.vortexSwirl * v.swirl * inf2;
        // tangente simple: rota (dx,dy) -> (-dy, dx)
        vx += (-dy / dist) * swirl;
        vy += ( dx / dist) * swirl;

        // Turbulencia adicional cerca del centro para “dibujar” curvas
        const turb = params.vortexTurbulence * v.swirl * inf2;
        vx += (Math.random() - 0.5) * turb;
        vy += (Math.random() - 0.5) * turb;
        vz += (Math.random() - 0.5) * (turb * 0.6);
      }

      // damping
      vx *= params.damping; vy *= params.damping; vz *= params.damping;

      x += vx; y += vy; z += vz;

      // bound suave: mantenemos la nube compacta
      const len = Math.sqrt(x * x + y * y + z * z);
      const maxR = params.radius * params.maxRadiusFactor;
      if (len > maxR) {
        const k = maxR / (len + 1e-6);
        x *= k; y *= k; z *= k;
        vx *= 0.35; vy *= 0.35; vz *= 0.35;
      }

      p[i] = x; p[i + 1] = y; p[i + 2] = z;
      velocities[i] = vx; velocities[i + 1] = vy; velocities[i + 2] = vz;
    }

    posAttr.needsUpdate = true;
    renderer.render(scene, camera);
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

 
     
