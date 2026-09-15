import { useState } from 'react';
import { RotateCcw, X, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

// Self-contained, like Chat.jsx / SoundBoard.jsx: decides its own
// visibility (host-only, normal-player-results-only) and owns the
// confirm dialog + RPC call. OnlineDraft.jsx just renders it.
export default function RedoAuctionButton({ room, roomId, isHost }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isHost) return null;
  if (room?.status !== 'results') return null;

  const results = room.results ?? {};
  const isEligible =
    !results.isPandora &&
    !results.noSale &&
    !results.autoAwarded &&
    !room.current_player?.isPandora;

  if (!isEligible) return null;

  const handleConfirm = async () => {
    setLoading(true);
    setError('');

    const { data, error: rpcError } = await supabase.rpc('redo_auction', {
      p_room_id: roomId,
    });

    if (rpcError) {
      setError(rpcError.message);
      setLoading(false);
      return;
    }

    if (!data?.ok) {
      setError(data?.error || 'Could not redo this auction.');
      setLoading(false);
      return;
    }

    // Success — realtime will push the room back into 'bidding' for
    // everyone, including this client, so nothing else to do here.
    setLoading(false);
    setConfirming(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError('');
          setConfirming(true);
        }}
        className="px-3 py-2 rounded-lg bg-amber-900/40 border border-amber-700 text-xs font-bold text-amber-300 hover:bg-amber-900/60 hover:border-amber-500 active:scale-95 transition flex items-center gap-1.5"
        title="Redo this auction"
      >
        <RotateCcw size={14} />
        REDO AUCTION
      </button>

      {confirming && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-slate-950 border border-amber-700 rounded-2xl shadow-2xl p-5">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="text-amber-400 shrink-0 mt-0.5" size={22} />
              <div>
                <h3 className="text-white font-black text-sm mb-1">
                  REDO THIS AUCTION?
                </h3>
                <p className="text-slate-400 text-xs leading-relaxed">
                  This will completely reverse the current result — the
                  winner's roster spot and budget will be refunded, and
                  every bid from this round will be discarded. A brand new
                  60-second blind-bid round for the same player will start
                  immediately for everyone.
                </p>
              </div>
            </div>

            {error && (
              <p className="text-red-400 text-xs mb-3">{error}</p>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={loading}
                className="flex-1 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-bold transition disabled:opacity-50"
              >
                <span className="inline-flex items-center gap-1">
                  <X size={14} /> Cancel
                </span>
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={loading}
                className="flex-1 px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold transition disabled:opacity-50"
              >
                {loading ? 'Redoing…' : 'Yes, Redo It'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}