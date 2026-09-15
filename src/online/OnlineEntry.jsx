import React from 'react';
import { Crown, UserPlus } from 'lucide-react';

export default function OnlineEntry({ onChooseHost, onChooseGuest, onExit }) {
  return (
    <div 
      className="min-h-screen bg-cover bg-center bg-no-repeat flex items-center justify-center p-4"
      style={{
        backgroundImage: "url('/images/home.jpg')",
      }}
    >
      <div className="bg-slate-800 p-8 rounded-2xl w-full max-w-md border border-slate-700 shadow-2xl">
        <button onClick={onExit} className="text-slate-500 text-xs mb-4 hover:text-slate-300">&larr; Back</button>
        <h1 className="text-2xl font-black text-white mb-1">Online Draft</h1>
        <p className="text-slate-400 text-sm mb-6">Are you hosting, or joining someone else's draft?</p>

        <div className="space-y-3">
          <button
            onClick={onChooseGuest}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl transition"
          >
            <UserPlus size={20} /> I HAVE A ROOM CODE
          </button>
          <button
            onClick={onChooseHost}
            className="w-full flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-white font-bold py-4 rounded-xl transition"
          >
            <Crown size={20} /> I'M HOSTING
          </button>
        </div>

        <p className="text-slate-600 text-xs text-center mt-6">
          Joining with a code needs nothing but your name. Hosting needs a quick account so you can create and manage the room.
        </p>
      </div>
    </div>
  );
}
