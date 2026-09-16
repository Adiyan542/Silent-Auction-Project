import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const EXTRA_SPINS = 10;
const SPIN_DURATION_MS = 5000;

const LEVER_START_ANGLE = -35;
const LEVER_END_ANGLE = 55;
const LEVER_TRIGGER_ANGLE = 35;

// More colorful neon gradient palette
const WHEEL_GRADIENTS = [
  { from: '#ff1744', to: '#c4001d' }, // vivid red
  { from: '#ff6d00', to: '#ff3d00' }, // orange
  { from: '#ffd600', to: '#ff9100' }, // golden yellow
  { from: '#76ff03', to: '#00c853' }, // lime green
  { from: '#00e676', to: '#00bfa5' }, // emerald
  { from: '#00e5ff', to: '#0091ea' }, // cyan
  { from: '#2979ff', to: '#304ffe' }, // electric blue
  { from: '#651fff', to: '#6200ea' }, // indigo
  { from: '#d500f9', to: '#aa00ff' }, // purple
  { from: '#f500d4', to: '#c51162' }, // magenta
  { from: '#ff4081', to: '#f50057' }, // hot pink
  { from: '#ff5252', to: '#ff1744' }, // coral red
];

const RIM_COLORS = [
  '#ff1744',
  '#ff9100',
  '#ffd600',
  '#76ff03',
  '#00e676',
  '#00e5ff',
  '#2979ff',
  '#651fff',
  '#d500f9',
  '#ff4081',
];

const RIM_LIGHT_COUNT = 28;

function dramaticSpinEase(t) {
  const windUp = 0.14;

  if (t < windUp) {
    const lt = t / windUp;
    return 0.05 * (lt * lt * lt);
  }

  const lt = (t - windUp) / (1 - windUp);
  const eased = 1 - Math.pow(1 - lt, 4.5);

  return 0.05 + eased * 0.95;
}

function spinIntensity(progress) {
  const delta =
    dramaticSpinEase(Math.min(1, progress + 0.01)) -
    dramaticSpinEase(Math.max(0, progress - 0.01));

  return Math.max(0, Math.min(1, delta * 22));
}

function useWheelAudio(soundEnabled) {
  const ctxRef = useRef(null);

  const getCtx = () => {
    if (!soundEnabled) return null;

    if (!ctxRef.current) {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

      if (!AudioContextClass) return null;

      ctxRef.current = new AudioContextClass();
    }

    if (ctxRef.current.state === 'suspended') {
      ctxRef.current.resume();
    }

    return ctxRef.current;
  };

  const clunk = () => {
    const ctx = getCtx();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'square';

    osc.frequency.setValueAtTime(110, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(
      40,
      ctx.currentTime + 0.2
    );

    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      ctx.currentTime + 0.22
    );

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.22);
  };

  const tick = () => {
    const ctx = getCtx();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'square';
    osc.frequency.value = 850;

    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      ctx.currentTime + 0.04
    );

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.04);
  };

  const chime = () => {
    const ctx = getCtx();
    if (!ctx) return;

    [660, 880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.value = freq;

      const start = ctx.currentTime + i * 0.09;

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(
        0.22,
        start + 0.03
      );
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        start + 0.5
      );

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(start + 0.55);
    });
  };

  return {
    clunk,
    tick,
    chime,
    unlock: getCtx,
  };
}

function scheduleRemainingTicks(elapsedMs, durationMs, onTick) {
  const timers = [];
  const count = 34;

  for (let i = 0; i < count; i += 1) {
    const normalized = i / count;
    const tickProgress = 1 - Math.pow(1 - normalized, 2.4);
    const tickTime = tickProgress * durationMs;

    if (tickTime <= elapsedMs) continue;

    timers.push(setTimeout(onTick, tickTime - elapsedMs));
  }

  return () => {
    timers.forEach(clearTimeout);
  };
}

