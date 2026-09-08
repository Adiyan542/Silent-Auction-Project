let soundEnabled =
  localStorage.getItem('soundEnabled') !== 'false';

let ctx = null;

export function setSoundEnabled(enabled) {
  soundEnabled = enabled;
  localStorage.setItem('soundEnabled', String(enabled));

  if (!enabled) {
    stopElevatorMusic();
  }
}

export function getSoundEnabled() {
  return soundEnabled;
}

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
  if (!soundEnabled) return;
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
  if (!soundEnabled) return;
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
  if (!soundEnabled) return;
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

// ---------- Lobby music ----------

let lobbyMusic = null;

export function startElevatorMusic(lobbyStartedAt) {
  if (!soundEnabled) return;

  if (!lobbyMusic) {
    lobbyMusic = new Audio(
      '/audio/AuctionDraftLobbyMusic.mp3'
    );

    lobbyMusic.loop = true;
    lobbyMusic.volume = 0.4;
  }

  const syncAndPlay = () => {
    if (
      !lobbyMusic.duration ||
      !Number.isFinite(lobbyMusic.duration)
    ) {
      return;
    }

    const elapsedSeconds =
      (Date.now() - lobbyStartedAt) / 1000;

    const syncedPosition =
      elapsedSeconds % lobbyMusic.duration;

    lobbyMusic.currentTime = syncedPosition;

    lobbyMusic.play().catch((err) => {
      console.log(
        'Lobby music waiting for user interaction:',
        err
      );
    });
  };

  if (lobbyMusic.readyState >= 1) {
    syncAndPlay();
  } else {
    lobbyMusic.addEventListener(
      'loadedmetadata',
      syncAndPlay,
      { once: true }
    );
  }
}

export function stopElevatorMusic() {
  if (!lobbyMusic) return;

  lobbyMusic.pause();
}