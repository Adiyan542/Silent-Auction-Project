import React from 'react';

const ACTIVE_SLOTS = [
  'PG',
  'SG',
  'G',
  'SF',
  'PF',
  'F',
  'C',
  'UTIL',
  'UTIL',
  'UTIL',
];

const canPlaySlot = (player, slot) => {
  const positions = player.positions ?? [];

  if (slot === 'PG') return positions.includes('PG');
  if (slot === 'SG') return positions.includes('SG');
  if (slot === 'G') return positions.includes('PG') || positions.includes('SG');

  if (slot === 'SF') return positions.includes('SF');
  if (slot === 'PF') return positions.includes('PF');
  if (slot === 'F') return positions.includes('SF') || positions.includes('PF');

  if (slot === 'C') return positions.includes('C');

  if (slot === 'UTIL') return true;

  return false;
};

const buildLineup = (roster = []) => {
  const remaining = [...roster];

  const activeSlots = ACTIVE_SLOTS.map((slot) => ({
    slot,
    player: null,
  }));

  const fillOrder = [
    'PG',
    'SG',
    'SF',
    'PF',
    'C',
    'G',
    'F',
    'UTIL',
    'UTIL',
    'UTIL',
  ];

  fillOrder.forEach((slotName) => {
    const slotIndex = activeSlots.findIndex(
      (slot) => slot.slot === slotName && slot.player === null
    );

    if (slotIndex === -1) return;

    const playerIndex = remaining.findIndex((player) =>
      canPlaySlot(player, slotName)
    );

    if (playerIndex === -1) return;

    activeSlots[slotIndex].player = remaining[playerIndex];
    remaining.splice(playerIndex, 1);
  });

  // Always show at least 3 bench spots.
  // If more players are left over, create extra bench rows.
  const benchCount = Math.max(3, remaining.length);

  const benchSlots = Array.from({ length: benchCount }, (_, index) => ({
    slot: 'BE',
    player: remaining[index] ?? null,
  }));

  return [...activeSlots, ...benchSlots];
};

export default function YourLineup({ roster = [], budget }) {
  const lineup = buildLineup(roster);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-black text-white text-sm uppercase tracking-widest">
          Your Lineup
        </h3>

        <div className="text-right">
          <p className="text-slate-500 text-xs">
            {roster.length}/13
          </p>

          {budget !== undefined && (
            <p className="text-emerald-400 text-xs font-mono">
              ${budget}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {lineup.map((entry, index) => (
          <div
            key={`${entry.slot}-${index}`}
            className="grid grid-cols-[42px_1fr_auto] items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2"
          >
            <span className="text-slate-500 text-xs font-black">
              {entry.slot}
            </span>

            {entry.player ? (
              <>
                <span className="text-white text-xs whitespace-nowrap">
                  {entry.player.name}
                </span>

                <span className="text-slate-500 text-xs font-mono">
                  ${entry.player.cost}
                </span>
              </>
            ) : (
              <span className="text-slate-700 text-sm col-span-2">
                —
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}