// =========================================================
// ChronoFlow Background Renderer
// Orbital + Eclipse hybrid animated canvas backgrounds
// =========================================================
const Backgrounds = {
  canvas: null,
  ctx: null,
  animId: null,
  config: { mode: 'orbital', intensity: 0.5, speed: 0.3, stars: 200, grid: true, glow: 0.5 },

  init(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.loadConfig();
    this.start();
  },

  resize() {
    if (!this.canvas) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width  = window.innerWidth  * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.canvas.style.width  = window.innerWidth  + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    this.ctx.setTransform(1,0,0,1,0,0);
    this.ctx.scale(dpr, dpr);
  },

  loadConfig() {
    try { const saved = JSON.parse(localStorage.getItem('chronoflow-bg') || '{}'); Object.assign(this.config, saved); } catch {}
  },

  saveConfig() { localStorage.setItem('chronoflow-bg', JSON.stringify(this.config)); },
  setMode(mode)      { this.config.mode = mode;      this.saveConfig(); },
  setIntensity(v)    { this.config.intensity = v;    this.saveConfig(); },
  setSpeed(v)        { this.config.speed = v;        this.saveConfig(); },

  start() {
    this.stop();
    const loop = (time) => { this.draw(time); this.animId = requestAnimationFrame(loop); };
    this.animId = requestAnimationFrame(loop);
  },

  stop() { if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; } },

  draw(time) {
    const ctx = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const t = time * 0.0001 * (this.config.speed || 0.3);
    ctx.clearRect(0, 0, w, h);

    // Base gradient
    const grad = ctx.createRadialGradient(w/2, h/3, 0, w/2, h/2, w);
    grad.addColorStop(0,   '#0a0e1a');
    grad.addColorStop(0.5, '#070a12');
    grad.addColorStop(1,   '#04060a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const intensity = this.config.intensity;
    const mode = this.config.mode;

    // Nebula glow
    if (mode === 'orbital' || mode === 'hybrid') {
      const nebula = ctx.createRadialGradient(
        w/2 + Math.sin(t) * w * 0.15, h/2 + Math.cos(t * 0.7) * h * 0.1, 0,
        w/2, h/2, w * 0.6
      );
      nebula.addColorStop(0,   `rgba(116,240,211,${0.03 * intensity})`);
      nebula.addColorStop(0.5, `rgba(140,166,255,${0.02 * intensity})`);
      nebula.addColorStop(1,   'transparent');
      ctx.fillStyle = nebula;
      ctx.fillRect(0, 0, w, h);
    }

    // Eclipse edge glow
    if (mode === 'eclipse' || mode === 'hybrid') {
      const edge = ctx.createRadialGradient(w/2, h/2, h*0.3, w/2, h/2, h*0.8);
      edge.addColorStop(0,   'transparent');
      edge.addColorStop(0.7, `rgba(167,139,250,${0.04 * intensity})`);
      edge.addColorStop(1,   `rgba(116,240,211,${0.06 * intensity * (this.config.glow||0.5)})`);
      ctx.fillStyle = edge;
      ctx.fillRect(0, 0, w, h);
    }

    // Grid lines
    if (this.config.grid) {
      ctx.strokeStyle = `rgba(140,166,255,${0.03 * intensity})`;
      ctx.lineWidth = 1;
      const gs = 60;
      const ox = (t * 10) % gs;
      for (let x = ox - gs; x < w + gs; x += gs) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
      for (let y = 0; y < h; y += gs)            { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
    }

    // Stars
    const starCount = this.config.stars || 200;
    for (let i = 0; i < starCount; i++) {
      const sx = (Math.sin(i * 137.5) * 0.5 + 0.5) * w;
      const sy = (Math.cos(i * 71.3)  * 0.5 + 0.5) * h;
      const twinkle = Math.sin(t * 2 + i) * 0.5 + 0.5;
      const size    = (Math.sin(i * 23.7) * 0.5 + 0.5) * 1.5 + 0.5;
      ctx.beginPath();
      ctx.arc(sx, sy, size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200,210,255,${0.3 * twinkle * intensity})`;
      ctx.fill();
    }

    // Subtle scanlines
    if (intensity > 0.6) {
      ctx.fillStyle = 'rgba(0,0,0,0.02)';
      for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
    }
  }
};
