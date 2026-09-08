import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Trophy, Search, PlusCircle, Copy } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { NBA_PLAYERS } from '../data/players';
import { PandorasBoxIcon } from '../components/PandorasBoxIcon';
import YourLineup from '../components/YourLineup';
import { AlarmClockTimer } from '../components/AlarmClockTimer';
import BouncingBasketball from '../components/BouncingBasketball';
import { getSoundEnabled, setSoundEnabled, startElevatorMusic, stopElevatorMusic,} from '../lib/sound';


const PANDORA_ELIGIBLE_AFTER = 12;
const PANDORA_FORCE_AT = 20;
const PANDORA_APPEAR_CHANCE = 0.2;

// Renders the full online draft room: waiting lobby, nominating, bidding,
// and complete states — all driven by realtime updates from Supabase rather
// than local state. The actual winner-picking logic lives server-side in the
// resolve-auction Edge Function; this component just displays whatever the
// database says and submits this user's actions (join-ready, nominate, bid).
export default function OnlineDraft({ session, roomId, onExit }) {
  const myId = session.user.id;
  const [room, setRoom] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [myBid, setMyBid] = useState('');
  const [hasSubmittedBid, setHasSubmittedBid] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');
  const [showMyLineup, setShowMyLineup] = useState(false);
  const [bidCount, setBidCount] = useState(0);
  const [soundEnabled, setSoundEnabledState] = useState(getSoundEnabled());
  const [expandedRosterIds, setExpandedRosterIds] = useState(new Set());



  useEffect(() => {
    if (
      room?.status !== 'lobby' ||
      !soundEnabled ||
      !room?.created_at
    ) {
      stopElevatorMusic();
      return;
    }
  
    const lobbyStartedAt = new Date(room.created_at).getTime();
  
    startElevatorMusic(lobbyStartedAt);
  
    return () => {
      stopElevatorMusic();
    };
  }, [
    room?.status,
    room?.created_at,
    soundEnabled,
  ]);
  
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopElevatorMusic();
        return;
      }
  
      if (
        room?.status === 'lobby' &&
        soundEnabled &&
        room?.created_at
      ) {
        const lobbyStartedAt =
          new Date(room.created_at).getTime();
  
        startElevatorMusic(lobbyStartedAt);
      }
    };
  
    document.addEventListener(
      'visibilitychange',
      handleVisibilityChange
    );
  
    return () => {
      document.removeEventListener(
        'visibilitychange',
        handleVisibilityChange
      );
    };
  }, [
    room?.status,
    room?.created_at,
    soundEnabled,
  ]);

  useEffect(() => {
    if (
      room?.status !== 'bidding' ||
      !room.current_player?.auction_id
    ) {
      setBidCount(0);
      return;
    }
  
    let cancelled = false;
  
    const roundKey =
      `${room.current_player.auction_id}_${room.tie_redo_count}`;
  
    const fetchCount = async () => {
      const { data, error } = await supabase.rpc('bid_count', {
        p_room_id: roomId,
        p_round_key: roundKey,
      });
  
      if (!cancelled && !error) {
        setBidCount(data ?? 0);
      }
    };
  
    fetchCount();
  
    const interval = setInterval(fetchCount, 1000);
  
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    roomId,
    room?.status,
    room?.current_player?.auction_id,
    room?.tie_redo_count,
  ]);


  // --- Initial load + realtime subscriptions ---
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const { data: r } = await supabase.from('rooms').select('*').eq('id', roomId).single();
      const { data: ps } = await supabase.from('room_participants').select('*').eq('room_id', roomId);
      if (!cancelled) {
        setRoom(r);
        setParticipants(ps ?? []);
      }
    };
    load();

    const channel = supabase
      .channel(`room-${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            onExit();
            return;
          }
          setRoom(payload.new);
        }
      )   
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_participants', filter: `room_id=eq.${roomId}` },
        () => {
          supabase.from('room_participants').select('*').eq('room_id', roomId).then(({ data }) => setParticipants(data ?? []));
        })

      .subscribe();
      

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [roomId]);

  const [resolveError, setResolveError] = useState(null);
  const [secondsSinceDeadline, setSecondsSinceDeadline] = useState(0);

  // Reset my local bid box whenever a fresh player/round starts.
  useEffect(() => {
    setMyBid('');
    setHasSubmittedBid(false);
    setResolveError(null);
    setSecondsSinceDeadline(0);
  }, [room?.current_player?.id, room?.tie_redo_count]);

  // --- Countdown + auto-resolve trigger ---
  useEffect(() => {
    if (
      room?.status !== 'bidding' ||
      room?.is_paused ||
      !room.auction_deadline
    ) {
      if (room?.is_paused) {
        setSecondsLeft(room.paused_seconds_left ?? 0);
      }
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((new Date(room.auction_deadline) - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) {
        setSecondsSinceDeadline((s) => s + 0.25);
        // Safe to call from every client — the function only actually
        // resolves once, whoever's request lands first.
        callResolve();

        supabase
          .from('rooms')
          .select('*')
          .eq('id', roomId)
          .single()
          .then(({ data }) => {
            if (data) setRoom(data);
          });
          
      }
    };
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [
    room?.status,
    room?.auction_deadline,
    room?.is_paused,
    room?.paused_seconds_left,
  ]);

  const callResolve = useCallback(async () => {
    try {
      const { data, error: fnError } = await supabase.functions.invoke('resolve-auction', { body: { room_id: roomId } });
      if (fnError) {
        console.error('resolve-auction returned an error:', fnError);
        setResolveError(fnError.message || String(fnError));
      } else if (data?.error) {
        console.error('resolve-auction reported an error:', data.error);
        setResolveError(data.error);
      } else {
        setResolveError(null);

        const { data: freshRoom, error: refreshError } = await supabase
          .from('rooms')
          .select('*')
          .eq('id', roomId)
          .single();

        if (!refreshError && freshRoom) {
          setRoom(freshRoom);
        }
        

      }
    } catch (err) {
      // This means the call itself couldn't be made at all — e.g. the
      // function isn't deployed, or a network error. Surface it instead of
      // silently retrying forever with no explanation.
      console.error('Failed to call resolve-auction:', err);
      setResolveError(err.message || 'Could not reach the resolve-auction function.');
    }
  }, [roomId]);

  const draftedIds = useMemo(() => new Set(room?.drafted_player_ids ?? []), [room]);
  const availablePlayers = useMemo(
    () => NBA_PLAYERS.filter((p) => !draftedIds.has(p.id)),
    [draftedIds]
  );

  const rosterSize = room?.settings?.roster_size ?? 13;
  const me = participants.find((p) => p.user_id === myId);
  const isHost = room?.host_id === myId;


  const pauseAuction = async () => {
    if (!isHost || room?.status !== 'bidding' || room?.is_paused) return;
  
    const remaining = Math.max(
      0,
      Math.ceil((new Date(room.auction_deadline) - Date.now()) / 1000)
    );
  
    await supabase
      .from('rooms')
      .update({
        is_paused: true,
        paused_seconds_left: remaining,
        auction_deadline: null,
      })
      .eq('id', roomId);
  };

  const resumeAuction = async () => {
    if (!isHost || room?.status !== 'bidding' || !room?.is_paused) return;
  
    const remaining = room.paused_seconds_left ?? 0;
  
    await supabase
      .from('rooms')
      .update({
        is_paused: false,
        paused_seconds_left: null,
        auction_deadline: new Date(
          Date.now() + remaining * 1000
        ).toISOString(),
      })
      .eq('id', roomId);
  };

  const myTurn = room?.status === 'nominating' && room.nominator_order[room.current_nominator_index] === myId;
  const iAmEligibleToBid = !room?.tie_eligible_ids || room.tie_eligible_ids.includes(myId);

  const getMaxBid = (p) => {
    const slotsLeft = rosterSize - (p.roster?.length ?? 0);
  
    if (slotsLeft <= 0) return 0;
  
    const isPandora = room?.current_player?.isPandora === true;
  
    if (isPandora) {
      // Pandora does not fill a roster spot,
      // so keep $1 reserved for every remaining slot.
      return Math.max(0, p.budget - slotsLeft);
    }
  
    // Normal player fills one roster spot,
    // so only the OTHER remaining slots need $1 reserved.
    return Math.max(0, p.budget - (slotsLeft - 1));
  };

  const eligibleCount = participants.filter((p) => {
    const slotsLeft = rosterSize - (p.roster?.length ?? 0);
  
    if (slotsLeft <= 0) return false;
  
    if (
      room.tie_eligible_ids &&
      !room.tie_eligible_ids.includes(p.user_id)
    ) {
      return false;
    }
  
    if (room.current_player?.isPandora) {
      return true;
    }
  
    return getMaxBid(p) >= 1;
  }).length;


  const toggleSound = () => {
    const next = !soundEnabled;
  
    setSoundEnabled(next);
    setSoundEnabledState(next);
  };

  const toggleRosterExpanded = (userId) => {
    setExpandedRosterIds((prev) => {
      const next = new Set(prev);
  
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
  
      return next;
    });
  };
  


  // --- Actions ---


  const leaveLobby = async () => {
    if (room?.status !== 'lobby') {
      onExit();
      return;
    }
  
    const { error: leaveError } = await supabase
      .from('room_participants')
      .delete()
      .eq('room_id', roomId)
      .eq('user_id', myId);
  
    if (leaveError) {
      setError(leaveError.message);
      return;
    }
  
    onExit();
  };

  const deleteRoom = async () => {
    const confirmed = window.confirm(
      'Delete this room? This will end the draft for everyone and cannot be undone.'
    );
  
    if (!confirmed) return;
  
    const { error: deleteError } = await supabase
      .from('rooms')
      .delete()
      .eq('id', roomId);
  
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
  
    onExit();
  };

  const DeleteRoomButton = ({ className = '' }) => {
  if (!isHost) return null;

  return (
    <button
      type="button"
      onClick={deleteRoom}
      className={`bg-red-600 hover:bg-red-500 text-white text-xs font-bold px-3 py-2 rounded-lg transition ${className}`}
    >
      DELETE ROOM
    </button>
  );
};

  const toggleReady = async () => {
    await supabase.from('room_participants').update({ is_ready: !me.is_ready }).eq('room_id', roomId).eq('user_id', myId);
  };

  const startDraft = async () => {
    const order = [...participants].sort(() => Math.random() - 0.5).map((p) => p.user_id);
    await supabase.from('rooms').update({
      status: 'nominating',
      nominator_order: order,
      current_nominator_index: 0,
    }).eq('id', roomId);
  };

  const nominatePlayer = async (player) => {
    setError('');
    // Auto-award check: if everyone who can still bid is capped at exactly $1,
    // skip the auction and hand the player straight to the nominator.
    const eligible = participants.filter((p) => rosterSize - (p.roster?.length ?? 0) > 0 && getMaxBid(p) >= 1);
    const allCappedAtOne = eligible.length > 0 && eligible.every((p) => getMaxBid(p) === 1);

    if (allCappedAtOne) {
      const winner = eligible.find((p) => p.user_id === myId) || eligible[0];
      const newRoster = [...(winner.roster ?? []), { id: player.id, name: player.name, rating: player.rating, positions: player.positions ?? [], cost: 1 }];
      await supabase.from('room_participants').update({ budget: winner.budget - 1, roster: newRoster })
        .eq('room_id', roomId).eq('user_id', winner.user_id);

      await supabase.from('rooms').update({
        drafted_player_ids: [...room.drafted_player_ids, player.id],
        draft_log: [{ id: `${player.id}_${Date.now()}`, playerName: player.name, amount: 1, winnerName: winner.display_name, winnerUserId: winner.user_id, autoAwarded: true }, ...(room.draft_log ?? [])],
        status: 'results',
        results: { playerName: player.name, winnerName: winner.display_name, winnerUserId: winner.user_id, amount: 1, autoAwarded: true },
      }).eq('id', roomId);
      return;
    }

    await supabase.from('rooms').update({
      current_player: { id: player.id, name: player.name, rating: player.rating, positions: player.positions ?? [], auction_id: `${Date.now()}_${Math.random().toString(36).slice(2)}`, },
      status: 'bidding',
      auction_deadline: new Date(Date.now() + (room.settings.auction_time * 1000)).toISOString(),
      tie_eligible_ids: null,
      tie_redo_count: 0,
      is_paused: false,
      paused_seconds_left: null,
    }).eq('id', roomId);
  };

  const nominatePandorasBox = async () => {
    setError('');
  
    const { error: pandoraErr } = await supabase
      .from('rooms')
      .update({
        current_player: {
          id: 'pandora',
          name: "Pandora's Box",
          isPandora: true,
          auction_id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
        },
        status: 'bidding',
        auction_deadline: new Date(
          Date.now() + room.settings.auction_time * 1000
        ).toISOString(),
        tie_eligible_ids: null,
        tie_redo_count: 0,
        is_paused: false,
        paused_seconds_left: null,
      })
      .eq('id', roomId);
  
    if (pandoraErr) {
      setError(pandoraErr.message);
    }
  };

  const submitBid = async () => {
    if (room.is_paused) return;
    const amount = parseInt(myBid) || 0;
    const roundKey = `${room.current_player.auction_id}_${room.tie_redo_count}`;
    const { error: bidErr } = await supabase.from('bids').upsert(
      { room_id: roomId, round_key: roundKey, user_id: myId, amount },
      { onConflict: 'room_id,round_key,user_id' }
    );
    if (bidErr) { setError(bidErr.message); return; }
    setHasSubmittedBid(true);
    callResolve();
  };

  const passBid = async () => {
    if (room.is_paused) return;
    const roundKey = `${room.current_player.auction_id}_${room.tie_redo_count}`;

    const { error: bidErr } = await supabase.from('bids').upsert(
      {
        room_id: roomId,
        round_key: roundKey,
        user_id: myId,
        amount: 0,
      },
      { onConflict: 'room_id,round_key,user_id' }
    );

    if (bidErr) {
      setError(bidErr.message);
      return;
    }
    setMyBid('0');
    setHasSubmittedBid(true);
    callResolve();
  };

  // Host-only: leaves the results screen and moves to the next nominator
  // (skipping anyone whose roster is already full), or ends the draft if
  // literally everyone's full. Nothing auto-advances into this — it only
  // happens when the host clicks Continue.
  const advanceToNextNomination = async () => {
  const order = room.nominator_order;

  let idx = (room.current_nominator_index + 1) % order.length;

  let done = true;

  for (let i = 0; i < order.length; i++) {
    const p = participants.find((pp) => pp.user_id === order[idx]);

    if (p && (p.roster?.length ?? 0) < rosterSize) {
      done = false;
      break;
    }

    idx = (idx + 1) % order.length;
  }

  const completedCount = (room.completed_auction_count ?? 0) + 1;

  const pandoraEligible =
    room.pandora_enabled &&
    !room.pandora_used &&
    !room.pandora_available &&
    completedCount >= PANDORA_ELIGIBLE_AFTER;

  const shouldMakePandoraAvailable =
    pandoraEligible &&
    (
      completedCount >= PANDORA_FORCE_AT ||
      Math.random() < PANDORA_APPEAR_CHANCE
    );

  await supabase.from('rooms').update({
    current_player: null,
    results: null,
    current_nominator_index: idx,
    status: done ? 'complete' : 'nominating',
    completed_auction_count: completedCount,

    ...(shouldMakePandoraAvailable
      ? { pandora_available: true }
      : {}),
  }).eq('id', roomId);
};

  const copyRoomCode = () => navigator.clipboard.writeText(room.room_code);

  // --- Render ---
  if (!room || !me) {
    return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-500">Loading room…</div>;
  }

  if (room.status === 'lobby') {
    return (
      <div className="min-h-screen bg-slate-900 p-6 flex flex-col items-center">
        <div className="w-full max-w-2xl bg-slate-800 rounded-2xl p-6 border border-slate-700">
          
          <div className="flex items-center justify-between mb-4">
            <button
              type="button"
              onClick={leaveLobby}
              className="text-slate-500 text-xs hover:text-slate-300"
            >
              &larr; Leave room
            </button>

            <button
              type="button"
              onClick={toggleSound}
              className="text-slate-500 text-xs hover:text-slate-300 transition"
            > 
              {soundEnabled ? '🔊 SOUND ON' : '🔇 SOUND OFF'}
            </button>
      
          </div>
          
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-white text-xl font-bold">Room Code</h2>
            <button onClick={copyRoomCode} className="flex items-center gap-1 text-blue-400 text-sm hover:text-blue-300">
              <Copy size={14} /> {room.room_code}
            </button>
          </div>
          <p className="text-slate-400 text-sm mb-4">Players Ready ({participants.filter(p => p.is_ready).length}/{participants.length})</p>
          <div className="grid grid-cols-2 gap-3 mb-8">
            {participants.map((p) => (
              <div key={p.user_id} className="bg-slate-900 p-3 rounded-lg flex items-center gap-2 border border-slate-700">
                <div className={`w-2 h-2 rounded-full ${p.is_ready ? 'bg-green-500' : 'bg-slate-600'}`} />
                <span className="text-slate-300 text-sm">{p.display_name} {p.user_id === myId && '(You)'}</span>
              </div>
            ))}
          </div>
          <button onClick={toggleReady} className="w-full bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 rounded-xl transition mb-3">
            {me.is_ready ? "I'M NOT READY" : "I'M READY"}
          </button>
          {isHost && (
            <button
              onClick={startDraft}
              disabled={participants.length < 2 || !participants.every((p) => p.is_ready)}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold py-4 rounded-xl transition"
            >
              START DRAFT
            </button>
          )}
          {!isHost && <p className="text-slate-500 text-xs text-center">Waiting for the host to start once everyone's ready.</p>}
        </div>
      </div>
    );
  }

  if (room.status === 'nominating') {
    if (!myTurn) {
      const nominatorName = participants.find((p) => p.user_id === room.nominator_order[room.current_nominator_index])?.display_name;
      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
          <p className="text-slate-400 text-lg">Waiting for <span className="text-white font-bold">{nominatorName}</span> to nominate a player…</p>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-slate-900 p-6">
        <div className="max-w-4xl mx-auto">
          <header className="mb-8 flex justify-between items-end">
            <div>
              <h2 className="text-3xl font-black text-white">YOUR NOMINATION</h2>
              <p className="text-slate-400">Select a player to put up for auction</p>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-3 text-slate-500" size={18} />
              <input
                className="bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-white outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search players..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </header>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {room.pandora_available && !room.pandora_used &&(
              <button
                type="button"
                onClick={nominatePandorasBox}
                className="w-full bg-gradient-to-br from-purple-900 to-slate-800 p-5 rounded-xl border-2 border-purple-500 flex justify-between items-center hover:border-purple-300 active:border-purple-200 transition text-left md:col-span-2"
              >
                <div className="flex items-center gap-4">
                  <PandorasBoxIcon className="w-20 h-20 shrink-0" />

                  <div>
                    <h4 className="text-white font-black text-xl">
                      Pandora's Box
                    </h4>
                    <p className="text-purple-300 text-sm mt-1">
                      The winner pays their bid and gambles for a random budget reward or punishment.
                    </p>
                  </div>
                </div>

                <PlusCircle className="text-purple-300 shrink-0 ml-4" />
              </button>
            )}

            {availablePlayers
              .filter((p) => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
              .map((player) => (
                <button
                  key={player.id}
                  type="button"
                  onClick={() => nominatePlayer(player)}
                  className="w-full bg-slate-800 p-4 rounded-xl border border-slate-700 flex justify-between items-center group hover:border-blue-500 active:border-blue-400 transition text-left touch-manipulation"
                >
                  <h4 className="text-white font-bold text-lg">{player.name}</h4>
                  <span className="p-2 bg-blue-600 rounded-lg text-white opacity-100 md:opacity-0 md:group-hover:opacity-100 transition">
                    <PlusCircle />
                  </span>
                </button>
              ))}
          </div>
        </div>
      </div>
    );
  }

  if (room.status === 'bidding') {
    const maxBid = getMaxBid(me);
    const slotsLeft = rosterSize - (me.roster?.length ?? 0);
    return (
      <div className="min-h-screen bg-slate-950 text-white p-4">
        <div className="max-w-5xl mx-auto">

          <div className="flex justify-end items-center gap-2 mb-4">
            <DeleteRoomButton />

            <button
              type="button"
              onClick={toggleSound}
              className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs font-bold text-slate-300 hover:text-white transition"
            >
              {soundEnabled ? '🔊 SOUND ON' : '🔇 SOUND OFF'}
            </button>
        </div>

          {room.draft_log?.length > 0 && (
            <div className="mb-6">
              <h3 className="font-bold text-slate-500 text-xs uppercase tracking-widest mb-3">Draft Board</h3>
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory">
                {room.draft_log.map((entry, idx) => (
                  <div key={entry.id} className={`snap-start shrink-0 w-48 flex flex-col justify-between p-3 rounded-xl border text-sm ${idx === 0 ? 'bg-emerald-900/20 border-emerald-500/50' : 'bg-slate-900 border-slate-800'}`}>
                    <p className="text-white font-semibold truncate">{entry.playerName}</p>
                    <div className="flex justify-between items-end mt-2">
                      <span className={`text-xs truncate pr-2 ${entry.winnerUserId === myId ? 'text-blue-400 font-bold' : 'text-slate-500'}`}>{entry.winnerName}</span>
                      <span className="text-emerald-400 font-mono font-bold text-base">${entry.amount}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="lg:hidden mb-4">
            <button
              type="button"
              onClick={() => setShowMyLineup((prev) => !prev)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 flex items-center justify-between"
            >
              <span className="text-white font-bold text-sm">
                MY LINEUP
              </span>

              <span className="text-slate-400 text-sm">
                {(me.roster?.length ?? 0)}/13 {showMyLineup ? '▲' : '▼'}
              </span>
            </button>

            {showMyLineup && (
              <div className="mt-3">
                <YourLineup
                  roster={me.roster ?? []}
                  budget={me.budget}
                />
              </div>
            )}
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_2fr_1fr] gap-6">
            <div className="hidden lg:block">
              <YourLineup
                roster={me.roster ?? []}
                budget={me.budget}
              />
            </div>
            <div className="space-y-6">
              <div className="bg-slate-900 border border-slate-800 p-12 rounded-3xl text-center relative">
                <div className="flex flex-col items-end gap-1 sm:gap-2 mb-2">
                  <AlarmClockTimer
                    secondsLeft={
                      room.is_paused
                        ? room.paused_seconds_left ?? secondsLeft
                        : secondsLeft
                    }
                    totalSeconds={room.settings.auction_time}
                  />

                  {isHost && (
                    <button
                      onClick={room.is_paused ? resumeAuction : pauseAuction}
                      className={`px-3 py-1.5 sm:px-4 sm:py-2 lg:px-2.5 lg:py-1 rounded-lg text-[10px] sm:text-xs lg:text-[9px] font-bold uppercase tracking-wider transition ${                        room.is_paused
                          ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                          : 'bg-yellow-500 hover:bg-yellow-400 text-black'
                      }`}
                    > 
                      {room.is_paused ? 'Resume' : 'Pause'}
                    </button>
                  )}
                </div>

                <BouncingBasketball paused={room.is_paused} />

                  

                <div className="pt-12 sm:pt-10 lg:pt-6">
                  <h3 className="text-blue-500 font-bold tracking-widest uppercase mb-2">
                    Current Bid
                  </h3>

                  <h2
                    className={`font-black mb-6 tracking-tighter ${
                      (room.current_player?.name?.length ?? 0) > 18
                        ? 'text-3xl sm:text-4xl lg:text-5xl'
                        : 'text-4xl sm:text-5xl lg:text-4xl'
                    }`}
                  >
                    {room.current_player?.name}
                  </h2>
                </div>

                <div className="mb-5 flex items-center justify-center gap-3">
                  <div className="flex gap-1.5">
                    {Array.from({ length: eligibleCount }).map((_, index) => (
                      <span
                        key={index}
                        className={`w-2.5 h-2.5 rounded-full ${
                          index < bidCount
                            ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.65)]'
                            : 'bg-slate-700'
                        }`}
                      />
                    ))}
                  </div>

                  <div className="bg-slate-950/70 border border-slate-800 rounded-full px-3 py-1">
                     <span className="text-xs font-black tracking-widest uppercase text-slate-400">
                       {bidCount}/{eligibleCount} submitted
                     </span>
                  </div> 
                </div>



      
                {room.is_paused && (
                  <div className="mb-8 bg-yellow-500/10 border border-yellow-500/40 text-yellow-300 rounded-xl p-4 text-sm font-bold">
                    Auction paused by the host
                  </div>
                )}

                {room.tie_eligible_ids && (
                  <div className="mb-8 bg-yellow-500/10 border border-yellow-500/40 text-yellow-300 rounded-xl p-4 text-sm">
                    Tie! Re-auctioning this player — tied bidders only.
                  </div>
                )}

                {secondsLeft === 0 && secondsSinceDeadline > 3 && (
                  <div className="mb-8 bg-red-500/10 border border-red-500/40 text-red-300 rounded-xl p-4 text-sm text-left">
                    <p className="font-bold mb-1">Taking longer than expected to resolve this auction.</p>
                    {resolveError && <p className="text-red-400/80 text-xs mb-2 font-mono break-words">{resolveError}</p>}
                    <p className="text-red-300/70 text-xs mb-3">
                      This usually means the resolve-auction Edge Function isn't deployed or hit an error.
                      Check Supabase Dashboard → Edge Functions → resolve-auction → Logs.
                    </p>
                    <button
                      onClick={callResolve}
                      className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-200 text-xs font-bold px-4 py-2 rounded-lg transition"
                    >
                      Try Resolving Again
                    </button>
                  </div>
                )}

                {!iAmEligibleToBid ? (
                  <div className="text-slate-400 text-lg py-6">You weren't part of the tie — sit tight while it's redone.</div>
                ) : !hasSubmittedBid ? (
                  <>
                    <div className="mb-3 text-slate-400 text-sm">
                      Your Budget: <span className="text-emerald-400 font-bold">${me.budget}</span> |
                      Max Bid: <span className="text-yellow-400 font-bold">${maxBid}</span> |
                      Slots Left: <span className="text-blue-400 font-bold">{slotsLeft}</span>
                    </div>
                    <div className="max-w-xs mx-auto flex gap-2">
                      <input
                        type="number"
                        min={1}
                        className="flex-1 bg-slate-800 border border-slate-700 p-4 rounded-xl text-2xl font-bold outline-none"
                        placeholder="$"
                        value={myBid}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === '') { setMyBid(''); return; }
                          const val = parseInt(raw) || 0;
                          setMyBid(Math.max(0, Math.min(val, maxBid)).toString());
                        }}
                        max={maxBid}
                      />
                      <button
                        onClick={submitBid}
                        disabled={room.is_paused ||!myBid || parseInt(myBid) < 1 || parseInt(myBid) > maxBid}
                        className="bg-blue-600 px-6 rounded-xl font-bold hover:bg-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                      >SUBMIT</button>

                      <button
                        onClick={passBid}
                        disabled={room.is_paused}
                        className="bg-slate-700 px-4 rounded-xl font-bold hover:bg-slate-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        PASS 
                      </button>
                    </div>
                    <p className="text-slate-600 text-xs mt-3">Minimum bid is $1, or pass if you do not want to bid.</p>
                  </>
                ) : (
                  <div className="text-emerald-400 font-bold text-xl">BID LOCKED: ${myBid}</div>
                )}
                {error && <p className="text-red-400 text-sm mt-4">{error}</p>}
              </div>
            </div>

            <div className="space-y-4 max-h-screen overflow-y-auto pr-2">
              <h3 className="font-bold text-slate-500 text-xs uppercase tracking-widest">Live Rosters</h3>

              {participants.map((p) => {
                const isExpanded = expandedRosterIds.has(p.user_id);
                return (
                  <div
                    key={p.user_id}
                    className={`p-4 rounded-xl border ${
                      p.user_id === myId
                        ? 'bg-blue-900/20 border-blue-500'
                        : 'bg-slate-900 border-slate-800'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleRosterExpanded(p.user_id)}
                      className="w-full text-left"
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-sm">
                          {p.display_name} {p.user_id === myId && '(You)'}
                        </span>

                        <div className="flex items-center gap-2">
                          <span className="text-emerald-400 font-mono text-sm">
                            ${p.budget}
                          </span>

                          <span className="text-slate-500 text-xs">
                            {isExpanded ? '▲' : '▼'}
                          </span>
                        </div>
                      </div>

                      {!isExpanded && (
                        <>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {(p.roster ?? []).map((player, i) => (
                              <div
                                key={i}
                                className="text-[10px] bg-slate-800 px-2 py-1 rounded text-slate-300 border border-slate-700"
                                title={`${player.name} ($${player.cost})`}
                              >
                                {player.name.split(' ').pop()}
                              </div>
                            ))} 

                            {(!p.roster || p.roster.length === 0) && (
                              <div className="text-[10px] text-slate-600 italic">
                                Empty Roster
                              </div>
                            )}
                          </div>

                          <div className="text-[10px] text-slate-600 mt-2">
                            {p.roster?.length ?? 0}/{rosterSize} slots filled
                          </div>
                        </>
                      )}  
                    </button>

                    {isExpanded && (
                      <div className="mt-3">
                        <YourLineup
                          roster={p.roster ?? []}
                          budget={p.budget}
                          title={
                            p.user_id === myId
                              ? 'Your Lineup'
                              : `${p.display_name}'s Lineup`
                          }
                          compact
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

          </div>
        </div>
      </div>
    );
  }

  if (room.status === 'results') {
    const r = room.results ?? {};
    return (
      <div className="min-h-screen bg-slate-950 text-white p-4">
        <div className="max-w-5xl mx-auto">
          <div className="flex justify-end mb-4">
            <DeleteRoomButton />
          </div>
          {room.draft_log?.length > 0 && (
            <div className="mb-6">
              <h3 className="font-bold text-slate-500 text-xs uppercase tracking-widest mb-3">Draft Board</h3>
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory">
                {room.draft_log.map((entry, idx) => (
                  <div key={entry.id} className={`snap-start shrink-0 w-48 flex flex-col justify-between p-3 rounded-xl border text-sm ${idx === 0 ? 'bg-emerald-900/20 border-emerald-500/50' : 'bg-slate-900 border-slate-800'}`}>
                    <p className="text-white font-semibold truncate">{entry.playerName}</p>
                    <div className="flex justify-between items-end mt-2">
                      <span className={`text-xs truncate pr-2 ${entry.winnerUserId === myId ? 'text-blue-400 font-bold' : 'text-slate-500'}`}>{entry.winnerName}</span>
                      <span className="text-emerald-400 font-mono font-bold text-base">${entry.amount}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="lg:hidden mb-4">
            <button
              type="button"
              onClick={() => setShowMyLineup((prev) => !prev)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 flex items-center justify-between"
            >
              <span className="text-white font-bold text-sm">
                MY LINEUP
              </span>

              <span className="text-slate-400 text-sm">
                {(me.roster?.length ?? 0)}/13 {showMyLineup ? '▲' : '▼'}
              </span>
            </button>

            {showMyLineup && (
              <div className="mt-3">
                <YourLineup
                  roster={me.roster ?? []}
                  budget={me.budget}
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_2fr_1fr] gap-6">
            <div className="hidden lg:block">
              <YourLineup
                roster={me.roster ?? []}
                budget={me.budget}
              />
            </div>
            <div className="space-y-6">
              <div className="bg-slate-900 border-2 border-yellow-500/50 p-12 rounded-3xl text-center">
              {!r.isPandora && (
                <Trophy className="mx-auto text-yellow-400 mb-4" size={48} />
              )}
                {r.isPandora && r.noSale ? (
                  <>
                    <PandorasBoxIcon className="w-24 h-24 mx-auto mb-4" />
                    <h2 className="text-3xl font-black mb-2">
                      Pandora's Box Goes Unopened
                    </h2>

                    <p className="text-slate-400 mb-6">
                      Nobody bid on it, so it remains available for a future nomination.
                    </p>
                  </>
                ) : r.isPandora ? (
                  <>
                    <PandorasBoxIcon className="w-24 h-24 mx-auto mb-4" />


                    <h2
                      className={`font-black mb-2 break-words ${
                        (r.winnerName?.length ?? 0) > 14
                          ? 'text-2xl sm:text-3xl lg:text-4xl'
                          : 'text-4xl'
                      } ${
                        r.winnerUserId === myId ? 'text-blue-400' : ''
                      }`}
                    >
                      {r.winnerName}
                      {r.winnerUserId === myId && ' (You)'}
                    </h2>

                    <p className="text-2xl text-slate-400 mb-2">
                      Paid{' '}
                      <span className="text-white font-black">
                        ${r.amount}
                      </span>{' '}
                      for Pandora's Box
                    </p>


                    <p
                      className={`text-3xl font-black mb-2 ${
                        r.appliedAmount >= 0
                          ? 'text-emerald-400'
                          : 'text-red-400'
                      }`}
                    >
                      {r.appliedAmount >= 0 ? '+' : ''}
                      {r.appliedAmount} budget
                    </p>

                    <p className="text-slate-500 text-sm mb-4">
                      Final budget: ${r.finalBudget}
                    </p>

                    {r.wasClamped && (
                      <p className="text-yellow-400/80 text-xs mb-4">
                        Pandora rolled {r.gambleAmount >= 0 ? '+' : ''}
                        {r.gambleAmount}, but the budget was protected at the minimum needed to fill the remaining roster.
                       </p>
                    
                    )}
                  </>
                ) : r.noSale ? (
                  <>
                    <h2 className="text-3xl font-black mb-2">
                      No Sale
                    </h2>
                
                    <p className="text-slate-400 mb-6">
                      Nobody had budget or roster room to bid on {r.playerName}.
                    </p>
                  </>
                ) : (

                  <>
                    <h2
                      className={`font-black mb-2 break-words ${
                        (r.winnerName?.length ?? 0) > 14
                          ? 'text-2xl sm:text-3xl lg:text-4xl'
                          : 'text-4xl'
                      } ${
                        r.winnerUserId === myId ? 'text-blue-400' : ''
                      }`}
                    >
                      {r.winnerName}
                      {r.winnerUserId === myId && ' (You)'}
                    </h2>


                    <p className="text-2xl text-slate-400 mb-2">
                      Won {r.playerName} for{' '}
                      <span className="text-white font-black">
                        ${r.amount}
                      </span>
                    </p>


                    {r.wasCoinFlip && (
                      <p className="text-yellow-400/80 text-xs mb-4">
                        Still tied after several redos — broken with a coin flip.
                      </p>
                    )}

                    {r.autoAwarded && (
                      <p className="text-blue-400/80 text-xs mb-4">
                        Everyone left was capped at $1 — autoawarded to the nominator, no bidding war needed.
                      </p>
                    )}
                  </>
                )}


                {r.allBids?.length > 0 && (
                  <div className="max-w-md mx-auto bg-slate-950 rounded-xl p-4 mb-6 max-h-64 overflow-y-auto">
                    <h4 className="text-slate-400 text-sm font-bold mb-3 uppercase tracking-wider">All Bids</h4>
                    <div className="space-y-2">
                      {r.allBids.map((b, idx) => (
                        <div key={b.userId} className="flex justify-between items-center text-sm">
                          <span className={b.userId === myId ? 'text-blue-400 font-bold' : 'text-slate-300'}>
                            {idx + 1}. {b.name} {b.userId === myId && '(You)'}
                          </span>
                          <span className={`font-mono ${idx === 0 && b.bid > 0 ? 'text-yellow-400 font-bold' : 'text-slate-500'}`}>${b.bid}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {isHost ? (
                  <button
                    onClick={advanceToNextNomination}
                    className="bg-white text-black px-10 py-3 rounded-full font-black uppercase tracking-widest hover:bg-slate-200 transition"
                  >
                    Continue
                  </button>
                ) : (
                  <p className="text-slate-500 text-sm">Waiting for the host to continue…</p>
                )}
              </div>
            </div>

            <div className="space-y-4 max-h-screen overflow-y-auto pr-2">
              <h3 className="font-bold text-slate-500 text-xs uppercase tracking-widest">Live Rosters</h3>

              {participants.map((p) => {
                const isExpanded = expandedRosterIds.has(p.user_id);
                return (
                  <div
                    key={p.user_id}
                    className={`p-4 rounded-xl border ${
                      p.user_id === myId
                        ? 'bg-blue-900/20 border-blue-500'
                        : 'bg-slate-900 border-slate-800'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleRosterExpanded(p.user_id)}
                      className="w-full text-left"
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-sm">
                          {p.display_name} {p.user_id === myId && '(You)'}
                        </span>

                        <div className="flex items-center gap-2">
                          <span className="text-emerald-400 font-mono text-sm">
                            ${p.budget}
                          </span>

                          <span className="text-slate-500 text-xs">
                            {isExpanded ? '▲' : '▼'}
                          </span>
                        </div>
                      </div>

                      {!isExpanded && (
                        <>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {(p.roster ?? []).map((player, i) => (
                              <div
                                key={i}
                                className="text-[10px] bg-slate-800 px-2 py-1 rounded text-slate-300 border border-slate-700"
                                title={`${player.name} ($${player.cost})`}
                              >
                                {player.name.split(' ').pop()}
                              </div>
                            ))} 

                            {(!p.roster || p.roster.length === 0) && (
                              <div className="text-[10px] text-slate-600 italic">
                                Empty Roster
                              </div>
                            )}
                          </div>

                          <div className="text-[10px] text-slate-600 mt-2">
                            {p.roster?.length ?? 0}/{rosterSize} slots filled
                          </div>
                        </>
                      )}  
                    </button>

                    {isExpanded && (
                      <div className="mt-3">
                        <YourLineup
                          roster={p.roster ?? []}
                          budget={p.budget}
                          title={
                            p.user_id === myId
                              ? 'Your Lineup'
                              : `${p.display_name}'s Lineup`
                          }
                          compact
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (room.status === 'complete') {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-8">
        <div className="flex justify-end mb-6">
          <DeleteRoomButton />
        </div>
        <h1 className="text-5xl font-black text-center mb-12 text-yellow-400 italic">DRAFT SUMMARY</h1>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...participants]
            .sort((a, b) => (b.roster ?? []).reduce((s, pl) => s + (pl.rating ?? 0), 0) - (a.roster ?? []).reduce((s, pl) => s + (pl.rating ?? 0), 0))
            .map((p, idx) => (
              <div key={p.user_id} className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-yellow-500 font-black">#{idx + 1}</span>
                  <span className="text-xs font-bold text-slate-500">{p.roster?.length ?? 0}/{rosterSize} filled</span>
                </div>
                <h3 className="font-bold text-lg mb-4">{p.display_name}</h3>
                <div className="space-y-1">
                  {(p.roster ?? []).map((player, i) => (
                    <div key={i} className="text-xs flex justify-between text-slate-400">
                      <span>{player.name}</span>
                      <span>${player.cost}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      </div>
    );
  }

  return null;
}
