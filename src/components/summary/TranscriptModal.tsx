import { useState, useRef, useEffect } from 'react';
import { Download, FileText, Play, Pause, Volume2, RefreshCw, Loader2, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Call } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

interface TranscriptModalProps {
  call: Call | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFetchTranscript?: (callId: string) => Promise<{ transcript?: string; recording_url?: string } | null>;
}

export function TranscriptModal({ call, open, onOpenChange, onFetchTranscript }: TranscriptModalProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [localTranscript, setLocalTranscript] = useState<string | null>(null);
  const [localRecordingUrl, setLocalRecordingUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Sync local state when call object updates or modal opens
  useEffect(() => {
    if (call) {
      setLocalTranscript(call.refined_transcript || null);
      setLocalRecordingUrl(call.recording_url || null);
    }
  }, [call, open]);

  // Use local state if we fetched, otherwise fallback to call data
  const transcript = localTranscript || call?.refined_transcript;
  const recordingUrl = localRecordingUrl || call?.recording_url;

  const downloadTranscript = () => {
    if (!call) return;
    
    const content = `CALL TRANSCRIPT
================

Driver: ${call.driver_name}
Vehicle: ${call.reg_no}
Phone: ${call.phone_number}
Status: ${call.status}
Duration: ${call.call_duration ? `${call.call_duration}s` : 'N/A'}
Date: ${new Date(call.created_at).toLocaleString()}
Call ID: ${call.call_sid || 'N/A'}

--- TRANSCRIPT ---

${transcript || 'No transcript available'}
`;
    
    try {
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transcript-${call.reg_no}-${call.driver_name.replace(/\s+/g, '_')}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
      toast.error('Failed to generate download');
    }
  };

  const togglePlayback = () => {
    if (!audioRef.current) return;
    
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(err => {
        console.error('Audio playback failed:', err);
        toast.error('Failed to play audio recording');
      });
    }
    setIsPlaying(!isPlaying);
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
  };

  const handleFetchTranscript = async () => {
    if (!call || !onFetchTranscript) return;
    
    setIsFetching(true);
    try {
      const result = await onFetchTranscript(call.id);
      if (result) {
        if (result.transcript) setLocalTranscript(result.transcript);
        if (result.recording_url) setLocalRecordingUrl(result.recording_url);
        toast.success('Transcript updated successfully');
      } else {
        toast.info('No transcript found on server yet');
      }
    } catch (error) {
      console.error('Manual fetch failed:', error);
      toast.error('Could not retrieve transcript from provider');
    } finally {
      setIsFetching(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // Robust cleanup on close
      setIsPlaying(false);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      // Reset local cache to prevent data bleed
      setLocalTranscript(null);
      setLocalRecordingUrl(null);
    }
    onOpenChange(newOpen);
  };

  if (!call) return null;

  const showFetchButton = !transcript && call.status === 'completed' && !!onFetchTranscript;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
        <DialogHeader className="border-b pb-4">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <FileText className="w-6 h-6 text-primary" />
            Call Summary & Details
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6 flex-1 overflow-hidden pt-4">
          {/* Metadata Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 rounded-xl bg-muted/30 border border-border/50">
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Driver</p>
              <p className="font-semibold text-sm truncate">{call.driver_name}</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Vehicle</p>
              <p className="font-mono font-bold text-sm text-primary">{call.reg_no}</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Phone</p>
              <p className="text-sm font-medium">{call.phone_number}</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Duration</p>
              <p className="text-sm font-medium">{call.call_duration ? `${call.call_duration}s` : 'N/A'}</p>
            </div>
          </div>

          {/* Audio Player Section */}
          {recordingUrl && (
            <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-primary">
                  <Volume2 className="w-4 h-4" />
                  <span className="text-sm font-bold">Official Recording</span>
                </div>
                <audio 
                  ref={audioRef}
                  src={recordingUrl}
                  onEnded={handleAudioEnded}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  className="hidden"
                />
              </div>
              <div className="flex items-center gap-4">
                <Button
                  size="icon"
                  variant="default"
                  className="h-12 w-12 rounded-full shrink-0 shadow-lg"
                  onClick={togglePlayback}
                >
                  {isPlaying ? <Pause className="fill-current" /> : <Play className="fill-current ml-1" />}
                </Button>
                <div className="flex-1 space-y-1">
                   <div className="h-1.5 w-full bg-primary/20 rounded-full overflow-hidden">
                      <div className={cn("h-full bg-primary transition-all duration-300", isPlaying ? "w-full animate-pulse" : "w-0")} />
                   </div>
                   <p className="text-[10px] text-muted-foreground italic">Click play to listen to the call audio</p>
                </div>
              </div>
            </div>
          )}

          {/* Transcript Content Area */}
          <div className="flex-1 flex flex-col min-h-0 border rounded-xl bg-card overflow-hidden">
            <div className="px-4 py-2 border-b bg-muted/20 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Transcript</span>
              {transcript && <span className="text-[10px] text-success font-bold flex items-center gap-1"><CheckCircle className="w-3 h-3"/> Verified</span>}
            </div>
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              {transcript ? (
                <p className="text-sm whitespace-pre-wrap leading-relaxed text-foreground/90">
                  {transcript}
                </p>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-4 py-10">
                  <div className="p-3 rounded-full bg-muted">
                    <FileText className="w-8 h-8 text-muted-foreground/50" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">
                      {call.status === 'completed' 
                        ? 'Summary is being processed by the AI...' 
                        : 'No transcript available for this call.'}
                    </p>
                    {showFetchButton && (
                      <p className="text-xs text-muted-foreground/70">It might take a few moments after a call ends.</p>
                    )}
                  </div>
                  
                  {showFetchButton && (
                    <Button 
                      variant="secondary" 
                      onClick={handleFetchTranscript}
                      disabled={isFetching}
                      className="gap-2 shadow-sm"
                    >
                      {isFetching ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Fetching from Subverse...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-4 h-4" />
                          Manual Refresh
                        </>
                      )}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex justify-between items-center pt-2 border-t">
            <p className="text-[10px] text-muted-foreground italic">
              Status: <span className="capitalize font-semibold">{call.status}</span>
            </p>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => handleOpenChange(false)}
              >
                Dismiss
              </Button>
              {transcript && (
                <Button onClick={downloadTranscript} className="gap-2 shadow-md">
                  <Download className="w-4 h-4" />
                  Save Transcript
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
