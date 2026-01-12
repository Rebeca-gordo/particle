/* particles-webflow.js — Webflow + Three.js + GSAP
   Modo "click + drag" (SIN zoom / SIN explosión al soltar):
   - Pointer DOWN: activa fuerza, el flujo sigue el cursor mientras arrastras
   - Pointer UP: NO hay release kick, solo se desvanece la fuerza y queda movimiento natural
*/
(() => {
  console.log("particles-webflow.js loaded (drag-flow)");

  const params = {
    particleCount: 16000,
    radius: 210,
    baseSize: 1.15,

    cameraRadius: 300,
    cameraHeight: 160,

    // movimiento base
    damping: 0.992,       // persistencia (memoria)
    noise: 0.00018,       // flotación natural

    cursorLerp: 0.12,

    // influencia del brush (cometa)
    brushRadius: 110,     // área afectada alrededor del cursor
    pull: 0.050,          // núcleo denso
    flow: 0.040,          // cola direccional
    swirl: 0.004,         // mínimo (casi nada de remolino circular)
    turbulence: 0.010,    // orgánico

    // límites
    maxRadiusFactor: 1.42,

    // timings GSAP
    downIn: 0.18,         // entrada al hacer click
    upOut: 0.45           // salida al soltar (sin “kick”)
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

  // Brush único que sigue el cursor mientras arrastras
  const brush = {
    pos: new THREE.Vector3(),
    dir: new THREE.Vector3(1, 0, 0), // dirección inicial
    strength: 0,                     // animada por GSAP (0..1)
    isDown: false
  };
  const prevBrushPos = new THREE.Vector3();

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

      const r = Math.pow(Math.random(), 0.75) * params.radius;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      positions[i3]     = r * Math.sin(phi) * Math.cos(theta);
      positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i3 + 2] = r * Math.cos(phi);

      velocities[i3] = velocities[i3 + 1] = velocities[i3 + 2] = 0;
    }

    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    // sprite circular hard-edge
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
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    window.addEventListener("pointercancel", onPointerUp, { passive: true });

    // cursor inicial centrado
    mouseNdc.set(0, 0);
    raycaster.setFromCamera(mouseNdc, camera);
    raycaster.ray.intersectPlane(plane, targetCursor);
    cursor3D.copy(targetCursor);

    brush.pos.copy(cursor3D);
    prevBrushPos.copy(cursor3D);

    animate();
  }

  function updateTargetFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    mouseNdc.x = x * 2 - 1;
    mouseNdc.y = -(y * 2 - 1);

    raycaster.setFromCamera(mouseNdc, camera);
    raycaster.ray.intersectPlane(plane, targetCursor);
  }

  function onPointerMove(e) {
    updateTargetFromEvent(e);
  }

  function onPointerDown(e) {
    updateTargetFromEvent(e);

    brush.isDown = true;

    // fija posición del brush al cursor
    cursor3D.copy(targetCursor);
    brush.pos.copy(cursor3D);
    prevBrushPos.copy(cursor3D);

    // si quieres una dirección inicial hacia la derecha (como tu referencia)
    brush.dir.set(1, 0, 0);

    // entra la fuerza (SIN explosión luego)
    gsap.killTweensOf(brush);
    gsap.to(brush, { strength: 1, duration: params.downIn, ease: "power2.out" });
  }

  function onPointerUp() {
    brush.isDown = false;

    // se desvanece la fuerza, pero NO hay “kick”
    gsap.killTweensOf(brush);
    gsap.to(brush, { strength: 0, duration: params.upOut, ease: "power2.out" });
  }

  let t = 0;

  function animate() {
    requestAnimationFrame(animate);
    t += 0.01;

    // Cámara orbit suave (estética). NO zoom, no cambios bruscos.
    const ang = t * 0.05;
    camera.position.x = Math.sin(ang) * params.cameraRadius;
    camera.position.z = Math.cos(ang) * params.cameraRadius;
    camera.position.y = params.cameraHeight;
    camera.lookAt(0, 0, 0);

    // cursor suavizado
    cursor3D.lerp(targetCursor, params.cursorLerp);

    // mientras arrastras: el brush sigue el cursor + calcula dirección del trazo
    if (brush.isDown) {
      brush.pos.lerp(cursor3D, 0.35);

      const dx = brush.pos.x - prevBrushPos.x;
      const dy = brush.pos.y - prevBrushPos.y;
      const dz = brush.pos.z - prevBrushPos.z;

      // si hay movimiento real, actualiza dirección del flujo según el arrastre
      const dlen = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (dlen > 0.001) {
        brush.dir.set(dx / dlen, dy / dlen, dz / dlen);
      } else {
        // si casi no mueves, sesgo suave a derecha
        brush.dir.lerp(new THREE.Vector3(1, 0, 0), 0.02).normalize();
      }

      prevBrushPos.copy(brush.pos);
    } else {
      // en idle: la dirección se relaja lentamente hacia derecha (opcional)
      brush.dir.lerp(new THREE.Vector3(1, 0, 0), 0.004).normalize();
    }

    const posAttr = points.geometry.attributes.position;
    const p = posAttr.array;

    const R = params.brushRadius;
    const maxR = params.radius * params.maxRadiusFactor;

    for (let i = 0; i < p.length; i += 3) {
      let x = p[i], y = p[i + 1], z = p[i + 2];
      let vx = velocities[i], vy = velocities[i + 1], vz = velocities[i + 2];

      // flotación natural constante
      vx += (Math.random() - 0.5) * params.noise;
      vy += (Math.random() - 0.5) * params.noise;
      vz += (Math.random() - 0.5) * (params.noise * 0.8);

      // efecto brush (solo si hay strength > 0)
      const s = brush.strength;
      if (s > 0.0005) {
        const bx = brush.pos.x, by = brush.pos.y, bz = brush.pos.z;
        const dx = bx - x, dy = by - y, dz = bz - z;
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz) + 1e-6;

        if (dist < R) {
          const influence = 1 - (dist / R);
          const inf2 = influence * influence;

          // 1) Pull al núcleo (compacta)
          const pull = params.pull * s * inf2;
          vx += (dx / dist) * pull;
          vy += (dy / dist) * pull;
          vz += (dz / dist) * pull;

          // 2) Flow direccional (cola según tu arrastre)
          const flow = params.flow * s * inf2;
          vx += brush.dir.x * flow;
          vy += brush.dir.y * flow;
          vz += brush.dir.z * flow;

          // 3) Swirl mínimo (solo textura)
          const swirl = params.swirl * s * inf2;
          vx += (-dy / dist) * swirl;
          vy += ( dx / dist) * swirl;

          // 4) Turbulencia suave
          const turb = params.turbulence * s * inf2;
          vx += (Math.random() - 0.5) * turb;
          vy += (Math.random() - 0.5) * turb;
          vz += (Math.random() - 0.5) * (turb * 0.7);
        }
      }

      // damping (persistencia)
      vx *= params.damping;
      vy *= params.damping;
      vz *= params.damping;

      x += vx; y += vy; z += vz;

      // bound suave
      const len = Math.sqrt(x*x + y*y + z*z);
      if (len > maxR) {
        const sc = maxR / (len + 1e-6);
        x *= sc; y *= sc; z *= sc;
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
