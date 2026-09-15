import React, { useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const genRoomCode = () =>
  Math.random().toString(36).slice(2, 7).toUpperCase();

// Handles both creating a new room and joining an existing one by code.
// Calls onEnterRoom(roomId) once the person has successfully joined.
export default function OnlineLobby({ session, profile, onEnterRoom, onExit , onLogout}) {
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [pandoraEnabled, setPandoraEnabled] = useState(false);

  const createRoom = async () => {
    setBusy(true);
    setError('');
    try {
      const room_code = genRoomCode();
      const { data: room, error: roomErr } = await supabase
        .from('rooms')
        .insert({ room_code, host_id: session.user.id, pandora_enabled: pandoraEnabled, })
        .select()
        .single();
      if (roomErr) throw roomErr;

      const { error: joinErr } = await supabase.from('room_participants').insert({
        room_id: room.id,
        user_id: session.user.id,
        display_name: profile.display_name,
        budget: room.settings.budget,
      });
      if (joinErr) throw joinErr;

      onEnterRoom(room.id);
    } catch (err) {
      setError(err.message || 'Could not create room.');
    } finally {
      setBusy(false);
    }
  };

  const joinRoom = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const code = joinCode.trim().toUpperCase();
      if (!code) throw new Error('Enter a room code.');

      const { data: room, error: findErr } = await supabase
        .from('rooms')
        .select('*')
        .eq('room_code', code)
        .single();
      if (findErr || !room) throw new Error('No room found with that code.');
      if (room.status !== 'lobby') throw new Error('That draft has already started.');

      const { error: joinErr } = await supabase
        .from('room_participants')
        .upsert(
          {
            room_id: room.id,
            user_id: session.user.id,
            display_name: profile.display_name,
            budget: room.settings.budget,
          },
          { onConflict: 'room_id,user_id', ignoreDuplicates: true }
        );
      if (joinErr) throw joinErr;

      onEnterRoom(room.id);
    } catch (err) {
      setError(err.message || 'Could not join room.');
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
        <div className="flex items-center justify-between mb-4">
          <button
            type="button"
            onClick={onExit}
            className="text-slate-500 text-xs hover:text-slate-300"
          >
            &larr; Back
          </button>

          <button
            type="button"
            onClick={onLogout}
            className="text-red-400 text-xs font-bold hover:text-red-300 transition"
          >
            LOG OUT
          </button>
        </div>
        <h1 className="text-2xl font-black text-white mb-1">Online Draft</h1>
        <p className="text-slate-400 text-sm mb-6">Signed in as {profile.display_name}</p>

        <label className="flex items-center justify-between bg-slate-900 border border-slate-700 rounded-xl p-4 mb-4 cursor-pointer">
          <div className="pr-4">
            <p className="text-white font-bold text-sm">Pandora's Box</p>
            <p className="text-slate-500 text-xs">
              Enable a rare one time mystery auction that can increase or decrease the winner's budget.
            </p>
          </div>

          <input
            type="checkbox"
            checked={pandoraEnabled}
            onChange={(e) => setPandoraEnabled(e.target.checked)}
            className="w-5 h-5 accent-purple-500 shrink-0"
          />
        </label>
        
        <button
          onClick={createRoom}
          disabled={busy}
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold py-4 rounded-xl transition mb-6"
        >
          CREATE A ROOM
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="h-px bg-slate-700 flex-1" />
          <span className="text-slate-500 text-xs">OR</span>
          <div className="h-px bg-slate-700 flex-1" />
        </div>

        <form onSubmit={joinRoom} className="space-y-3">
          <input
            className="w-full bg-slate-950 border border-slate-700 p-4 rounded-xl text-white outline-none focus:ring-2 focus:ring-blue-500 tracking-widest uppercase text-center font-bold"
            placeholder="ROOM CODE"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            maxLength={5}
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition"
          >
            JOIN ROOM
          </button>
        </form>

        {error && <p className="text-red-400 text-sm mt-4">{error}</p>}
      </div>
    </div>
  );
}
