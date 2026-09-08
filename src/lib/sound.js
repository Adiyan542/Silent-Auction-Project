let ctx = null;

function getCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  }

  if (ctx.state === 'suspended') {
    ctx.resume();
  }

  return ctx;
}

export function playTick() {
  const c = getCtx();
  const osc = c.createOscillator();
  const gain = c.createGain();

  osc.type = 'square';
  osc.frequency.value = 1000;

  gain.gain.setValueAtTime(0.12, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    c.currentTime + 0.05
  );

  osc.connect(gain).connect(c.destination);

  osc.start();
  osc.stop(c.currentTime + 0.05);
}

export function playAlarm() {
  const c = getCtx();
  const now = c.currentTime;

  [0, 0.15, 0.3].forEach((delay) => {
    const osc = c.createOscillator();
    const gain = c.createGain();

    osc.type = 'square';
    osc.frequency.value = 1800;

    gain.gain.setValueAtTime(0.18, now + delay);
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      now + delay + 0.1
    );

    osc.connect(gain).connect(c.destination);

    osc.start(now + delay);
    osc.stop(now + delay + 0.1);
  });
}


export function playBounce() {
    const c = getCtx();
    const now = c.currentTime;
  
    const osc = c.createOscillator();
    const gain = c.createGain();
  
    osc.type = 'sine';
  
    // Low thump that quickly drops in pitch
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.1);
  
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      now + 0.12
    );
  
    osc.connect(gain).connect(c.destination);
  
    osc.start(now);
    osc.stop(now + 0.12);
  }