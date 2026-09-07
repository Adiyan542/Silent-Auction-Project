// Deploy with: supabase functions deploy resolve-auction
//
// Any client can call this once its local countdown hits 0 — it's safe to
// call more than once or from more than one browser at the same time. The
// function only actually resolves the round if the room is still 'bidding'
// AND the deadline has really passed (checked server-side, not trusted from
// the client), and it does the state transition in one atomic update so two
// simultaneous callers can't both "win" the resolution.
//
// This mirrors the exact same rules as the local practice-mode logic:
//   - every eligible bidder's max bid is capped by their remaining budget
//     (must leave at least $1 for every other empty roster slot)
//   - minimum winning bid is $1 (nobody drafted for free)
//   - a tie redoes the auction for the same player, tied bidders only,
//     up to 3 times, then a coin flip breaks it
//   - once resolved (winner, coin flip, or no-sale), the room moves to a
//     'results' status showing the winner and every bid — it does NOT
//     auto-advance. The host clicking Continue (handled client-side, not
//     in this function) is what clears current_player and moves the turn
//     to the next nominator.

import { createClient } from 'npm:@supabase/supabase-js@2';

const ROSTER_SIZE_DEFAULT = 13;
const MAX_TIE_REDOS = 3;


function rollPandoraOutcome(): number {
  const outcomes = [
    { amount: 25, weight: 8 },
    { amount: 15, weight: 10 },
    { amount: 10, weight: 12 },

    { amount: -5, weight: 20 },
    { amount: -10, weight: 20 },
    { amount: -15, weight: 15 },
    { amount: -20, weight: 10 },
    { amount: -25, weight: 5 },
  ];

  const totalWeight = outcomes.reduce(
    (sum, outcome) => sum + outcome.weight,
    0
  );

  let roll = Math.random() * totalWeight;

  for (const outcome of outcomes) {
    if (roll < outcome.weight) {
      return outcome.amount;
    }

    roll -= outcome.weight;
  }

  return outcomes[outcomes.length - 1].amount;
}


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    });
  }

  try {
    const { room_id } = await req.json();
    if (!room_id) {
      return json({ error: 'room_id is required' }, 400);
    }

    // Service-role client: bypasses RLS so this function is the one place
    // allowed to reveal bids and mutate budgets/rosters authoritatively.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: room, error: roomErr } = await supabase
      .from('rooms')
      .select('*')
      .eq('id', room_id)
      .single();
    if (roomErr || !room) return json({ error: 'room not found' }, 404);

    if (room.status !== 'bidding') {
      return json({ ok: true, skipped: 'not bidding' });
    }

    if (room.is_paused) {
      return json({ ok: true, skipped: 'auction paused' });
    }

    const rosterSize = room.settings?.roster_size ?? ROSTER_SIZE_DEFAULT;
    const currentPlayer = room.current_player;
    if (!currentPlayer) return json({ error: 'no current_player on room' }, 400);

    const { data: participants, error: partErr } = await supabase
      .from('room_participants')
      .select('*')
      .eq('room_id', room_id);
    if (partErr) return json({ error: partErr.message }, 500);

    const roundKey = `${currentPlayer.auction_id}_${room.tie_redo_count}`;
    const { data: bidRows, error: bidErr } = await supabase
      .from('bids')
      .select('*')
      .eq('room_id', room_id)
      .eq('round_key', roundKey);
    if (bidErr) return json({ error: bidErr.message }, 500);

    const bidByUser = new Map(bidRows.map((b) => [b.user_id, b.amount]));

    const isPandora = currentPlayer.isPandora === true;

    const getMaxBid = (p: any) => {
      const slotsLeft = rosterSize - (p.roster?.length ?? 0);

      if (slotsLeft <= 0) return 0;

      if (isPandora) {
        return Math.max(0, p.budget - slotsLeft);
      }

      return Math.max(0, p.budget - (slotsLeft - 1));
    };

    const eligibleIds: string[] | null = room.tie_eligible_ids ?? null;

    const eligibleParticipants = participants.filter((p) => {
      const slotsLeft = rosterSize - (p.roster?.length ?? 0);
      const maxPossible = getMaxBid(p);
    
      return (
        slotsLeft > 0 &&
        maxPossible >= 1 &&
        (!eligibleIds || eligibleIds.includes(p.user_id))
      );
    });
    
    // Pandora still waits for every active manager to press PASS,
    // even if their max bid is $0.
    const expectedResponders = isPandora
      ? participants.filter((p) => {
          const slotsLeft = rosterSize - (p.roster?.length ?? 0);
    
          return (
            slotsLeft > 0 &&
            (!eligibleIds || eligibleIds.includes(p.user_id))
          );
        })
      : eligibleParticipants;
    
    const allResponded =
      expectedResponders.every((p) => bidByUser.has(p.user_id));
    
    const deadlineExpired =
      !!room.auction_deadline &&
      new Date(room.auction_deadline) <= new Date();
    
    // Keep waiting if the timer is still running and
    // at least one eligible player has not responded.
    if (!deadlineExpired && !allResponded) {
      return json({
        ok: true,
        skipped: 'waiting for remaining bidders',
      });
    }
    
    // The timer expired OR everybody responded.
    // Claim the auction so only one request can resolve it.
    const deadlineToClaim = room.auction_deadline;
    
    const { data: claimed, error: claimErr } = await supabase
      .from('rooms')
      .update({ auction_deadline: null })
      .eq('id', room_id)
      .eq('status', 'bidding')
      .eq('is_paused', false)
      .eq('auction_deadline', deadlineToClaim)
      .select('id');
    
    if (claimErr) {
      return json({ error: claimErr.message }, 500);
    }
    
    if (!claimed || claimed.length === 0) {
      return json({
        ok: true,
        skipped: 'already resolving',
      });
    }

    const resolved = participants.map((p) => {
      const slotsLeft = rosterSize - (p.roster?.length ?? 0);
      const maxPossible = getMaxBid(p);
      const eligible =
        slotsLeft > 0 &&
        maxPossible >= 1 &&
        (!eligibleIds || eligibleIds.includes(p.user_id));
      if (!eligible) return { participant: p, bid: 0, eligible: false };

      const raw = bidByUser.get(p.user_id) ?? 0;
      const bid = Math.max(0, Math.min(raw, maxPossible));
      return { participant: p, bid, eligible: true };
    });

    const eligibleBids = resolved.filter((b) => b.eligible && b.bid >= 1);
    eligibleBids.sort((a, b) => b.bid - a.bid);
    const topBid = eligibleBids[0];

    // Nobody bid at all (shouldn't normally happen) — no sale. Park on the
    // results screen; the host's Continue click is what advances the turn.
    if (!topBid) {
      const { error } = await supabase
        .from('rooms')
        .update({
          auction_deadline: null,
          tie_eligible_ids: null,
          tie_redo_count: 0,
    
          // If Pandora gets no bids, keep it available for later.
          ...(isPandora
            ? {
                pandora_available: true,
                pandora_used: false,
              }
            : {}),
    
          status: 'results',
    
          results: isPandora
            ? {
                isPandora: true,
                noSale: true,
                playerName: "Pandora's Box",
              }
            : {
                noSale: true,
                playerName: currentPlayer.name,
              },
        })
        .eq('id', room_id)
        .eq('status', 'bidding');
    
      if (error) {
        return json({ error: error.message }, 500);
      }
    
      return json({
        ok: true,
        noSale: true,
        pandora: isPandora,
      });
    }

    const tiedTop = eligibleBids.filter((b) => b.bid === topBid.bid);

    if (tiedTop.length > 1 && room.tie_redo_count < MAX_TIE_REDOS) {
      // Redo this exact player, tied bidders only. Stays in 'bidding' —
      // a tie isn't a finished round, so there's nothing to show on a
      // results screen yet.
      const { error } = await supabase
        .from('rooms')
        .update({
          tie_eligible_ids: tiedTop.map((b) => b.participant.user_id),
          tie_redo_count: room.tie_redo_count + 1,
          auction_deadline: new Date(
            Date.now() + (room.settings?.auction_time ?? 30) * 1000
          ).toISOString(),
        })
        .eq('id', room_id)
        .eq('status', 'bidding');
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, tie: true });
    }

    // Unique winner, or tie survived 3 redos -> coin flip among the tied.
    const winnerEntry =
      tiedTop.length > 1
        ? tiedTop[Math.floor(Math.random() * tiedTop.length)]
        : topBid;
    const winner = winnerEntry.participant;
    const amount = winnerEntry.bid;

    const allBids = resolved
      .filter((r) => r.eligible)
      .map((r) => ({
        name: r.participant.display_name,
        userId: r.participant.user_id,
        bid: r.bid,
      }))
      .sort((a, b) => b.bid - a.bid);

    if (isPandora) {
      const slotsLeft = rosterSize - (winner.roster?.length ?? 0);
      const gambleAmount = rollPandoraOutcome();
      const budgetAfterBid = winner.budget - amount;
      const safeFloor = slotsLeft;

      const newBudget = Math.max(
        safeFloor,
        budgetAfterBid + gambleAmount
      );

      const appliedAmount = newBudget - budgetAfterBid;
      const wasClamped = appliedAmount !== gambleAmount;

      const { error: updatePandoraWinnerErr } = await supabase
        .from('room_participants')
        .update({
          budget: newBudget,
        })
        .eq('room_id', room_id)
        .eq('user_id', winner.user_id);

      if (updatePandoraWinnerErr) {
        return json({ error: updatePandoraWinnerErr.message }, 500);
      }

      const pandoraLogEntry = {
        id: `pandora_${Date.now()}`,
        playerName: "Pandora's Box",
        amount,
        winnerName: winner.display_name,
        winnerUserId: winner.user_id,
        isPandora: true,
        gambleAmount,
        appliedAmount,
        wasClamped,
      };

      const { error: updatePandoraRoomErr } = await supabase
        .from('rooms')
        .update({
          auction_deadline: null,
          tie_eligible_ids: null,
          tie_redo_count: 0,
          pandora_used: true,
          pandora_available: false,
          draft_log: [
            pandoraLogEntry,
            ...(room.draft_log ?? []),
          ],
          status: 'results',
          results: {
            isPandora: true,
            playerName: "Pandora's Box",
            winnerName: winner.display_name,
            winnerUserId: winner.user_id,
            amount,
            gambleAmount,
            appliedAmount,
            wasClamped,
            finalBudget: newBudget,
            allBids,
          },
        })
        .eq('id', room_id)
        .eq('status', 'bidding');

      if (updatePandoraRoomErr) {
        return json({ error: updatePandoraRoomErr.message }, 500);
      }

      return json({
        ok: true,
        pandora: true,
        winner: winner.user_id,
        amount,
        gambleAmount,
        appliedAmount,
        finalBudget: newBudget,
      });
    }

    const newRoster = [
      ...(winner.roster ?? []),
      { id: currentPlayer.id, name: currentPlayer.name, rating: currentPlayer.rating, positions: currentPlayer.positions ?? [], cost: amount },
    ];

    // Budget/roster update immediately — no reason to make everyone wait
    // for the host's Continue click just to see the winner's roster update.
    const { error: updatePartErr } = await supabase
      .from('room_participants')
      .update({ budget: winner.budget - amount, roster: newRoster })
      .eq('room_id', room_id)
      .eq('user_id', winner.user_id);
    if (updatePartErr) return json({ error: updatePartErr.message }, 500);

    const logEntry = {
      id: `${currentPlayer.id}_${Date.now()}`,
      playerName: currentPlayer.name,
      amount,
      winnerName: winner.display_name,
      winnerUserId: winner.user_id,
      wasCoinFlip: tiedTop.length > 1,
    };


    // Parked on 'results' — current_player and current_nominator_index are
    // left as-is on purpose; the host's Continue click (a plain client-side
    // update, not this function) is what clears current_player and advances
    // the turn.
    const { error: updateRoomErr } = await supabase
      .from('rooms')
      .update({
        drafted_player_ids: [...room.drafted_player_ids, currentPlayer.id],
        draft_log: [logEntry, ...(room.draft_log ?? [])],
        auction_deadline: null,
        tie_eligible_ids: null,
        tie_redo_count: 0,
        status: 'results',
        results: {
          playerName: currentPlayer.name,
          winnerName: winner.display_name,
          winnerUserId: winner.user_id,
          amount,
          allBids,
          wasCoinFlip: tiedTop.length > 1,
        },
      })
      .eq('id', room_id)
      .eq('status', 'bidding');
    if (updateRoomErr) return json({ error: updateRoomErr.message }, 500);

    return json({ ok: true, winner: winner.user_id, amount });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}
