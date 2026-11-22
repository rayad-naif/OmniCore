import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, X, Send, Mic, MicOff, Minimize2, Maximize2, Zap, Sparkles } from 'lucide-react';
import { aiAPI } from '@/services/api';
import { useSelector } from 'react-redux';
import { selectUser } from '@/store/slices/authSlice';
import clsx from 'clsx';

const SUGGESTIONS = [
  'How do I apply for annual leave?',
  "What's my attendance percentage this month?",
  'When is the next payroll date?',
  'How to submit a performance self-review?',
  'What are the WFH policy rules?',
];

export default function AIAssistant() {
  const user = useSelector(selectUser);
  const [isOpen,      setIsOpen]      = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages,    setMessages]    = useState([{
    role: 'assistant',
    content: `Hi ${user?.firstName || 'there'}! 👋 I'm **ARIA**, your AI HR Assistant powered by Google Gemini.\n\nHow can I help you today?`,
    time: new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }),
  }]);
  const [input,       setInput]       = useState('');
  const [isLoading,   setIsLoading]   = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [aiEnabled,   setAiEnabled]   = useState(null);
  const endRef        = useRef(null);
  const inputRef      = useRef(null);
  const recognitionRef= useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior:'smooth' }); }, [messages]);
  useEffect(() => { if (isOpen && !isMinimized) setTimeout(()=>inputRef.current?.focus(),200); }, [isOpen,isMinimized]);
  useEffect(() => {
    aiAPI.getStatus()
      .then(({ data }) => setAiEnabled(Boolean(data?.data?.aiEnabled)))
      .catch(() => setAiEnabled(false));
  }, []);

  const toggleVoice = () => {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      alert('Voice not supported in this browser.'); return;
    }
    if (isListening) { recognitionRef.current?.stop(); setIsListening(false); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r  = new SR();
    r.lang = 'en-US'; r.continuous = false; r.interimResults = false;
    r.onresult = (e) => { setInput(e.results[0][0].transcript); setIsListening(false); };
    r.onerror = r.onend = () => setIsListening(false);
    recognitionRef.current = r; r.start(); setIsListening(true);
  };

  const sendMessage = async (text) => {
    const content = (text || input).trim();
    if (!content || isLoading) return;
    setInput('');

    const userMsg = { role:'user', content, time: new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) };
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setIsLoading(true);

    try {
      const apiMessages = newHistory.map(({ role, content }) => ({ role, content }));
      const response = await aiAPI.chat(apiMessages);
      const reply = response.data?.data?.message || "I didn't get a response. Please try again.";

      setMessages(prev => [...prev, {
        role: 'assistant', content: reply,
        time: new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),
      }]);
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant', content: "I'm having trouble connecting right now. Please try again.",
        time: new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),
        isError: true,
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // Simple markdown-like formatting for bold, bullets, numbered lists, and headings
  const formatMessage = (text) => {
    if (!text) return '';
    
    const lines = text.split('\n');
    let inList = false;
    let inNumList = false;
    const htmlLines = [];

    const formatInlineMarkdown = (inlineText) => {
      return inlineText
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>');
    };

    lines.forEach((line) => {
      const trimmedLine = line.trim();

      // Check if line is a bullet point (starts with * or - followed by space)
      const isBullet = /^[\*\-]\s+(.*)/.test(trimmedLine);
      // Check if line is a numbered list item (starts with a number followed by dot and space)
      const isNumbered = /^\d+\.\s+(.*)/.test(trimmedLine);

      if (isBullet) {
        if (inNumList) {
          htmlLines.push('</ol>');
          inNumList = false;
        }
        if (!inList) {
          htmlLines.push('<ul class="list-disc pl-4 space-y-1 my-1.5">');
          inList = true;
        }
        const content = trimmedLine.replace(/^[\*\-]\s+/, '');
        htmlLines.push(`<li class="text-slate-300">${formatInlineMarkdown(content)}</li>`);
      } else if (isNumbered) {
        if (inList) {
          htmlLines.push('</ul>');
          inList = false;
        }
        if (!inNumList) {
          htmlLines.push('<ol class="list-decimal pl-4 space-y-1 my-1.5">');
          inNumList = true;
        }
        const content = trimmedLine.replace(/^\d+\.\s+/, '');
        htmlLines.push(`<li class="text-slate-300">${formatInlineMarkdown(content)}</li>`);
      } else {
        if (inList) {
          htmlLines.push('</ul>');
          inList = false;
        }
        if (inNumList) {
          htmlLines.push('</ol>');
          inNumList = false;
        }

        // Check for headings (###, ##, #)
        if (/^###\s+(.*)/.test(trimmedLine)) {
          const content = trimmedLine.replace(/^###\s+/, '');
          htmlLines.push(`<h4 class="text-xs font-bold text-white mt-3 mb-1">${formatInlineMarkdown(content)}</h4>`);
        } else if (/^##\s+(.*)/.test(trimmedLine)) {
          const content = trimmedLine.replace(/^##\s+/, '');
          htmlLines.push(`<h3 class="text-sm font-bold text-white mt-4 mb-1.5">${formatInlineMarkdown(content)}</h3>`);
        } else if (/^#\s+(.*)/.test(trimmedLine)) {
          const content = trimmedLine.replace(/^#\s+/, '');
          htmlLines.push(`<h2 class="text-base font-bold text-white mt-4 mb-2">${formatInlineMarkdown(content)}</h2>`);
        } else if (trimmedLine === '') {
          htmlLines.push('<div class="h-2"></div>');
        } else {
          htmlLines.push(`<p class="mb-1.5">${formatInlineMarkdown(line)}</p>`);
        }
      }
    });

    if (inList) htmlLines.push('</ul>');
    if (inNumList) htmlLines.push('</ol>');

    return htmlLines.join('');
  };


  return (
    <>
      {/* FAB */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale:0, opacity:0 }} animate={{ scale:1, opacity:1 }} exit={{ scale:0, opacity:0 }}
            onClick={() => setIsOpen(true)}
            className="fixed bottom-6 right-6 z-40 w-14 h-14 bg-primary-600 hover:bg-primary-500
                       rounded-2xl shadow-glow-primary flex-center transition-all duration-200 hover:scale-105"
          >
            <Bot className="w-6 h-6 text-white" />
            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-accent-400 rounded-full border-2 border-surface-950"/>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Chat window */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity:0, scale:0.9, y:20 }} animate={{ opacity:1, scale:1, y:0 }}
            exit={{ opacity:0, scale:0.9, y:20 }}
            transition={{ type:'spring', stiffness:300, damping:25 }}
            className={clsx(
              'fixed bottom-6 right-6 z-40 w-[370px] bg-surface-900 border border-white/10 rounded-2xl shadow-xl overflow-hidden flex flex-col',
              isMinimized ? 'h-14' : 'h-[520px]'
            )}
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-primary-600/30 to-accent-500/20 border-b border-white/5 flex-shrink-0">
              <div className="w-8 h-8 rounded-xl bg-primary-600 flex-center shadow-glow-primary">
                <Zap className="w-4 h-4 text-white"/>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-white">ARIA</p>
                  <span className="flex items-center gap-1 text-[9px] text-accent-400 bg-accent-500/10 px-1.5 py-0.5 rounded-full border border-accent-500/20">
                    <Sparkles className="w-2.5 h-2.5"/>Gemini AI
                  </span>
                </div>
                <p className="text-[10px] text-slate-400">AI HR Assistant · {aiEnabled === false ? 'Offline' : 'Online'}</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={()=>setIsMinimized(!isMinimized)}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-all">
                  {isMinimized ? <Maximize2 className="w-3.5 h-3.5"/> : <Minimize2 className="w-3.5 h-3.5"/>}
                </button>
                <button onClick={()=>setIsOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-danger-400 hover:bg-danger-500/10 rounded-lg transition-all">
                  <X className="w-3.5 h-3.5"/>
                </button>
              </div>
            </div>

            {!isMinimized && (
              <>
                {/* The model key is stored only on the backend. */}
                {aiEnabled === false && (
                  <div className="px-4 py-2 bg-warning-500/10 border-b border-warning-500/20 text-[10px] text-warning-300 flex items-center gap-1.5">
                    <span>⚠️</span>AI assistant is not configured. Please contact your administrator.
                  </div>
                )}

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {messages.map((msg, i) => (
                    <div key={i} className={clsx('flex gap-2.5', msg.role==='user' && 'flex-row-reverse')}>
                      {msg.role==='assistant' && (
                        <div className="w-6 h-6 rounded-full bg-primary-600 flex-center flex-shrink-0 mt-0.5">
                          <Bot className="w-3.5 h-3.5 text-white"/>
                        </div>
                      )}
                      <div className={clsx(
                        'max-w-[82%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed',
                        msg.role==='user'
                          ? 'bg-primary-600 text-white rounded-tr-sm'
                          : msg.isError
                            ? 'bg-danger-500/10 border border-danger-500/20 text-danger-300 rounded-tl-sm'
                            : 'bg-surface-800 text-slate-200 rounded-tl-sm'
                      )}>
                        <p dangerouslySetInnerHTML={{ __html: formatMessage(msg.content) }} />
                        <p className={clsx('text-[9px] mt-1.5', msg.role==='user'?'text-primary-200':'text-slate-600')}>
                          {msg.time}
                        </p>
                      </div>
                    </div>
                  ))}

                  {/* Typing indicator */}
                  {isLoading && (
                    <div className="flex gap-2.5">
                      <div className="w-6 h-6 rounded-full bg-primary-600 flex-center flex-shrink-0">
                        <Bot className="w-3.5 h-3.5 text-white"/>
                      </div>
                      <div className="bg-surface-800 rounded-2xl rounded-tl-sm px-4 py-3">
                        <div className="flex gap-1.5 items-center">
                          {[0,1,2].map(i => (
                            <span key={i} className="w-1.5 h-1.5 bg-primary-400 rounded-full animate-bounce"
                              style={{animationDelay:`${i*0.15}s`}}/>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Suggestion chips — only show at start */}
                  {messages.length === 1 && (
                    <div className="space-y-1.5 mt-1">
                      <p className="text-[10px] text-slate-600 px-1">Suggested questions:</p>
                      {SUGGESTIONS.map(s => (
                        <button key={s} onClick={()=>sendMessage(s)}
                          className="w-full text-left text-[11px] text-slate-400 hover:text-primary-300
                                     bg-white/5 hover:bg-primary-500/10 border border-white/5
                                     hover:border-primary-500/20 rounded-xl px-3 py-2 transition-all">
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                  <div ref={endRef}/>
                </div>

                {/* Input bar */}
                <div className="p-3 border-t border-white/5 flex-shrink-0">
                  <div className="flex gap-2">
                    <input ref={inputRef} value={input}
                      onChange={e=>setInput(e.target.value)}
                      onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&sendMessage()}
                      placeholder="Ask ARIA anything about HR..."
                      className="flex-1 bg-surface-800 border border-white/10 text-slate-200 placeholder-slate-600
                                 text-xs rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-primary-500/50"/>
                    <button onClick={toggleVoice}
                      className={clsx('w-9 h-9 rounded-xl flex-center transition-all flex-shrink-0',
                        isListening ? 'bg-danger-500 text-white animate-pulse' : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white')}>
                      {isListening ? <MicOff className="w-4 h-4"/> : <Mic className="w-4 h-4"/>}
                    </button>
                    <button onClick={()=>sendMessage()}
                      disabled={!input.trim()||isLoading}
                      className="w-9 h-9 rounded-xl bg-primary-600 hover:bg-primary-500 text-white flex-center transition-all flex-shrink-0 disabled:opacity-40">
                      <Send className="w-4 h-4"/>
                    </button>
                  </div>
                  <p className="text-[9px] text-slate-700 text-center mt-1.5">Powered by Google Gemini 1.5 Flash</p>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