export default function TieBreakerWheel({
  room,
  roomId,
  isHost,
  soundEnabled,
}) {
  const candidates = room.wheel_candidates ?? [];
  const winnerUserId = room.wheel_winner_user_id ?? null;
  const spinStartedAt = room.wheel_spin_started_at ?? null;

  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [glow, setGlow] = useState(0);
  const [justLanded, setJustLanded] = useState(false);

  const [leverAngle, setLeverAngle] =
    useState(LEVER_START_ANGLE);
  const [leverLocked, setLeverLocked] = useState(false);
  const [leverGlow, setLeverGlow] = useState(false);

  const [error, setError] = useState('');

  const dragStartYRef = useRef(null);
  const finalizedRef = useRef(false);

  const { clunk, tick, chime, unlock } =
    useWheelAudio(soundEnabled);

  const n = candidates.length;
  const sliceDeg = n > 0 ? 360 / n : 0;

  const winnerIndex = useMemo(
    () =>
      candidates.findIndex(
        (candidate) => candidate.userId === winnerUserId
      ),
    [candidates, winnerUserId]
  );

  const finalizeWithRetry = async () => {
    if (finalizedRef.current) return;

    finalizedRef.current = true;

    const attempt = async () => {
      const { data, error: rpcError } = await supabase.rpc(
        'finalize_tiebreaker_wheel',
        { p_room_id: roomId }
      );

      if (rpcError) {
        console.error(
          'finalize_tiebreaker_wheel failed:',
          rpcError
        );
        finalizedRef.current = false;
        return;
      }

      if (data?.skipped === 'wheel is still spinning') {
        setTimeout(attempt, 350);
      }
    };

    setTimeout(attempt, 200);
  };

  useEffect(() => {
    if (
      !winnerUserId ||
      winnerIndex < 0 ||
      !spinStartedAt ||
      n === 0
    ) {
      return;
    }

    const winnerCenterDeg =
      winnerIndex * sliceDeg + sliceDeg / 2;

    const targetRotation =
      EXTRA_SPINS * 360 + (360 - winnerCenterDeg);

    const startedAt = new Date(spinStartedAt).getTime();

    let animationFrame;

    const initialElapsed = Math.max(
      0,
      Date.now() - startedAt
    );

    const stopTicks = scheduleRemainingTicks(
      initialElapsed,
      SPIN_DURATION_MS,
      tick
    );

    setLeverLocked(true);
    setSpinning(true);
    setJustLanded(false);

    const animate = () => {
      const elapsed = Date.now() - startedAt;

      const progress = Math.min(
        1,
        Math.max(0, elapsed / SPIN_DURATION_MS)
      );

      const eased = dramaticSpinEase(progress);

      setRotation(targetRotation * eased);
      setGlow(spinIntensity(progress));

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
        return;
      }

      setRotation(targetRotation);
      setGlow(0);
      setSpinning(false);
      setJustLanded(true);

      chime();

      setTimeout(() => setJustLanded(false), 1400);

      finalizeWithRetry();
    };

    animate();

    return () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }

      stopTicks?.();
    };
  }, [
    winnerUserId,
    winnerIndex,
    n,
    sliceDeg,
    spinStartedAt,
  ]);

  const pullLever = async () => {
    if (!isHost || leverLocked || winnerUserId) return;

    setLeverLocked(true);
    setLeverGlow(true);
    setError('');

    unlock();
    clunk();

    const { data, error: rpcError } = await supabase.rpc(
      'spin_tiebreaker_wheel',
      { p_room_id: roomId }
    );

    if (rpcError) {
      setError(rpcError.message);
      setLeverLocked(false);
      setLeverGlow(false);
      setLeverAngle(LEVER_START_ANGLE);
      return;
    }

    if (!data?.ok) {
      setError(
        data?.error || 'Could not spin the wheel.'
      );
      setLeverLocked(false);
      setLeverGlow(false);
      setLeverAngle(LEVER_START_ANGLE);
      return;
    }

    setTimeout(() => {
      setLeverAngle(LEVER_START_ANGLE);
    }, 250);
  };

  const onLeverPointerDown = (event) => {
    if (!isHost || leverLocked || winnerUserId) return;

    dragStartYRef.current = event.clientY;

    event.currentTarget.setPointerCapture?.(
      event.pointerId
    );
  };

  const onLeverPointerMove = (event) => {
    if (dragStartYRef.current === null) return;

    const delta = Math.max(
      0,
      event.clientY - dragStartYRef.current
    );

    const progress = Math.min(1, delta / 110);

    const nextAngle =
      LEVER_START_ANGLE +
      progress *
        (LEVER_END_ANGLE - LEVER_START_ANGLE);

    setLeverAngle(nextAngle);

    if (nextAngle >= LEVER_TRIGGER_ANGLE) {
      dragStartYRef.current = null;
      setLeverAngle(LEVER_END_ANGLE);
      pullLever();
    }
  };

  const onLeverPointerUp = () => {
    if (dragStartYRef.current === null) return;

    dragStartYRef.current = null;
    setLeverAngle(LEVER_START_ANGLE);
  };

  const leverActive =
    isHost && !leverLocked && !winnerUserId;

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6 text-center text-white relative overflow-hidden"
      style={{
        background:
          'radial-gradient(ellipse at 50% 30%, #2a0f4e 0%, #150726 45%, #050109 100%)',
      }}
    >
      <style>{`
        @keyframes rimChase {
          0%, 100% {
            opacity: 0.35;
            filter: drop-shadow(0 0 0px currentColor);
          }

          50% {
            opacity: 1;
            filter: drop-shadow(0 0 7px currentColor);
          }
        }

        @keyframes pointerPulse {
          0%, 100% {
            filter: drop-shadow(
              0 0 3px rgba(255,214,10,0.6)
            );
            transform: scale(1);
          }

          50% {
            filter: drop-shadow(
              0 0 10px rgba(255,214,10,0.95)
            );
            transform: scale(1.06);
          }
        }

        @keyframes landPulse {
          0% { transform: scale(1); }
          30% { transform: scale(1.045); }
          60% { transform: scale(0.99); }
          100% { transform: scale(1); }
        }

        @keyframes titleGlow {
          0%, 100% {
            text-shadow:
              0 0 12px rgba(255,214,10,0.35),
              0 0 2px rgba(255,255,255,0.4);
          }

          50% {
            text-shadow:
              0 0 22px rgba(255,64,129,0.7),
              0 0 32px rgba(0,229,255,0.35),
              0 0 4px rgba(255,255,255,0.6);
          }
        }
      `}</style>

      {/* Ambient colorful background */}
      <div
        className="pointer-events-none absolute w-[520px] h-[520px] rounded-full opacity-30 blur-3xl"
        style={{
          background: '#7b2ff7',
          top: '-120px',
          left: '-160px',
        }}
      />

      <div
        className="pointer-events-none absolute w-[420px] h-[420px] rounded-full opacity-20 blur-3xl"
        style={{
          background: '#00e5ff',
          bottom: '-140px',
          right: '-120px',
        }}
      />

      <div
        className="pointer-events-none absolute w-[300px] h-[300px] rounded-full opacity-10 blur-3xl"
        style={{
          background: '#ff1744',
          top: '45%',
          right: '20%',
        }}
      />

      <div className="mb-8 relative z-10">
        <p className="font-black tracking-[0.35em] text-xs mb-2 bg-gradient-to-r from-amber-300 via-pink-400 to-cyan-300 bg-clip-text text-transparent">
          FINAL TIEBREAKER
        </p>

        <h1
          className="font-black text-3xl sm:text-4xl mb-2 text-white"
          style={{
            animation:
              'titleGlow 2.4s ease-in-out infinite',
          }}
        >
          THE WHEEL DECIDES
        </h1>

        <p className="text-slate-400 text-sm">
          Three straight ties. One final winner.
        </p>
      </div>

      <div className="flex items-center justify-center gap-10 sm:gap-16 relative z-10">

        {/* PRIZE WHEEL */}
        <div
          className="relative w-64 h-64 sm:w-80 sm:h-80"
          style={{
            animation: justLanded
              ? 'landPulse 0.5s ease-out'
              : 'none',
          }}
        >
          {/* Pointer */}
          <div className="absolute -top-6 left-1/2 -translate-x-1/2 z-30">
            <div className="w-5 h-8 bg-gradient-to-b from-slate-100 via-slate-300 to-slate-600 border-2 border-slate-700 rounded-sm shadow-lg" />

            <div
              className="absolute top-6 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-t-[18px] border-t-amber-300"
              style={{
                animation:
                  'pointerPulse 1.3s ease-in-out infinite',
              }}
            />
          </div>

          {/* Physical frame */}
          <div
            className="absolute inset-[-12px] rounded-full border-[5px] border-neutral-800 shadow-[0_10px_45px_rgba(123,47,247,0.35)]"
            style={{
              background:
                'radial-gradient(circle at 35% 30%, #1c1c22, #050505 75%)',
            }}
          />

          {/* Gold ring */}
          <div
            className="absolute inset-[-4px] rounded-full border-2 z-10 pointer-events-none transition-shadow duration-150"
            style={{
              borderColor: '#f5c518',
              boxShadow: `
                0 0 ${6 + glow * 26}px
                ${2 + glow * 8}px
                rgba(245,197,24,${
                  0.25 + glow * 0.45
                })
              `,
            }}
          />

          {/* Rainbow rim lights */}
          <svg
            viewBox="0 0 200 200"
            className="absolute inset-0 z-20 w-full h-full pointer-events-none"
          >
            {Array.from({
              length: RIM_LIGHT_COUNT,
            }).map((_, index) => {
              const angle =
                (index / RIM_LIGHT_COUNT) *
                Math.PI *
                2;

              const x =
                100 + 97 * Math.cos(angle);

              const y =
                100 + 97 * Math.sin(angle);

              const rimColor =
                RIM_COLORS[
                  index % RIM_COLORS.length
                ];

              return (
                <circle
                  key={index}
                  cx={x}
                  cy={y}
                  r="2.6"
                  fill={rimColor}
                  style={{
                    color: rimColor,
                    animation: `rimChase ${
                      spinning ? 0.7 : 2.2
                    }s linear infinite`,
                    animationDelay: `${
                      index *
                      (spinning ? 0.025 : 0.09)
                    }s`,
                  }}
                />
              );
            })}
          </svg>

          {/* Wheel */}
          <svg
            viewBox="0 0 200 200"
            className="relative z-10 w-full h-full"
            style={{
              transform: `rotate(${rotation}deg)`,
              willChange: 'transform',
              filter: `drop-shadow(
                0 0 ${4 + glow * 18}px
                rgba(199,125,255,${
                  0.25 + glow * 0.4
                })
              )`,
            }}
          >
            <defs>
              {WHEEL_GRADIENTS.map((g, i) => (
                <linearGradient
                  key={i}
                  id={`slice-grad-${i}`}
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="100%"
                >
                  <stop
                    offset="0%"
                    stopColor={g.from}
                  />

                  <stop
                    offset="100%"
                    stopColor={g.to}
                  />
                </linearGradient>
              ))}

              <radialGradient
                id="hub-grad"
                cx="35%"
                cy="30%"
                r="75%"
              >
                <stop
                  offset="0%"
                  stopColor="#3a3a42"
                />
                <stop
                  offset="55%"
                  stopColor="#111114"
                />
                <stop
                  offset="100%"
                  stopColor="#000000"
                />
              </radialGradient>

              <radialGradient
                id="hub-core-grad"
                cx="35%"
                cy="30%"
                r="75%"
              >
                <stop
                  offset="0%"
                  stopColor="#ffe066"
                />
                <stop
                  offset="60%"
                  stopColor="#f5c518"
                />
                <stop
                  offset="100%"
                  stopColor="#a97c00"
                />
              </radialGradient>
            </defs>

            {candidates.map(
              (candidate, index) => {
                const startAngle =
                  (index * sliceDeg - 90) *
                  (Math.PI / 180);

                const endAngle =
                  ((index + 1) * sliceDeg - 90) *
                  (Math.PI / 180);

                const x1 =
                  100 +
                  91 * Math.cos(startAngle);

                const y1 =
                  100 +
                  91 * Math.sin(startAngle);

                const x2 =
                  100 +
                  91 * Math.cos(endAngle);

                const y2 =
                  100 +
                  91 * Math.sin(endAngle);

                const largeArc =
                  sliceDeg > 180 ? 1 : 0;

                const midAngle =
                  (index * sliceDeg +
                    sliceDeg / 2 -
                    90) *
                  (Math.PI / 180);

                const labelX =
                  100 +
                  58 * Math.cos(midAngle);

                const labelY =
                  100 +
                  58 * Math.sin(midAngle);

                const label =
                  candidate.displayName.length >
                  10
                    ? `${candidate.displayName.slice(
                        0,
                        9
                      )}…`
                    : candidate.displayName;

                const gradIndex =
                  index %
                  WHEEL_GRADIENTS.length;

                return (
                  <g key={candidate.userId}>
                    <path
                      d={`
                        M100,100
                        L${x1},${y1}
                        A91,91
                        0
                        ${largeArc}
                        1
                        ${x2},${y2}
                        Z
                      `}
                      fill={`url(#slice-grad-${gradIndex})`}
                      stroke="#0a0a0d"
                      strokeWidth="2"
                    />

                    <text
                      x={labelX}
                      y={labelY}
                      fill="#ffffff"
                      fontSize="10"
                      fontWeight="900"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      style={{
                        textShadow:
                          '0 1px 3px rgba(0,0,0,0.65)',
                      }}
                      transform={`
                        rotate(
                          ${
                            index *
                              sliceDeg +
                            sliceDeg / 2
                          },
                          ${labelX},
                          ${labelY}
                        )
                      `}
                    >
                      {label}
                    </text>
                  </g>
                );
              }
            )}

            {/* Center hub */}
            <circle
              cx="100"
              cy="100"
              r="18"
              fill="url(#hub-grad)"
              stroke="#f5c518"
              strokeWidth="3"
            />

            <circle
              cx="100"
              cy="100"
              r="11"
              fill="url(#hub-core-grad)"
              stroke="#fff8e1"
              strokeWidth="1.5"
            />
          </svg>
        </div>

        {/* LEVER */}
        <div className="flex flex-col items-center">
          <div className="relative w-28 h-44">

            {/* Lever base */}
            <div
              className="absolute left-1/2 bottom-4 -translate-x-1/2 w-20 h-10 rounded-t-xl border-2 shadow-xl"
              style={{
                background:
                  'linear-gradient(180deg, #1c1c22, #050505)',
                borderColor: leverActive
                  ? '#f5c518'
                  : '#3f3f46',
                boxShadow: leverGlow
                  ? '0 0 22px 4px rgba(255,61,129,0.55)'
                  : '0 8px 20px rgba(0,0,0,0.55)',
                transition:
                  'box-shadow 200ms ease',
              }}
            />

            {/* Pivot */}
            <div className="absolute left-1/2 bottom-8 -translate-x-1/2 w-9 h-9 rounded-full bg-neutral-900 border-[4px] border-slate-300 z-20">
              <div
                className="absolute inset-[7px] rounded-full"
                style={{
                  background: leverActive
                    ? 'radial-gradient(circle at 35% 30%, #ffe066, #ff8500)'
                    : 'radial-gradient(circle at 35% 30%, #6b6b76, #3f3f46)',
                  boxShadow: leverActive
                    ? '0 0 8px rgba(255,133,0,0.7)'
                    : 'none',
                }}
              />
            </div>

            {/* Rotating lever */}
            <div
              onPointerDown={
                onLeverPointerDown
              }
              onPointerMove={
                onLeverPointerMove
              }
              onPointerUp={onLeverPointerUp}
              onPointerCancel={
                onLeverPointerUp
              }
              className={`absolute left-1/2 bottom-[48px] w-[8px] h-28 origin-bottom touch-none z-10 ${
                leverActive
                  ? 'cursor-grab active:cursor-grabbing'
                  : 'cursor-not-allowed'
              }`}
              style={{
                transform: `translateX(-50%) rotate(${leverAngle}deg)`,
                transition:
                  dragStartYRef.current !==
                  null
                    ? 'none'
                    : 'transform 260ms cubic-bezier(0.34,1.56,0.64,1)',
              }}
            >
              {/* Metal rod */}
              <div
                className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[6px] h-24 rounded-full border"
                style={{
                  background:
                    'linear-gradient(90deg, #6b6b76, #f4f4f5 45%, #ffffff 55%, #6b6b76)',
                  borderColor: '#8a8a94',
                }}
              />

              {/* Knob */}
              <div
                className="absolute -top-3 left-1/2 -translate-x-1/2 w-8 h-12 rounded-full border-2 shadow-xl"
                style={{
                  background: leverActive
                    ? 'linear-gradient(135deg, #ff4081, #d500f9, #651fff)'
                    : 'linear-gradient(135deg, #52525b, #27272a)',
                  borderColor: leverActive
                    ? '#ffd600'
                    : '#3f3f46',
                  boxShadow: leverActive
                    ? '0 0 14px rgba(255,64,129,0.65)'
                    : 'none',
                }}
              />
            </div>
          </div>

          <div
            className="mt-1 px-3 py-1.5 rounded text-[10px] font-black tracking-[0.18em] uppercase border"
            style={{
              background: '#000000',
              borderColor: leverActive
                ? 'rgba(245,197,24,0.6)'
                : 'rgba(245,197,24,0.25)',
              color: leverActive
                ? '#ffd60a'
                : '#94a3b8',
            }}
          >
            {isHost
              ? winnerUserId
                ? 'Spinning...'
                : 'Pull Lever'
              : winnerUserId
                ? 'Spinning...'
                : 'Waiting For Host'}
          </div>
        </div>
      </div>

      {/* Candidate labels */}
      {!winnerUserId &&
        candidates.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2 mt-9 relative z-10">
            {candidates.map(
              (candidate, i) => {
                const g =
                  WHEEL_GRADIENTS[
                    i %
                      WHEEL_GRADIENTS.length
                  ];

                return (
                  <span
                    key={candidate.userId}
                    className="px-3 py-1 rounded-full text-xs font-bold text-white border"
                    style={{
                      background:
                        'rgba(0,0,0,0.55)',
                      borderColor: g.from,
                      boxShadow: `0 0 8px ${g.from}55`,
                    }}
                  >
                    {candidate.displayName}
                  </span>
                );
              }
            )}
          </div>
        )}

      {error && (
        <p className="text-red-400 text-xs font-bold mt-5 relative z-10">
          {error}
        </p>
      )}
    </div>
  );
}