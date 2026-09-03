import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import OnlineEntry from './OnlineEntry';
import GuestJoin from './GuestJoin';
import AuthGate from './AuthGate';
import OnlineLobby from './OnlineLobby';
import OnlineDraft from './OnlineDraft';

// Remembers which room a person was last in, in this browser, so closing
// the tab or getting knocked offline doesn't mean re-typing a code — they
// land right back in the draft when they reopen the site. This does NOT
// mean draft progress is otherwise at risk: budgets/rosters/bids all live
// in Supabase regardless of what this browser remembers.
const STORAGE_KEY = 'fantasy-draft:lastRoom';

export default function OnlineApp({ onExit }) {
  const [view, setView] = useState('checking'); // checking | entry | guestJoin | hostAuth | draft
  const [roomId, setRoomId] = useState(null);
  const [session, setSession] = useState(null);

  // On mount: if this browser already has a session (guest or host) and a
  // saved room it's still actually part of, skip straight back into the
  // draft instead of showing the entry screen again.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = localStorage.getItem(STORAGE_KEY);
      const { data: { session: existingSession } } = await supabase.auth.getSession();
      if (cancelled) return;
      setSession(existingSession);

      if (saved && existingSession) {
        const { room_id } = JSON.parse(saved);
        const { data: participantRow } = await supabase
          .from('room_participants')
          .select('room_id')
          .eq('room_id', room_id)
          .eq('user_id', existingSession.user.id)
          .maybeSingle();
        if (!cancelled && participantRow) {
          setRoomId(room_id);
          setView('draft');
          return;
        }
        localStorage.removeItem(STORAGE_KEY);
      }
      if (!cancelled) setView('entry');
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const enterRoom = (id) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ room_id: id }));
    setRoomId(id);
    setView('draft');
  };

  const leaveRoom = () => {
    localStorage.removeItem(STORAGE_KEY);
    setRoomId(null);
    setView('entry');
  };

  if (view === 'checking') {
    return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-500">Loading…</div>;
  }

  if (view === 'entry') {
    return (
      <OnlineEntry
        onChooseGuest={() => setView('guestJoin')}
        onChooseHost={() => setView('hostAuth')}
        onExit={onExit}
      />
    );
  }

  if (view === 'guestJoin') {
    return <GuestJoin onJoined={enterRoom} onExit={() => setView('entry')} />;
  }

  if (view === 'hostAuth') {
    return (
      <AuthGate onExit={() => setView('entry')}>
        {({ session: hostSession, profile }) => (
          <OnlineLobby
            session={hostSession}
            profile={profile}
            onEnterRoom={enterRoom}
            onExit={() => setView('entry')}
          />
        )}
      </AuthGate>
    );
  }

  if (view === 'draft' && roomId && session) {
    return <OnlineDraft session={session} roomId={roomId} onExit={leaveRoom} />;
  }

  return null;
}
