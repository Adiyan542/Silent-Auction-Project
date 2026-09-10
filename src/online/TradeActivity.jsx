import React, { useEffect, useState } from 'react';
import { Handshake } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

export default function TradeActivity({ roomId, participants }) {
  const [trades, setTrades] = useState([]);

  useEffect(() => {
    let cancelled = false;

    const loadTrades = async () => {
      const { data, error } = await supabase
        .from('trade_proposals')
        .select('*')
        .eq('room_id', roomId)
        .eq('status', 'accepted')
        .order('resolved_at', { ascending: false })
        .limit(10);

      if (!cancelled && !error) {
        setTrades(data ?? []);
      }
    };

    loadTrades();

    const channel = supabase
      .channel(`trade-activity-${roomId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'trade_proposals',
          filter: `room_id=eq.${roomId}`,
        },
        loadTrades
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  const nameFor = (userId) =>
    participants.find((p) => p.user_id === userId)?.display_name ??
    'Unknown';

  if (trades.length === 0) return null;

  return (
    <div className="mb-6">
      <h3 className="font-bold text-slate-500 text-xs uppercase tracking-widest mb-3">
        Trade Activity
      </h3>

      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory">
        {trades.map((trade) => (
          <div
            key={trade.id}
            className="snap-start shrink-0 w-64 bg-blue-950/30 border border-blue-500/30 rounded-xl p-3"
          >
            <div className="flex items-center gap-2 mb-2">
              <Handshake
                size={16}
                className="text-blue-400"
              />

              <span className="text-blue-300 text-xs font-black uppercase tracking-wider">
                Trade
              </span>
            </div>

            <p className="text-white text-sm font-bold mb-2">
              {nameFor(trade.from_user_id)}
              {' ↔ '}
              {nameFor(trade.to_user_id)}
            </p>

            <div className="text-xs text-slate-300 space-y-1">
              <p>
                {(trade.give_players ?? [])
                  .map((p) => p.name)
                  .join(', ')}

                {trade.give_cash > 0 &&
                  ` + $${trade.give_cash}`}
              </p>

              <p className="text-slate-500">
                ↔
              </p>

              <p>
                {(trade.receive_players ?? [])
                  .map((p) => p.name)
                  .join(', ')}

                {trade.receive_cash > 0 &&
                  ` + $${trade.receive_cash}`}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}