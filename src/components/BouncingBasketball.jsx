import React, { useEffect, useRef } from 'react';

export default function BouncingBasketball({
  paused = false,
  liftHeight = 42,
  bounceMs = 550,
  sweepMs = 3300,
}) {
  const ballRef = useRef(null);
  const shadowRef = useRef(null);
  const startRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    if (paused) return;

    const tick = (ts) => {
      if (startRef.current === null) {
        startRef.current = ts;
      }

      const elapsed = ts - startRef.current;

      const container = ballRef.current?.parentElement?.parentElement;
      const containerWidth = container?.clientWidth ?? 260;

      const ballSize = 48;
      const travelX = Math.max(0, containerWidth - ballSize);

      // Smooth left -> right -> left movement
      const sweepPhase = (elapsed % sweepMs) / sweepMs;

      const x =
        (travelX / 2) *
        (1 - Math.cos(2 * Math.PI * sweepPhase));

      // True parabolic bounce
      const bouncePhase = (elapsed % bounceMs) / bounceMs;

      const lift =
        4 *
        liftHeight *
        bouncePhase *
        (1 - bouncePhase);

      // Squash slightly when touching the ground
      const distFromGround =
        Math.min(bouncePhase, 1 - bouncePhase);

      const squash =
        1 - Math.min(distFromGround * 10, 1);

      const scaleX = 1 + squash * 0.12;
      const scaleY = 1 - squash * 0.12;

      if (ballRef.current) {
        ballRef.current.style.transform =
          `translate(${x}px, ${-lift}px) scale(${scaleX}, ${scaleY})`;
      }

      const groundCloseness =
        1 - lift / liftHeight;

      if (shadowRef.current) {
        shadowRef.current.style.transform =
          `translateX(${x}px) scale(${0.55 + 0.45 * groundCloseness})`;

        shadowRef.current.style.opacity =
          `${0.08 + 0.18 * groundCloseness}`;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    startRef.current = null;
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [paused, liftHeight, bounceMs, sweepMs]);

  return (
    <div className="relative w-full h-20 sm:h-24 lg:h-24 overflow-hidden">
      <div
        ref={shadowRef}
        className="absolute left-0 bottom-1 w-12 h-2 rounded-full bg-black"
      />

      <div
        ref={ballRef}
        className="absolute left-0 bottom-3 w-10 h-10 sm:w-12 sm:h-12"
      >
        <svg
          viewBox="0 0 100 100"
          className="w-full h-full block"
        >
          <circle
            cx="50"
            cy="50"
            r="46"
            fill="#e8752c"
            stroke="#8a3e11"
            strokeWidth="2"
          />

          <line
            x1="4"
            y1="50"
            x2="96"
            y2="50"
            stroke="#3d1c08"
            strokeWidth="2.5"
          />

          <line
            x1="50"
            y1="4"
            x2="50"
            y2="96"
            stroke="#3d1c08"
            strokeWidth="2.5"
          />

          <path
            d="M8 26 Q50 50 8 74"
            fill="none"
            stroke="#3d1c08"
            strokeWidth="2.5"
          />

          <path
            d="M92 26 Q50 50 92 74"
            fill="none"
            stroke="#3d1c08"
            strokeWidth="2.5"
          />

          <ellipse
            cx="35"
            cy="32"
            rx="13"
            ry="7"
            fill="#ffffff"
            opacity="0.18"
          />
        </svg>
      </div>
    </div>
  );
}