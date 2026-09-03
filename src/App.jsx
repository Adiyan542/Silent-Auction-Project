import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Clock, DollarSign, Trophy, Users, Copy, UserPlus, Play, Crown, Star, Search, PlusCircle, Bot, Gamepad2 } from 'lucide-react';
import { NBA_PLAYERS } from './data/players';
import { isOnlineConfigured } from './lib/supabaseClient';
import OnlineApp from './online/OnlineApp';

// --- Constants ---
const AUCTION_TIME = 3; // testing only — bump back to 30 before playing for real
const STARTING_BUDGET = 200;
const ROSTER_SIZE = 13;

const FantasyBasketballDraft = ({ onGoOnline }) => {
  const [gameState, setGameState] = useState('lobby');
  const [playerName, setPlayerName] = useState('');
  const [myPlayerId, setMyPlayerId] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [currentPlayer, setCurrentPlayer] = useState(null);
  const [timeLeft, setTimeLeft] = useState(AUCTION_TIME);
  const [userBid, setUserBid] = useState('');
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [results, setResults] = useState(null);
  const [draftedPlayerIds, setDraftedPlayerIds] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [nominatorIndex, setNominatorIndex] = useState(0);
  // null = everyone is eligible to bid this round.
  // array of participant ids = only these participants may bid (tie-break redo round).
  const [eligibleBidderIds, setEligibleBidderIds] = useState(null);
  const [tieBanner, setTieBanner] = useState(null); // { names, amount } shown briefly before redo
  // Counts consecutive tied redos for the SAME player. Bots that are budget-capped
  // will keep re-bidding the exact same number forever, so after a few tries we
  // break the tie ourselves instead of looping indefinitely.
  const [tieRedoCount, setTieRedoCount] = useState(0);
  // Running log of every completed sale, most recent first — powers the "Draft Board" sidebar.
  const [draftLog, setDraftLog] = useState([]);

  // --- Helpers ---
  const generateBots = () => {
    const strategies = ['aggressive', 'balanced', 'value'];
    return Array.from({ length: 11 }, (_, i) => ({
      id: `bot_${i}`,
      name: `Bot ${i + 1}`,
      budget: STARTING_BUDGET,
      roster: [],
      isBot: true,
      strategy: strategies[i % 3]
    }));
  };

  const availablePlayers = useMemo(() =>
    NBA_PLAYERS.filter(p => !draftedPlayerIds.includes(p.id)),
    [draftedPlayerIds]
  );

  // Highest bid a participant is allowed to place: their whole budget,
  // minus at least $1 reserved for every OTHER remaining roster slot,
  // and never less than $1 if they still have a slot to fill and can afford it.
  const getMaxBid = (participant) => {
    const slotsLeft = ROSTER_SIZE - participant.roster.length;
    if (slotsLeft <= 0) return 0;
    return Math.max(0, participant.budget - (slotsLeft - 1));
  };

  const resolveAuction = useCallback(() => {
    const allBids = participants.map(p => {
      const slotsLeft = ROSTER_SIZE - p.roster.length;
      const maxPossible = getMaxBid(p);

      // Not eligible this round (lost the tie-break redo) or no slots left or can't afford  -> can't bid
      if (slotsLeft <= 0 || maxPossible < 1) {
        return { participant: p, bid: 0, eligible: false };
      }
      if (eligibleBidderIds && !eligibleBidderIds.includes(p.id)) {
        return { participant: p, bid: 0, eligible: false };
      }

      let bid;
      if (p.id === myPlayerId) {
        bid = parseInt(userBid) || 0;
      } else {
        const multiplier = p.strategy === 'aggressive' ? 0.75 : p.strategy === 'value' ? 0.4 : 0.55;
        const baseBid = (currentPlayer.rating - 50) * multiplier;
        const variance = Math.random() * 0.4 - 0.2;
        // Every eligible bot bids at least $1 so nobody is ever drafted for free.
        bid = Math.max(1, Math.floor(baseBid * (1 + variance)));
      }
      bid = Math.max(1, Math.min(bid, maxPossible));
      return { participant: p, bid, eligible: true };
    }).sort((a, b) => b.bid - a.bid);

    const eligibleBids = allBids.filter(b => b.eligible);
    const topBid = eligibleBids[0];

    if (!topBid) {
      // Nobody could bid at all (shouldn't really happen) - skip this player, no sale.
      setDraftedPlayerIds(prev => [...prev, currentPlayer.id]);
      setResults({ winner: null, amount: 0, allBids, noSale: true });
      setGameState('results');
      return;
    }

    const tiedTop = eligibleBids.filter(b => b.bid === topBid.bid);

    const MAX_TIE_REDOS = 3;
    if (tiedTop.length > 1 && tieRedoCount < MAX_TIE_REDOS) {
      // TIE: redo the auction for this exact player, only the tied bidders get to bid again.
      setTieBanner({ names: tiedTop.map(b => b.participant.name), amount: topBid.bid });
      setEligibleBidderIds(tiedTop.map(b => b.participant.id));
      setTieRedoCount(prev => prev + 1);
      setUserBid('');
      setHasSubmitted(false);
      setTimeLeft(AUCTION_TIME);
      setGameState('bidding');
      return;
    }

    // Either a unique winner, or the tie survived several redos (almost always because
    // the tied bidders are budget-capped at the same max) — break it with a coin flip
    // so the draft never gets stuck.
    const winningBid = tiedTop.length > 1
      ? tiedTop[Math.floor(Math.random() * tiedTop.length)]
      : topBid;

    setParticipants(prev => prev.map(p => {
      if (p.id === winningBid.participant.id) {
        return {
          ...p,
          budget: p.budget - winningBid.bid,
          roster: [...p.roster, { ...currentPlayer, cost: winningBid.bid }]
        };
      }
      return p;
    }));
    setDraftedPlayerIds(prev => [...prev, currentPlayer.id]);
    setResults({
      winner: winningBid.participant,
      amount: winningBid.bid,
      allBids,
      wasCoinFlip: tiedTop.length > 1
    });
    setDraftLog(prev => [
      { id: `${currentPlayer.id}_${Date.now()}`, playerName: currentPlayer.name, amount: winningBid.bid, winnerName: winningBid.participant.name, isMe: winningBid.participant.id === myPlayerId },
      ...prev
    ]);
    setEligibleBidderIds(null);
    setTieBanner(null);
    setTieRedoCount(0);
    setGameState('results');
  }, [participants, myPlayerId, userBid, currentPlayer, eligibleBidderIds, tieRedoCount]);

  useEffect(() => {
    let timer;
    if (gameState === 'bidding' && timeLeft > 0) {
      timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
    } else if (gameState === 'bidding' && timeLeft === 0) {
      resolveAuction();
    }
    return () => clearTimeout(timer);
  }, [timeLeft, gameState, resolveAuction]);

  // --- Handlers ---
  const startPractice = () => {
    if (!playerName.trim()) return;
    const hostId = `user_${Date.now()}`;
    setMyPlayerId(hostId);
    setParticipants([
      { id: hostId, name: playerName, budget: STARTING_BUDGET, roster: [], isBot: false },
      ...generateBots()
    ]);
    setGameState('lobby-waiting');
  };

  const startNextTurn = () => {
    setEligibleBidderIds(null);
    setTieBanner(null);
    setTieRedoCount(0);
    if (availablePlayers.length === 0 || participants.every(p => p.roster.length >= ROSTER_SIZE)) {
      setGameState('complete');
      return;
    }

    // Skip anyone whose roster is already full — only participants still actively
    // drafting get a turn to nominate.
    let idx = nominatorIndex;
    for (let i = 0; i < participants.length; i++) {
      if (participants[idx].roster.length < ROSTER_SIZE) break;
      idx = (idx + 1) % participants.length;
    }
    if (idx !== nominatorIndex) setNominatorIndex(idx);

    const nominator = participants[idx];
    if (nominator.isBot) {
      nominatePlayer(availablePlayers[0], idx);
    } else {
      setGameState('nominating');
    }
  };

  // Hands a player straight to a winner without running an auction round —
  // used for the "everyone's capped at $1" auto-award case.
  const awardPlayerAutomatically = (player, winner, priorParticipants) => {
    const bidAmount = 1;
    setParticipants(prev => prev.map(p =>
      p.id === winner.id
        ? { ...p, budget: p.budget - bidAmount, roster: [...p.roster, { ...player, cost: bidAmount }] }
        : p
    ));
    setDraftedPlayerIds(prev => [...prev, player.id]);
    const allBids = priorParticipants
      .map(p => ({
        participant: p,
        bid: (ROSTER_SIZE - p.roster.length) > 0 && getMaxBid(p) >= 1 ? 1 : 0
      }))
      .sort((a, b) => (b.participant.id === winner.id ? 1 : 0) - (a.participant.id === winner.id ? 1 : 0) || b.bid - a.bid);
    setResults({ winner, amount: bidAmount, allBids, autoAwarded: true });
    setDraftLog(prev => [
      { id: `${player.id}_${Date.now()}`, playerName: player.name, amount: bidAmount, winnerName: winner.name, isMe: winner.id === myPlayerId },
      ...prev
    ]);
    setGameState('results');
  };

  const nominatePlayer = (player, nominatorIdxOverride) => {
    const idx = nominatorIdxOverride !== undefined ? nominatorIdxOverride : nominatorIndex;
    const nominator = participants[idx];
    setCurrentPlayer(player);
    setUserBid('');
    setHasSubmitted(false);
    setResults(null);
    setEligibleBidderIds(null);
    setTieBanner(null);
    setTieRedoCount(0);
    setNominatorIndex((idx + 1) % participants.length);

    // If every participant who could still bid on this player is capped at exactly
    // $1 (because their remaining budget only covers $1-per-remaining-slot), a bidding
    // war can't actually happen — everyone's ceiling is the same $1. Skip straight to
    // awarding the player to whoever nominated them.
    const eligibleBidders = participants.filter(p =>
      (ROSTER_SIZE - p.roster.length) > 0 && getMaxBid(p) >= 1
    );
    const allCappedAtOne = eligibleBidders.length > 0 && eligibleBidders.every(p => getMaxBid(p) === 1);

    if (allCappedAtOne) {
      const winner = eligibleBidders.find(p => p.id === nominator.id) || eligibleBidders[0];
      awardPlayerAutomatically(player, winner, participants);
      return;
    }

    setTimeLeft(AUCTION_TIME);
    setGameState('bidding');
  };

  // --- Render Sections ---

  if (gameState === 'lobby') return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-slate-800 p-8 rounded-2xl w-full max-w-md border border-slate-700 shadow-2xl">
        <h1 className="text-3xl font-black text-white text-center mb-2 tracking-tighter">SILENT BID AUCTION</h1>
        <p className="text-slate-400 text-center text-sm mb-8">You snooze you lose!</p>
        <input
          className="w-full bg-slate-950 border border-slate-700 p-4 rounded-xl text-white mb-4 outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Enter Manager Name"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
        />

        <div className="space-y-3">
          <button
            onClick={startPractice}
            disabled={!playerName.trim()}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl transition"
          >
            <Bot size={20} /> PRACTICE (vs 11 AI Bots)
          </button>

          <button
            onClick={onGoOnline}
            disabled={!isOnlineConfigured}
            title={isOnlineConfigured ? undefined : 'Online mode needs Supabase set up — see SETUP.md'}
            className={`w-full flex items-center justify-center gap-2 font-bold py-4 rounded-xl transition ${
              isOnlineConfigured
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                : 'bg-slate-700/50 text-slate-400 cursor-not-allowed'
            }`}
          >
            <Users size={20} /> PLAY ONLINE WITH FRIENDS
            {!isOnlineConfigured && (
              <span className="text-[10px] uppercase tracking-widest bg-slate-600 text-slate-300 px-2 py-0.5 rounded-full ml-1">Setup needed</span>
            )}
          </button>
        </div>

        <p className="text-slate-600 text-xs text-center mt-6">
          A different way to draft and play with your friends.
        </p>
      </div>
    </div>
  );

  if (gameState === 'lobby-waiting') return (
    <div className="min-h-screen bg-slate-900 p-6 flex flex-col items-center">
      <div className="w-full max-w-2xl bg-slate-800 rounded-2xl p-6 border border-slate-700">
        <h2 className="text-white text-xl font-bold mb-1">Practice Draft</h2>
        <p className="text-slate-400 text-sm mb-4">Managers Ready ({participants.length}/12)</p>
        <div className="grid grid-cols-2 gap-3 mb-8">
          {participants.map(p => (
            <div key={p.id} className="bg-slate-900 p-3 rounded-lg flex items-center gap-2 border border-slate-700">
              <div className={`w-2 h-2 rounded-full ${p.isBot ? 'bg-slate-500' : 'bg-green-500 animate-pulse'}`} />
              <span className="text-slate-300 text-sm">{p.name} {p.id === myPlayerId && "(You)"}</span>
            </div>
          ))}
        </div>
        <button onClick={startNextTurn} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-4 rounded-xl transition">
          START DRAFT
        </button>
      </div>
    </div>
  );

  if (gameState === 'nominating') return (
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
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {availablePlayers
            .filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
            .map(player => (
            <div key={player.id} className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex justify-between items-center group hover:border-blue-500 transition">
              <h4 className="text-white font-bold text-lg">{player.name}</h4>
              <button
                onClick={() => nominatePlayer(player)}
                className="p-2 bg-blue-600 rounded-lg text-white opacity-0 group-hover:opacity-100 transition"
              >
                <PlusCircle />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (gameState === 'bidding' || gameState === 'results') {
    const me = participants.find(p => p.id === myPlayerId);
    const slotsLeft = ROSTER_SIZE - me.roster.length;
    const maxBid = getMaxBid(me);
    const iAmEligible = !eligibleBidderIds || eligibleBidderIds.includes(myPlayerId);

    return (
      <div className="min-h-screen bg-slate-950 text-white p-4">
        <div className="max-w-5xl mx-auto">

          {/* Draft Board: live-updating feed of what every player sold for, scrolls horizontally */}
          <div className="mb-6">
            <h3 className="font-bold text-slate-500 text-xs uppercase tracking-widest mb-3">Draft Board</h3>
            {draftLog.length === 0 ? (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-slate-600 text-xs italic">
                No sales yet — the first result will show up here.
              </div>
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory">
                {draftLog.map((entry, idx) => (
                  <div
                    key={entry.id}
                    className={`snap-start shrink-0 w-48 flex flex-col justify-between p-3 rounded-xl border text-sm transition ${
                      idx === 0
                        ? 'bg-emerald-900/20 border-emerald-500/50 animate-pulse'
                        : 'bg-slate-900 border-slate-800'
                    }`}
                  >
                    <p className="text-white font-semibold truncate">{entry.playerName}</p>
                    <div className="flex justify-between items-end mt-2">
                      <span className={`text-xs truncate pr-2 ${entry.isMe ? 'text-blue-400 font-bold' : 'text-slate-500'}`}>
                        {entry.winnerName}{entry.isMe && ' (You)'}
                      </span>
                      <span className="text-emerald-400 font-mono font-bold text-base shrink-0">${entry.amount}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Stage */}
          <div className="lg:col-span-2 space-y-6">
            {gameState === 'bidding' ? (
              <div className="bg-slate-900 border border-slate-800 p-12 rounded-3xl text-center relative">
                <div className="absolute top-6 right-8 text-3xl font-mono text-blue-500">{timeLeft}s</div>
                <h3 className="text-blue-500 font-bold tracking-widest uppercase mb-2">Current Bid</h3>
                <h2 className="text-6xl font-black mb-6 tracking-tighter">{currentPlayer.name}</h2>

                {tieBanner && (
                  <div className="mb-8 bg-yellow-500/10 border border-yellow-500/40 text-yellow-300 rounded-xl p-4 text-sm">
                    <span className="font-bold">TIE at ${tieBanner.amount}</span> between {tieBanner.names.join(', ')} — re-auctioning this player, tied bidders only.
                  </div>
                )}

                {!iAmEligible ? (
                  <div className="text-slate-400 text-lg py-6">
                    You weren't part of the tie — sit tight while it's redone.
                  </div>
                ) : !hasSubmitted ? (
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
                        value={userBid}
                        onChange={e => {
                          const raw = e.target.value;
                          if (raw === '') { setUserBid(''); return; }
                          const val = parseInt(raw) || 0;
                          setUserBid(Math.max(0, Math.min(val, maxBid)).toString());
                        }}
                        max={maxBid}
                      />
                      <button
                        onClick={() => setHasSubmitted(true)}
                        disabled={!userBid || parseInt(userBid) < 1 || parseInt(userBid) > maxBid}
                        className="bg-blue-600 px-6 rounded-xl font-bold hover:bg-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                      >SUBMIT</button>
                    </div>
                    <p className="text-slate-600 text-xs mt-3">Minimum bid is $1 — every player gets sold.</p>
                  </>
                ) : (
                  <div className="text-emerald-400 font-bold text-xl animate-pulse">BID LOCKED: ${userBid}</div>
                )}
              </div>
            ) : (
              <div className="bg-slate-900 border-2 border-yellow-500/50 p-12 rounded-3xl text-center">
                <Trophy className="mx-auto text-yellow-400 mb-4" size={48} />
                {results.noSale ? (
                  <>
                    <h2 className="text-3xl font-black mb-2">No Sale</h2>
                    <p className="text-slate-400 mb-6">Nobody had budget or roster room to bid on {currentPlayer.name}.</p>
                  </>
                ) : (
                  <>
                    <h2 className="text-4xl font-black mb-2">{results.winner.name}</h2>
                    <p className="text-2xl text-slate-400 mb-2">Won {currentPlayer.name} for <span className="text-white font-black">${results.amount}</span></p>
                    {results.wasCoinFlip && (
                      <p className="text-yellow-400/80 text-xs mb-4">Still tied after several redos — broken with a coin flip.</p>
                    )}
                    {results.autoAwarded && (
                      <p className="text-blue-400/80 text-xs mb-4">Everyone left was capped at $1 — auto-awarded to the nominator, no bidding war needed.</p>
                    )}
                  </>
                )}

                {/* All Bids Display */}
                <div className="max-w-md mx-auto bg-slate-950 rounded-xl p-4 mb-6 max-h-64 overflow-y-auto">
                  <h4 className="text-slate-400 text-sm font-bold mb-3 uppercase tracking-wider">All Bids</h4>
                  <div className="space-y-2">
                    {results.allBids.map((bid, idx) => (
                      <div key={bid.participant.id} className="flex justify-between items-center text-sm">
                        <span className={`${bid.participant.id === myPlayerId ? 'text-blue-400 font-bold' : 'text-slate-300'}`}>
                          {idx + 1}. {bid.participant.name} {bid.participant.id === myPlayerId && '(You)'}
                        </span>
                        <span className={`font-mono ${idx === 0 && bid.bid > 0 ? 'text-yellow-400 font-bold' : 'text-slate-500'}`}>
                          ${bid.bid}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <button onClick={startNextTurn} className="bg-white text-black px-10 py-3 rounded-full font-black uppercase tracking-widest hover:bg-slate-200 transition">
                  Continue
                </button>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-4 max-h-screen overflow-y-auto pr-2">
            <h3 className="font-bold text-slate-500 text-xs uppercase tracking-widest">Live Rosters</h3>
            {participants.map(p => (
              <div key={p.id} className={`p-4 rounded-xl border ${p.id === myPlayerId ? 'bg-blue-900/20 border-blue-500' : 'bg-slate-900 border-slate-800'}`}>
                <div className="flex justify-between items-center mb-2">
                  <span className="font-bold text-sm">{p.name} {p.id === myPlayerId && "(You)"}</span>
                  <span className="text-emerald-400 font-mono text-sm">${p.budget}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {p.roster.map((player, i) => (
                    <div key={i} className="text-[10px] bg-slate-800 px-2 py-1 rounded text-slate-300 border border-slate-700" title={`${player.name} ($${player.cost})`}>
                      {player.name.split(' ').pop()}
                    </div>
                  ))}
                  {p.roster.length === 0 && <div className="text-[10px] text-slate-600 italic">Empty Roster</div>}
                </div>
                <div className="text-[10px] text-slate-600 mt-2">{p.roster.length}/{ROSTER_SIZE} slots filled</div>
              </div>
            ))}
          </div>
        </div>
        </div>
      </div>
    );
  }

  if (gameState === 'complete') return (
    <div className="min-h-screen bg-slate-950 text-white p-8">
      <h1 className="text-5xl font-black text-center mb-12 text-yellow-400 italic">DRAFT SUMMARY</h1>
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[...participants].sort((a,b) => b.roster.reduce((s,p) => s+p.rating, 0) - a.roster.reduce((s,p) => s+p.rating, 0)).map((p, idx) => (
          <div key={p.id} className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
            <div className="flex justify-between items-center mb-4">
              <span className="text-yellow-500 font-black">#{idx+1}</span>
              <span className="text-xs font-bold text-slate-500">{p.roster.length}/{ROSTER_SIZE} filled</span>
            </div>
            <h3 className="font-bold text-lg mb-4">{p.name}</h3>
            <div className="space-y-1">
              {p.roster.map((player, i) => (
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

  return null;
};

// --- Top-level router: practice mode (all local state) vs. online mode
// (Supabase-backed accounts, rooms, and realtime sync). ---
function App() {
  const [mode, setMode] = useState('menu'); // 'menu' | 'online'

  if (mode !== 'online') {
    return <FantasyBasketballDraft onGoOnline={() => setMode('online')} />;
  }

  return <OnlineApp onExit={() => setMode('menu')} />;
}

export default App;
