import React, { useState, useEffect, useRef } from 'react';
import { db } from '../lib/firebase';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../lib/AuthContext';
import { rateLimits, sanitizeText } from '../lib/security';
import { functions } from '../lib/firebase';
import { httpsCallable } from 'firebase/functions';

const sendMessage = httpsCallable(functions, 'sendGlobalChatMessage');

export default function Chatroom() {
  const { user, profile, loginWallet } = useAuth();
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query(collection(db, 'messages'), orderBy('createdAt', 'asc'), limit(50));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setMessages(msgs);
    }, (error) => {
      console.error("Chat fetch error", error);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    if (!user?.uid) {
      loginWallet();
      return;
    }

    const userId = user.uid;
    const displayName = profile?.handle;
    if (!displayName) {
      alert('Your player profile is still loading. Try again shortly.');
      return;
    }

    // Rate limit: max 3 messages per 5 seconds per user
    if (!rateLimits.chat(userId)) {
      alert('You are sending messages too fast. Please slow down.');
      return;
    }

    // Sanitize against XSS before writing to Firestore
    const safeText = sanitizeText(newMessage, 500);
    if (!safeText) return;

    try {
      await sendMessage({ text: safeText });
      setNewMessage("");
    } catch (error) {
      console.error("Error sending message", error);
    }
  };

  return (
    <div className="glass glass-glow flex-1 rounded-2xl overflow-hidden flex flex-col h-[400px]">
        <div className="p-3 border-b border-white/5 bg-white/5 flex justify-between items-center z-10 relative">
            <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Global Chat</span>
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 pulse-green"></div>
        </div>
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar relative"
        >
            {messages.length === 0 ? (
                 <p className="text-[9px] text-zinc-500 text-center mt-10 uppercase tracking-widest">No messages yet.</p>
            ) : (
                messages.map((msg) => (
                    <div key={msg.id} className="text-sm">
                        <span className="font-mono text-zinc-500 text-[10px] mr-2 block mb-[2px]">{msg.userName}</span>
                        <span className="text-zinc-200 text-[12px] break-words">{msg.text}</span>
                    </div>
                ))
            )}
        </div>
        <div className="p-3 border-t border-white/5 bg-black/40 relative z-10">
            <form onSubmit={handleSend} className="flex gap-2">
                <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Send a message..."
                    className="flex-1 bg-white/5 border border-white/10 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500/50"
                  />
                <button type="submit" className="bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded text-[10px] font-black uppercase tracking-widest transition-all">Send</button>
            </form>
        </div>
    </div>
  );
}
