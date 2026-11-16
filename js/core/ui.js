/** DOM HUD + input handling (keyboard, touch pads, pointer on screen halves). */
export class UI {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      score: $('score'), best: $('best'), best2: $('best2'), final: $('final'), newbest: $('newbest'),
      over: $('over'), paused: $('paused'), restart: $('restart'), resume: $('resume'),
      sound: $('sound'), themes: $('themes'), loadbar: $('loadbar'), hint: $('hint'), touch: $('touch'),
    };
    this.lastScore = -1;
    this.handlers = {};
    this.el.restart.addEventListener('click', () => this.emit('restart'));
    this.el.resume.addEventListener('click', () => this.emit('resume'));
    this.el.sound.addEventListener('click', () => this.emit('sound'));
    this.el.themes.addEventListener('click', (e) => {
      const b = e.target.closest('[data-theme]');
      if (b) this.emit('theme', b.dataset.theme);
    });
    // keep focus off buttons so Space never "clicks" them
    document.querySelectorAll('button').forEach((b) => b.addEventListener('mouseup', () => b.blur()));
  }

  on(name, fn) { this.handlers[name] = fn; }
  emit(name, arg) { if (this.handlers[name]) this.handlers[name](arg); }

  setProgress(p) { this.el.loadbar.style.width = `${Math.round(p * 100)}%`; }
  loaded() { document.body.classList.remove('loading'); }

  setScore(n) {
    if (n === this.lastScore) return;
    this.lastScore = n;
    this.el.score.textContent = n;
    if (n > 0 && n % 10 === 0) {
      this.el.score.classList.remove('pop');
      void this.el.score.offsetWidth;
      this.el.score.classList.add('pop');
    }
  }

  setBest(n) {
    this.el.best.textContent = n;
    this.el.best2.textContent = n;
  }

  setTheme(name) {
    this.el.themes.querySelectorAll('[data-theme]').forEach((b) => {
      const on = b.dataset.theme === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.setAttribute('role', 'radio');
    });
  }

  setMuted(m) { this.el.sound.classList.toggle('muted', m); }

  showOver(score, best, isNew) {
    this.el.final.textContent = score;
    this.setBest(best);
    this.el.newbest.hidden = !isNew;
    this.el.over.hidden = false;
    document.body.classList.add('over');
  }

  hideOver() {
    this.el.over.hidden = true;
    document.body.classList.remove('over');
  }

  showPaused(v) { this.el.paused.hidden = !v; }

  setReady(v) { document.body.classList.toggle('ready', v); }

  placeHint(x, y, gap) {
    this.el.hint.style.transform = `translate(${x}px, ${y}px)`;
    this.el.hint.style.setProperty('--hint-gap', `${gap}px`);
  }
}

export class Input {
  constructor(canvas) {
    this.keys = [];        // stack of pressed directions (last wins)
    this.pointers = new Map();
    this.pads = new Map();
    this.handlers = {};
    const dirOf = (k) => {
      switch (k) {
        case 'ArrowLeft': case 'a': case 'A': case 'KeyA': return -1;
        case 'ArrowRight': case 'd': case 'D': case 'KeyD': return 1;
        default: return 0;
      }
    };
    window.addEventListener('keydown', (e) => {
      const d = dirOf(e.key) || dirOf(e.code);
      if (d) {
        e.preventDefault();
        if (!this.keys.includes(d)) this.keys.push(d);
        this.emit('any');
        return;
      }
      if (e.code === 'Space' || e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!e.repeat) this.emit('confirm');
        return;
      }
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') this.emit('pause');
      else if (!e.repeat) this.emit('anykey');
    });
    window.addEventListener('keyup', (e) => {
      const d = dirOf(e.key) || dirOf(e.code);
      if (d) this.keys = this.keys.filter((k) => k !== d);
    });
    window.addEventListener('blur', () => this.reset());

    // on-screen pads
    document.querySelectorAll('.pad').forEach((pad) => {
      const dir = Number(pad.dataset.dir);
      const down = (e) => {
        e.preventDefault();
        pad.setPointerCapture?.(e.pointerId);
        this.pads.set(e.pointerId, dir);
        pad.classList.add('down');
        this.emit('any');
      };
      const up = (e) => {
        this.pads.delete(e.pointerId);
        if (![...this.pads.values()].includes(dir)) pad.classList.remove('down');
      };
      pad.addEventListener('pointerdown', down);
      pad.addEventListener('pointerup', up);
      pad.addEventListener('pointercancel', up);
      pad.addEventListener('lostpointercapture', up);
      pad.addEventListener('contextmenu', (e) => e.preventDefault());
    });

    // press & hold on the left / right half of the scene
    const side = (e) => (e.clientX < window.innerWidth / 2 ? -1 : 1);
    canvas.addEventListener('pointerdown', (e) => {
      this.pointers.set(e.pointerId, side(e));
      canvas.setPointerCapture?.(e.pointerId);
      this.emit('any');
      this.emit('tap');
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, side(e));
    });
    const end = (e) => this.pointers.delete(e.pointerId);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  on(name, fn) { this.handlers[name] = fn; }
  emit(name) { if (this.handlers[name]) this.handlers[name](); }

  reset() {
    this.keys = [];
    this.pointers.clear();
    this.pads.clear();
    document.querySelectorAll('.pad.down').forEach((p) => p.classList.remove('down'));
  }

  get dir() {
    if (this.keys.length) return this.keys[this.keys.length - 1];
    let d = 0;
    for (const v of this.pads.values()) d = v;
    for (const v of this.pointers.values()) d = v;
    return d;
  }
}
