import { useEffect, useRef, useState } from 'react';
import { Music2, X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

const SOUNDS = [
  {
    id: 'amongus',
    label: 'Among Us',
    icon: '🤨',
    file: '/sounds/amongus.mp3',
  },
  {
    id: 'sadviolin',
    label: 'Sad Violin',
    icon: '🎻',
    file: '/sounds/sadviolin.mp3',
  },
  {
    id: 'fahhh',
    label: 'FAHHH',
    icon: null,
    file: '/sounds/fahhh.mp3',
  },
  {
    id: 'animewow',
    label: 'Anime Wow',
    icon: '😲',
    file: '/sounds/animewow.mp3',

  },

  {
    id: 'omgbruh',
    label: 'OMG Bruh',
    icon: '🤦',
    file: '/sounds/omgbruh.mp3',
  },

  {
    id: 'gahdaym',
    label: 'GAH DAYM',
    icon: '😩',
    file: '/sounds/gahdayum.mp3',
  },

];

export default function SoundBoard({
  roomId,
  myId,
  soundEnabled,
}) {
  const [open, setOpen] = useState(false);
  const [audioReady, setAudioReady] = useState(false);

  const channelRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioBuffersRef = useRef({});
  const lastPlayedRef = useRef(0);

  // Create AudioContext
  const getAudioContext = () => {
    if (!audioContextRef.current) {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

      if (!AudioContextClass) {
        console.error('Web Audio API is not supported.');
        return null;
      }

      audioContextRef.current = new AudioContextClass();
    }

    return audioContextRef.current;
  };

  // Preload all sounds into memory
  const loadSounds = async () => {
    const audioContext = getAudioContext();

    if (!audioContext) return;

    try {
      const entries = await Promise.all(
        SOUNDS.map(async (sound) => {
          const response = await fetch(sound.file);

          if (!response.ok) {
            throw new Error(
              `Failed to load ${sound.file}: ${response.status}`
            );
          }

          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer =
            await audioContext.decodeAudioData(arrayBuffer);

          return [sound.id, audioBuffer];
        })
      );

      audioBuffersRef.current = Object.fromEntries(entries);
      setAudioReady(true);
    } catch (err) {
      console.error('Failed to preload soundboard audio:', err);
    }
  };

  // Unlock/resume audio on user interaction
  const unlockAudio = async () => {
    const audioContext = getAudioContext();

    if (!audioContext) return;

    try {
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      if (!audioReady) {
        await loadSounds();
      }
    } catch (err) {
      console.error('Audio unlock failed:', err);
    }
  };

  // Play a preloaded sound
  const playAudioBuffer = async (soundId) => {
    if (!soundEnabled) return;

    const audioContext = getAudioContext();

    if (!audioContext) return;

    try {
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      if (!audioBuffersRef.current[soundId]) {
        await loadSounds();
      }

      const buffer = audioBuffersRef.current[soundId];

      if (!buffer) {
        console.error(`Missing audio buffer for: ${soundId}`);
        return;
      }

      const source = audioContext.createBufferSource();
      const gainNode = audioContext.createGain();

      source.buffer = buffer;
      gainNode.gain.value = 0.7;

      source.connect(gainNode);
      gainNode.connect(audioContext.destination);

      source.start(0);
    } catch (err) {
      console.error('Sound playback failed:', err);
    }
  };

  // Supabase realtime sound events
  useEffect(() => {
    if (!roomId) return;

    const channel = supabase
      .channel(`soundboard-${roomId}`)
      .on(
        'broadcast',
        { event: 'sound_effect' },
        ({ payload }) => {
          if (!soundEnabled) return;

          // We already play our own sound locally.
          if (payload?.userId === myId) return;

          if (!payload?.sound) return;

          playAudioBuffer(payload.sound);
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [roomId, myId, soundEnabled]);

  // iPhones may suspend AudioContext when Safari is backgrounded.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (
        !document.hidden &&
        audioContextRef.current?.state === 'suspended'
      ) {
        console.log(
          'AudioContext suspended after returning to page.'
        );
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
  }, []);

  const playSound = async (soundId) => {
    const now = Date.now();

    // 2 second cooldown
    if (now - lastPlayedRef.current < 2000) {
      return;
    }

    lastPlayedRef.current = now;

    // Play immediately for the sender
    await playAudioBuffer(soundId);

    // Tell everyone else
    await channelRef.current?.send({
      type: 'broadcast',
      event: 'sound_effect',
      payload: {
        sound: soundId,
        userId: myId,
      },
    });
  };

  const handleOpenSoundBoard = async () => {
    await unlockAudio();
    setOpen((prev) => !prev);
  };

  return (
    <div className="relative">
      {/* Music button */}
      <button
        type="button"
        onClick={handleOpenSoundBoard}
        className="w-11 h-11 flex items-center justify-center rounded-xl bg-slate-900 border border-slate-700 text-white hover:bg-slate-800 hover:border-slate-500 active:scale-95 transition"
        title="Soundboard"
      >
        <Music2 size={20} />
      </button>

      {/* Soundboard popup */}
      {open && (
        <div className="absolute right-0 top-14 z-50 w-72 bg-slate-950 border border-slate-700 rounded-2xl shadow-2xl p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-white font-black text-sm">
                SOUNDBOARD
              </h3>

              <p className="text-slate-500 text-[10px] mt-0.5">
                Everyone in the draft will hear it
              </p>
            </div>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-slate-400 hover:text-white transition"
            >
              <X size={18} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {SOUNDS.map((sound) => (
              <button
                key={sound.id}
                type="button"
                onClick={() => playSound(sound.id)}
                className="min-h-[88px] bg-slate-900 border border-slate-800 hover:bg-slate-800 hover:border-slate-600 active:scale-95 transition rounded-xl px-3 py-3 text-white"
              >
                {sound.id === 'fahhh' ? (
                  <div className="flex h-full items-center justify-center">
                    <span className="text-xl font-black tracking-wider">
                      FAHHH
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2">
                    <span className="text-3xl leading-none">
                      {sound.icon}
                    </span>

                    <span className="text-xs font-bold">
                      {sound.label}
                    </span>
                  </div>
                )}
              </button>
            ))}
          </div>

          {!soundEnabled && (
            <p className="text-center text-amber-400 text-xs font-bold mt-3">
              🔇 Turn sound on to hear sound effects
            </p>
          )}

          {soundEnabled && !audioReady && (
            <p className="text-center text-slate-500 text-[10px] mt-3">
              Loading sounds...
            </p>
          )}
        </div>
      )}
    </div>
  );
}