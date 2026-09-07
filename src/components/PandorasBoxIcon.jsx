export function PandorasBoxIcon({ className = "w-16 h-16" }) {
  return (
    <svg viewBox="0 0 200 160" className={className}>
      <defs>
        <linearGradient id="pbLidWood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a9713f" />
          <stop offset="100%" stopColor="#7a4a24" />
        </linearGradient>
        <linearGradient id="pbBodyWood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8a5a30" />
          <stop offset="100%" stopColor="#5c3818" />
        </linearGradient>
      </defs>
      <rect x="45" y="88" width="110" height="60" rx="5" fill="url(#pbBodyWood)" stroke="#3d2410" strokeWidth="1.5" />
      <line x1="45" y1="100" x2="155" y2="100" stroke="#3d2410" strokeWidth="0.75" opacity="0.4" />
      <line x1="45" y1="115" x2="155" y2="115" stroke="#3d2410" strokeWidth="0.75" opacity="0.4" />
      <line x1="45" y1="130" x2="155" y2="130" stroke="#3d2410" strokeWidth="0.75" opacity="0.4" />
      <rect x="56" y="88" width="10" height="60" fill="#4a2c14" opacity="0.6" />
      <rect x="134" y="88" width="10" height="60" fill="#4a2c14" opacity="0.6" />
      <path d="M40 72 Q40 58 54 58 L146 58 Q160 58 160 72 L160 88 L40 88 Z" fill="url(#pbLidWood)" stroke="#3d2410" strokeWidth="1.5" />
      <rect x="40" y="83" width="120" height="8" rx="2" fill="#4a2c14" />
      <rect x="58" y="83" width="10" height="60" fill="#4a2c14" opacity="0.6" />
      <rect x="132" y="83" width="10" height="60" fill="#4a2c14" opacity="0.6" />
      <rect x="83" y="76" width="34" height="32" rx="4" fill="#d4a24c" stroke="#8a6423" strokeWidth="1.5" />
      <circle cx="100" cy="88" r="4" fill="#5c3818" />
      <rect x="98" y="88" width="4" height="10" fill="#5c3818" />
      <circle cx="53" cy="65" r="3" fill="#d4a24c" stroke="#8a6423" strokeWidth="0.75" />
      <circle cx="147" cy="65" r="3" fill="#d4a24c" stroke="#8a6423" strokeWidth="0.75" />
    </svg>
  );
}