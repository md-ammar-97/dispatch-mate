import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Volume2, Loader2 } from 'lucide-react';
import { Call } from '@/lib/types';
import { cn } from '@/lib/utils';

interface TranscriptPanelProps {
  call: Call | null;
}

export function TranscriptPanel({ call }: TranscriptPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [displayedText, setDisplayedText] = useState('');

  // Determine which transcript to show - refined takes priority when call is completed
  // Based on Subverse observation: Transcript only arrives on 'completed' status
  const transcriptToShow = call?.status === 'completed' && call?.refined_transcript 
    ? call.refined_transcript 
    : call?.live_transcript || '';

  // Typewriter effect for transcript display
  useEffect(() => {
    if (!transcriptToShow) {
      setDisplayedText('');
      return;
    }

    // If call is completed, show full transcript immediately (no typewriter for historical data)
    if (call?.status === 'completed') {
      setDisplayedText(transcriptToShow);
      return;
    }

    // Typewriter effect for live chunks (if any arrive)
    if (displayedText.length < transcriptToShow.length) {
      const timeout = setTimeout(() => {
        setDisplayedText(transcriptToShow.slice(0, displayedText.length + 1));
      }, 20);
      return () => clearTimeout(timeout);
    } else {
      setDisplayedText(transcriptToShow);
    }
  }, [transcriptToShow, displayedText, call?.status]);

  // Reset displayed text when call changes
  useEffect(() => {
    setDisplayedText('');
  }, [call?.id]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [displayedText]);

  return (
    <motion.div
      layout
      className="h-full flex flex-col bg-card rounded-xl border border-border overflow-hidden shadow-sm"
    >
      <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary" />
          <span className="font-medium text-sm">Call Conversation</span>
        </div>
        {call?.status === 'active' && (
          <div className="flex items-center gap-1.5 text-xs text-success">
            <Volume2 className="w-3.5 h-3.5 animate-pulse" />
            <span>Call in Progress</span>
          </div>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto p-4 custom-scrollbar">
        <AnimatePresence mode="wait">
          {call ? (
            <motion.div
              key={call.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {/* Call header */}
              <div className="mb-4 pb-3 border-b border-border">
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Target Driver</div>
                <div className="font-bold text-lg font-mono text-primary leading-none mb-1">{call.reg_no}</div>
                <div className="text-sm text-muted-foreground">{call.driver_name}</div>
              </div>

              {/* Transcript content */}
              {displayedText ? (
                <div className="space-y-3">
                  {call.status === 'completed' && (
                    <div className="text-[10px] font-bold text-success uppercase tracking-widest flex items-center gap-1.5 mb-2">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-success" />
                      AI Verified Transcript
                    </div>
                  )}
                  <div className={cn(
                    "text-sm leading-relaxed text-foreground whitespace-pre-wrap font-medium",
                    call.status === 'active' && "italic text-muted-foreground"
                  )}>
                    {displayedText}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-center space-y-3">
                  {call.status === 'active' || call.status === 'ringing' ? (
                    <>
                      <Loader2 className="w-6 h-6 text-primary animate-spin" />
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">Conversation in progress...</p>
                        <p className="text-xs text-muted-foreground px-4">
                          Transcript will be processed and displayed as soon as the call ends.
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-muted-foreground italic">
                      {call.status === 'queued' && 'Call is in queue...'}
                      {call.status === 'completed' && 'Processing final summary...'}
                      {call.status === 'failed' && (call.error_message || 'Call failed to connect.')}
                      {call.status === 'canceled' && 'Call was canceled by user.'}
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center h-full text-center py-12"
            >
              <div className="p-4 rounded-2xl bg-muted/50 mb-4">
                <MessageSquare className="w-8 h-8 text-muted-foreground/40" />
              </div>
              <p className="text-sm text-muted-foreground">
                Select an active call from the left <br /> to monitor conversation
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
