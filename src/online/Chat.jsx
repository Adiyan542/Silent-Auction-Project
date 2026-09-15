import { useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Send } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

const MAX_MESSAGE_LENGTH = 300;
const HISTORY_LIMIT = 100;

function lastReadKey(roomId, myId) {
  return `chat_last_read:${roomId}:${myId}`;
}

function getLastRead(roomId, myId) {
  try {
    const raw = localStorage.getItem(lastReadKey(roomId, myId));
    return raw ? new Date(raw) : new Date(0);
  } catch {
    return new Date(0);
  }
}

function setLastReadNow(roomId, myId) {
  try {
    localStorage.setItem(
      lastReadKey(roomId, myId),
      new Date().toISOString()
    );
  } catch {
    // localStorage unavailable (private mode etc) — unread badge just
    // won't survive a remount, which is a harmless degradation.
  }
}

// Merge two message arrays by id, sort by created_at, and cap to the most
// recent HISTORY_LIMIT. Used for both the initial history load and every
// realtime insert, so a message can never get dropped by a later
// "replace" — everything is additive.
function mergeMessages(a, b) {
  const map = new Map();
  for (const m of a) map.set(m.id, m);
  for (const m of b) map.set(m.id, m);
  return Array.from(map.values())
    .sort((x, y) => new Date(x.created_at) - new Date(y.created_at))
    .slice(-HISTORY_LIMIT);
}

export default function Chat({ roomId, myId, displayName }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const openRef = useRef(open);
  const messagesRef = useRef([]);
  const channelRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const applyMerge = (incoming) => {
    const merged = mergeMessages(messagesRef.current, incoming);
    messagesRef.current = merged;
    setMessages(merged);
    return merged;
  };

  // Load history + subscribe to new messages for this room.
  useEffect(() => {
    if (!roomId || !myId) return;

    let cancelled = false;
    messagesRef.current = [];
    setMessages([]);
    setLoaded(false);

    (async () => {
      const { data, error } = await supabase
        .from('room_messages')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: false })
        .limit(HISTORY_LIMIT);

      if (cancelled) return;

      if (error) {
        console.error('Failed to load chat history:', error);
        setLoaded(true);
        return;
      }

      const history = (data ?? []).slice().reverse();

      // Merge rather than replace: a realtime insert may already have
      // landed in messagesRef while this fetch was in flight.
      const merged = applyMerge(history);

      const lastRead = getLastRead(roomId, myId);
      const unread = merged.filter(
        (m) => m.user_id !== myId && new Date(m.created_at) > lastRead
      ).length;
      setUnreadCount(unread);
      setLoaded(true);
    })();

    const channel = supabase
      .channel(`room_messages-${roomId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'room_messages',
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const msg = payload.new;

          applyMerge([msg]);

          if (openRef.current) {
            // Panel is open, so this message is visible right now — keep
            // "last read" current so it can't reappear as unread later
            // (e.g. after a remount when the draft status changes).
            setLastReadNow(roomId, myId);
          } else if (msg.user_id !== myId) {
            setUnreadCount((c) => c + 1);
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      cancelled = true;
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [roomId, myId]);

  // Auto-scroll to newest message whenever the panel is open and messages change.
  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [open, messages]);

  const openChat = () => {
    setOpen(true);
    setUnreadCount(0);
    setLastReadNow(roomId, myId);
  };

  const closeChat = () => {
    setOpen(false);
    // Mark everything currently loaded as read on close too, not just on
    // open, so nothing you already saw comes back as "unread" later.
    setLastReadNow(roomId, myId);
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || trimmed.length > MAX_MESSAGE_LENGTH || sending) return;

    setSending(true);

    const { error } = await supabase.from('room_messages').insert({
      room_id: roomId,
      user_id: myId,
      display_name: displayName || 'Player',
      message: trimmed,
    });

    if (error) {
      console.error('Failed to send message:', error);
    } else {
      setDraft('');
    }

    setSending(false);
  };

  return (
    <div className="relative">
      {/* Chat button */}
      <button
        type="button"
        onClick={() => (open ? closeChat() : openChat())}
        className="relative w-11 h-11 flex items-center justify-center rounded-xl bg-slate-900 border border-slate-700 text-white hover:bg-slate-800 hover:border-slate-500 active:scale-95 transition"
        title="Chat"
      >
        <MessageCircle size={20} />
        {!open && unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="absolute right-0 top-14 z-50 w-80 h-[420px] bg-slate-950 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
            <h3 className="text-white font-black text-sm">ROOM CHAT</h3>
            <button
              type="button"
              onClick={closeChat}
              className="text-slate-400 hover:text-white transition"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {!loaded && (
              <p className="text-slate-500 text-xs text-center mt-4">
                Loading chat...
              </p>
            )}

            {loaded && messages.length === 0 && (
              <p className="text-slate-500 text-xs text-center mt-4">
                No messages yet. Say something.
              </p>
            )}

            {messages.map((m) => {
              const mine = m.user_id === myId;
              return (
                <div
                  key={m.id}
                  className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}
                >
                  {!mine && (
                    <span className="text-[10px] text-slate-500 px-1 mb-0.5">
                      {m.display_name}
                    </span>
                  )}
                  <div
                    className={`max-w-[85%] px-3 py-1.5 rounded-xl text-sm break-words ${
                      mine
                        ? 'bg-blue-600 text-white rounded-br-sm'
                        : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-bl-sm'
                    }`}
                  >
                    {m.message}
                  </div>
                </div>
              );
            })}

            <div ref={bottomRef} />
          </div>

          <form
            onSubmit={sendMessage}
            className="border-t border-slate-800 p-2 flex items-center gap-2"
          >
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
              maxLength={MAX_MESSAGE_LENGTH}
              placeholder="Talk trash..."
              className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={!draft.trim() || sending}
              className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600 text-white transition"
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}