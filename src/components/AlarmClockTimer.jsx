import React, { useEffect, useRef, useState } from 'react';
import { playTick, playAlarm } from '../lib/sound';

export function AlarmClockTimer({ secondsLeft, totalSeconds }) {
  const [shakeAngle, setShakeAngle] = useState(0);
  const firedRef = useRef(false);

  const frac =
    totalSeconds > 0
      ? 1 - secondsLeft / totalSeconds
      : 1;

  const handAngle =
    Math.max(0, Math.min(1, frac)) * 360;

  const isUrgent = secondsLeft <= 5;

  useEffect(() => {
    if (secondsLeft === 0 && !firedRef.current) {
      firedRef.current = true;

      const shakes = [-4, 4, -3, 3, -2, 2, 0];

      shakes.forEach((deg, i) => {
        setTimeout(() => {
          setShakeAngle(deg);
        }, i * 80);
      });
    }

    if (secondsLeft > 0) {
      firedRef.current = false;
      setShakeAngle(0);
    }
  }, [secondsLeft]);

  useEffect(() => {
    if (secondsLeft > 0 && secondsLeft <= 5) {
      playTick();
    }
  
    if (secondsLeft === 0) {
      playAlarm();
    }
  }, [secondsLeft]);


  const ticks = [];

  for (let i = 0; i < 12; i++) {
    const angle = (i * 30 * Math.PI) / 180;

    ticks.push(
      <line
        key={i}
        x1={110 + 60 * Math.sin(angle)}
        y1={115 - 60 * Math.cos(angle)}
        x2={110 + 66 * Math.sin(angle)}
        y2={115 - 66 * Math.cos(angle)}
        stroke="#111111"
        strokeWidth="3"
        strokeLinecap="round"
      />
    );
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <svg
        viewBox="0 0 220 220"
        className="w-14 h-14 sm:w-20 sm:h-20 lg:w-14 lg:h-14"
        style={{
          transformOrigin: '110px 190px',
          transform: `rotate(${shakeAngle}deg)`,
          transition: 'transform 0.08s',
        }}
      >
        <ellipse
          cx="110"
          cy="205"
          rx="55"
          ry="8"
          fill="#000000"
          opacity="0.15"
        />

        <path
          d="M40 45 L20 15 L60 25 Z"
          fill="#c81e1e"
        />

        <path
          d="M180 45 L200 15 L160 25 Z"
          fill="#c81e1e"
        />

        <circle
          cx="40"
          cy="45"
          r="20"
          fill="#dc2626"
        />

        <circle
          cx="180"
          cy="45"
          r="20"
          fill="#dc2626"
        />

        <line
          x1="80"
          y1="195"
          x2="65"
          y2="215"
          stroke="#c81e1e"
          strokeWidth="10"
          strokeLinecap="round"
        />

        <line
          x1="140"
          y1="195"
          x2="155"
          y2="215"
          stroke="#c81e1e"
          strokeWidth="10"
          strokeLinecap="round"
        />

        <path
          d="M75 30 Q110 5 145 30"
          fill="none"
          stroke="#c81e1e"
          strokeWidth="6"
          strokeLinecap="round"
        />

        <circle
          cx="110"
          cy="28"
          r="6"
          fill="#c81e1e"
        />

        <circle
          cx="110"
          cy="115"
          r="85"
          fill="#dc2626"
        />

        <circle
          cx="110"
          cy="115"
          r="70"
          fill="#ffffff"
        />

        <g>{ticks}</g>

        <line
          x1="110"
          y1="115"
          x2="110"
          y2="58"
          stroke={isUrgent ? '#dc2626' : '#111111'}
          strokeWidth="4"
          strokeLinecap="round"
          transform={`rotate(${handAngle} 110 115)`}
        />

        <circle
          cx="110"
          cy="115"
          r="5"
          fill="#111111"
        />
      </svg>

      <div
        className={`text-sm sm:text-lg lg:text-sm font-mono font-bold ${
          isUrgent
            ? 'text-red-500'
            : 'text-white'
        }`}
      >
        {secondsLeft}s
      </div>
    </div>
  );
}