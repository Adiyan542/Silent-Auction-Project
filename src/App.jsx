import React, { useState } from 'react';
import { Users } from 'lucide-react';
import { isOnlineConfigured } from './lib/supabaseClient';
import OnlineApp from './online/OnlineApp';

function App() {
  const [mode, setMode] = useState('menu');

  if (mode === 'online') {
    return <OnlineApp onExit={() => setMode('menu')} />;
  }

  return (
    <div 
      className="min-h-screen bg-cover bg-center bg-no-repeat flex items-center justify-center p-4"
      style={{
        backgroundImage: "url('/images/home.jpg')",
      }}
    >
      <div className="bg-slate-800 p-8 rounded-2xl w-full max-w-md border border-slate-700 shadow-2xl">

        <h1 className="text-3xl font-black text-white text-center mb-2 tracking-tighter">
          BLIND BID AUCTION
        </h1>

        <p className="text-slate-400 text-center text-sm mb-8">
          You snooze you lose!
        </p>

        <button
          onClick={() => setMode('online')}
          disabled={!isOnlineConfigured}
          title={
            isOnlineConfigured
              ? undefined
              : 'Online mode needs Supabase set up'
          }
          className={`w-full flex items-center justify-center gap-2 font-bold py-4 rounded-xl transition ${
            isOnlineConfigured
              ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
              : 'bg-slate-700/50 text-slate-400 cursor-not-allowed'
          }`}
        >
          <Users size={20} />
          PLAY ONLINE WITH FRIENDS

          {!isOnlineConfigured && (
            <span className="text-[10px] uppercase tracking-widest bg-slate-600 text-slate-300 px-2 py-0.5 rounded-full ml-1">
              Setup needed
            </span>
          )}
        </button>

        <p className="text-slate-600 text-xs text-center mt-6">
          A different way to draft and play with your friends.
        </p>

      </div>
    </div>
  );
}

export default App;