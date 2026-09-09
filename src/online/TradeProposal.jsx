import React, { useState } from 'react';
import { Handshake, X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

export function TradeProposalCard({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full bg-gradient-to-br from-blue-900 to-slate-800 p-5 rounded-xl border-2 border-blue-500 flex justify-between items-center hover:border-blue-300 active:border-blue-200 transition text-left md:col-span-2"
    >
      <div>
        <h4 className="text-white font-black text-xl">
          Trade Proposal
        </h4>

        <p className="text-blue-300 text-sm mt-1">
          Propose a live trade to another manager
        </p>
      </div>

      <Handshake className="text-blue-300 shrink-0" />
    </button>
  );
}

export function TradeProposalComposer({
  roomId,
  myId,
  participants,
  onClose,
  onSent,
}) {
  const [targetUserId, setTargetUserId] = useState('');
  const [givePlayerIds, setGivePlayerIds] = useState([]);
  const [receivePlayerIds, setReceivePlayerIds] = useState([]);
  const [giveCash, setGiveCash] = useState('');
  const [receiveCash, setReceiveCash] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const me = participants.find((p) => p.user_id === myId);
  const others = participants.filter((p) => p.user_id !== myId);
  const target = participants.find((p) => p.user_id === targetUserId);

  const togglePlayer = (list, setList, playerId, max) => {
    if (list.includes(playerId)) {
      setList(list.filter((id) => id !== playerId));
    } else if (list.length < max) {
      setList([...list, playerId]);
    }
  };

  const send = async () => {
    setError('');

    if (!targetUserId) {
      setError('Pick who to trade with.');
      return;
    }

    if (
      givePlayerIds.length === 0 ||
      receivePlayerIds.length === 0
    ) {
      setError('Both sides need at least one player.');
      return;
    }

    setBusy(true);

    const { data, error: rpcErr } = await supabase.rpc(
      'create_trade_proposal',
      {
        p_room_id: roomId,
        p_to_user_id: targetUserId,
        p_give_players: (me?.roster ?? []).filter((p) =>
          givePlayerIds.includes(p.id)
        ),
        p_give_cash: parseInt(giveCash) || 0,
        p_receive_players: (target?.roster ?? []).filter((p) =>
          receivePlayerIds.includes(p.id)
        ),
        p_receive_cash: parseInt(receiveCash) || 0,
      }
    );

    setBusy(false);

    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }

    if (!data?.ok) {
      setError(data?.error || 'Could not send that offer.');
      return;
    }

    onSent?.();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-black text-white">
            Propose Trade
          </h2>

          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        <div className="mb-4">
          <label className="text-slate-400 text-xs font-bold uppercase tracking-wider">
            Trade with
          </label>

          <select
            value={targetUserId}
            onChange={(e) => {
              setTargetUserId(e.target.value);
              setReceivePlayerIds([]);
              setReceiveCash('');
            }}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 mt-1 text-white"
          >
            <option value="">
              Select a manager…
            </option>

            {others.map((p) => (
              <option
                key={p.user_id}
                value={p.user_id}
              >
                {p.display_name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-slate-400 text-xs font-bold uppercase tracking-wider">
              You give ({givePlayerIds.length}/2)
            </label>

            <div className="mt-1 space-y-1 max-h-32 overflow-y-auto">
              {(me?.roster ?? []).map((p) => (
                <label
                  key={p.id}
                  className="flex items-center gap-2 text-sm text-slate-300"
                >
                  <input
                    type="checkbox"
                    checked={givePlayerIds.includes(p.id)}
                    onChange={() =>
                      togglePlayer(
                        givePlayerIds,
                        setGivePlayerIds,
                        p.id,
                        2
                      )
                    }
                  />

                  {p.name}
                </label>
              ))}
            </div>

            <input
              type="number"
              min={0}
              placeholder="+ cash"
              value={giveCash}
              onChange={(e) => setGiveCash(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 mt-2 text-white text-sm"
            />
          </div>

          <div>
            <label className="text-slate-400 text-xs font-bold uppercase tracking-wider">
              You receive ({receivePlayerIds.length}/2)
            </label>

            <div className="mt-1 space-y-1 max-h-32 overflow-y-auto">
              {!target && (
                <p className="text-slate-600 text-xs italic">
                  Pick a manager first
                </p>
              )}

              {(target?.roster ?? []).map((p) => (
                <label
                  key={p.id}
                  className="flex items-center gap-2 text-sm text-slate-300"
                >
                  <input
                    type="checkbox"
                    checked={receivePlayerIds.includes(p.id)}
                    onChange={() =>
                      togglePlayer(
                        receivePlayerIds,
                        setReceivePlayerIds,
                        p.id,
                        2
                      )
                    }
                  />

                  {p.name}
                </label>
              ))}
            </div>

            <input
              type="number"
              min={0}
              placeholder="+ cash"
              value={receiveCash}
              onChange={(e) => setReceiveCash(e.target.value)}
              disabled={!target}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 mt-2 text-white text-sm disabled:opacity-50"
            />
          </div>
        </div>

        {error && (
          <p className="text-red-400 text-sm mb-4">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm font-bold py-2 rounded-lg transition"
          >
            CANCEL
          </button>

          <button
            type="button"
            onClick={send}
            disabled={busy}
            className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold py-2 rounded-lg transition"
          >
            {busy ? 'SENDING...' : 'SEND TRADE PROPOSAL'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function TradeProposalLive({
  trade,
  myId,
  participants,
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!trade) return null;

  const nameFor = (userId) =>
    participants.find((p) => p.user_id === userId)?.display_name ??
    'Unknown';

  const isRecipient = trade.to_user_id === myId;
  const isSender = trade.from_user_id === myId;

  const accept = async () => {
    setError('');
    setBusy(true);

    const { data, error: rpcErr } = await supabase.rpc(
      'accept_trade_proposal',
      {
        p_trade_id: trade.id,
      }
    );

    setBusy(false);

    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }

    if (!data?.ok) {
      setError(data?.error || 'Trade could not be completed.');
    }
  };

  const decline = async () => {
    setError('');
    setBusy(true);

    const { data, error: rpcErr } = await supabase.rpc(
      'decline_trade_proposal',
      {
        p_trade_id: trade.id,
      }
    );

    setBusy(false);

    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }

    if (!data?.ok) {
      setError(data?.error || 'Could not decline trade.');
    }
  };

  const cancel = async () => {
    setError('');
    setBusy(true);

    const { data, error: rpcErr } = await supabase.rpc(
      'cancel_trade_proposal',
      {
        p_trade_id: trade.id,
      }
    );

    setBusy(false);

    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }

    if (!data?.ok) {
      setError(data?.error || 'Could not cancel trade.');
    }
  };

  return (
    <div className="bg-slate-900 border-2 border-blue-500/50 p-10 rounded-3xl text-center">
      <p className="text-blue-400 font-bold uppercase tracking-widest text-sm mb-4 flex items-center justify-center gap-2">
        <Handshake size={18} />
        Live Trade Proposal
      </p>

      <div className="grid grid-cols-2 gap-6 max-w-md mx-auto mb-6">
        <div>
          <p className="text-white font-bold mb-2">
            {nameFor(trade.from_user_id)}
          </p>

          {(trade.give_players ?? []).map((p) => (
            <p
              key={p.id}
              className="text-slate-300 text-sm"
            >
              {p.name}
            </p>
          ))}

          {trade.give_cash > 0 && (
            <p className="text-emerald-400 text-sm font-mono">
              +${trade.give_cash}
            </p>
          )}
        </div>

        <div>
          <p className="text-white font-bold mb-2">
            {nameFor(trade.to_user_id)}
          </p>

          {(trade.receive_players ?? []).map((p) => (
            <p
              key={p.id}
              className="text-slate-300 text-sm"
            >
              {p.name}
            </p>
          ))}

          {trade.receive_cash > 0 && (
            <p className="text-emerald-400 text-sm font-mono">
              +${trade.receive_cash}
            </p>
          )}
        </div>
      </div>

      {error && (
        <p className="text-red-400 text-sm mb-4">
          {error}
        </p>
      )}

      {isRecipient && (
        <div className="flex gap-3 max-w-xs mx-auto">
          <button
            type="button"
            onClick={decline}
            disabled={busy}
            className="flex-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm font-bold py-3 rounded-xl transition"
          >
            DECLINE
          </button>

          <button
            type="button"
            onClick={accept}
            disabled={busy}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold py-3 rounded-xl transition"
          >
            ACCEPT
          </button>
        </div>
      )}

      {isSender && (
        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm font-bold px-6 py-3 rounded-xl transition"
        >
          CANCEL TRADE
        </button>
      )}

      {!isRecipient && !isSender && (
        <p className="text-slate-500 text-sm">
          Waiting for {nameFor(trade.to_user_id)}…
        </p>
      )}
    </div>
  );
}