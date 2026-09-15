import React, { useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// Lets a friend join a room with just a display name and the room code —
// no email, no password. Under the hood this creates an anonymous Supabase
// auth session (invisible to them) so the rest of the app — RLS policies,
// bids, rosters — works exactly the same as it does for the host.
export default function GuestJoin({ onJoined, onExit }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const displayName = name.trim();
    const roomCode = code.trim().toUpperCase();
    if (!displayName) return setError('Enter your name.');
    if (!roomCode) return setError('Enter the room code.');

    setBusy(true);
    try {
      // Reuse an existing anonymous session if this browser already has one
      // (e.g. they refreshed the page); otherwise create one on the spot.
      let { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        const { data, error: anonErr } = await supabase.auth.signInAnonymously();
        if (anonErr) throw anonErr;
        session = data.session;
      }

      const { data: room, error: findErr } = await supabase
        .from('rooms')
        .select('*')
        .eq('room_code', roomCode)
        .single();
      if (findErr || !room) throw new Error('No room found with that code.');
      if (room.status !== 'lobby') throw new Error('That draft has already started.');

      const { error: joinErr } = await supabase
        .from('room_participants')
        .insert({
            room_id: room.id,
            user_id: session.user.id,
            display_name: displayName,
            budget: room.settings.budget,
          });
          
      if (joinErr) throw joinErr;

      onJoined(room.id, roomCode);
    } catch (err) {
      setError(err.message || 'Could not join that room.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div 
      className="min-h-screen bg-cover bg-center bg-no-repeat flex items-center justify-center p-4"
      style={{
        backgroundImage: "url('/images/home.jpg')",
      }}
    >
      <div className="bg-slate-800 p-8 rounded-2xl w-full max-w-md border border-slate-700 shadow-2xl">
        <button onClick={onExit} className="text-slate-500 text-xs mb-4 hover:text-slate-300">&larr; Back</button>
        <h1 className="text-2xl font-black text-white mb-1">Join a Draft</h1>
        <p className="text-slate-400 text-sm mb-6">Just your name and the code your host sent you — no account needed.</p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            className="w-full bg-slate-950 border border-slate-700 p-4 rounded-xl text-white outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="w-full bg-slate-950 border border-slate-700 p-4 rounded-xl text-white outline-none focus:ring-2 focus:ring-blue-500 tracking-widest uppercase text-center font-bold"
            placeholder="ROOM CODE"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={5}
          />

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-4 rounded-xl transition"
          >
            {busy ? 'Joining…' : 'JOIN DRAFT'}
          </button>
        </form>
      </div>
    </div>
  );
}
