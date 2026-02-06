 import { useEffect, useRef, useState } from 'react';
 import { motion, AnimatePresence } from 'framer-motion';
 import { MessageSquare, Volume2 } from 'lucide-react';
 import { Call } from '@/lib/types';
 import { cn } from '@/lib/utils';
 
 interface TranscriptPanelProps {
   call: Call | null;
 }
 
 export function TranscriptPanel({ call }: TranscriptPanelProps) {
   const scrollRef = useRef<HTMLDivElement>(null);
   const [displayedText, setDisplayedText] = useState('');
 
  // Determine which transcript to show - refined takes priority when call is completed
  const transcriptToShow = call?.status === 'completed' && call?.refined_transcript 
    ? call.refined_transcript 
    : call?.live_transcript || '';

  // Typewriter effect for live transcript (only during active calls)
  useEffect(() => {
    if (!transcriptToShow) {
      setDisplayedText('');
      return;
    }

    // If call is completed, show full transcript immediately (no typewriter)
    if (call?.status === 'completed') {
      setDisplayedText(transcriptToShow);
      return;
    }

    // Typewriter effect for active calls
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
       className="h-full flex flex-col bg-card rounded-xl border border-border overflow-hidden"
     >
       <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
         <div className="flex items-center gap-2">
           <MessageSquare className="w-4 h-4 text-primary" />
           <span className="font-medium text-sm">Live Transcript</span>
         </div>
         {call?.status === 'active' && (
           <div className="flex items-center gap-1.5 text-xs text-success">
             <Volume2 className="w-3.5 h-3.5 animate-pulse" />
             <span>Listening...</span>
           </div>
         )}
       </div>
 
       <div ref={scrollRef} className="flex-1 overflow-auto p-4">
         <AnimatePresence mode="wait">
           {call ? (
             <motion.div
               key={call.id}
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
             >
               {/* Call header */}
               <div className="mb-4 pb-3 border-b border-border">
                 <div className="text-xs text-muted-foreground mb-1">Calling</div>
                 <div className="font-bold text-lg font-mono text-primary">{call.reg_no}</div>
                 <div className="text-sm text-muted-foreground">{call.driver_name}</div>
               </div>
 
                {/* Transcript content */}
                {displayedText ? (
                  <div className="space-y-2">
                    {call.status === 'completed' && call.refined_transcript && (
                      <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                        <span className="inline-block w-2 h-2 rounded-full bg-success" />
                        Final Transcript
                      </div>
                    )}
                    <div className={cn(
                      "text-sm leading-relaxed text-foreground whitespace-pre-wrap",
                      call.status === 'active' && "typewriter"
                    )}>
                      {displayedText}
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground italic">
                    {call.status === 'queued' && 'Waiting to connect...'}
                    {call.status === 'ringing' && 'Ringing...'}
                    {call.status === 'active' && 'Waiting for speech...'}
                    {call.status === 'completed' && 'Call completed. No transcript available.'}
                    {call.status === 'failed' && (call.error_message || 'Call failed.')}
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
                 <MessageSquare className="w-8 h-8 text-muted-foreground" />
               </div>
               <p className="text-sm text-muted-foreground">
                 Select a call to view transcript
               </p>
             </motion.div>
           )}
         </AnimatePresence>
       </div>
     </motion.div>
   );
 }