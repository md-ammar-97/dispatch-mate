import { useState, useRef } from 'react';
import { Download, FileText, Play, Pause, Volume2, RefreshCw, Loader2 } from 'lucide-react';
import { Call } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

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

  // Use local state if we fetched, otherwise use call data
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

--- TRANSCRIPT ---

${transcript || 'No transcript available'}
`;
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-${call.reg_no}-${call.driver_name.replace(/\s+/g, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const togglePlayback = () => {
    if (!audioRef.current) return;
    
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
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
        if (result.transcript) {
          setLocalTranscript(result.transcript);
        }
        if (result.recording_url) {
          setLocalRecordingUrl(result.recording_url);
        }
      }
    } finally {
      setIsFetching(false);
    }
  };

  // Reset playback state when modal closes or call changes
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setIsPlaying(false);
      setLocalTranscript(null);
      setLocalRecordingUrl(null);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
    }
    onOpenChange(newOpen);
  };

  if (!call) return null;

  const showFetchButton = !transcript && call.status === 'completed' && onFetchTranscript;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            Call Transcript
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 flex-1 overflow-hidden">
          {/* Call Info */}
          <div className="grid grid-cols-2 gap-4 p-4 rounded-lg bg-muted/50">
            <div>
              <p className="text-xs text-muted-foreground uppercase">Driver</p>
              <p className="font-medium">{call.driver_name}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Vehicle</p>
              <p className="font-mono font-bold text-primary">{call.reg_no}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Phone</p>
              <p className="text-sm">{call.phone_number}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Duration</p>
              <p className="text-sm">{call.call_duration ? `${call.call_duration}s` : 'N/A'}</p>
            </div>
          </div>

          {/* Audio Player */}
          {recordingUrl && (
            <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card">
              <Button
                size="sm"
                variant="outline"
                className="h-10 w-10 p-0 rounded-full"
                onClick={togglePlayback}
              >
                {isPlaying ? (
                  <Pause className="w-4 h-4" />
                ) : (
                  <Play className="w-4 h-4 ml-0.5" />
                )}
              </Button>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Call Recording</span>
                </div>
                <audio 
                  ref={audioRef}
                  src={recordingUrl}
                  onEnded={handleAudioEnded}
                  className="w-full mt-2"
                  controls
                />
              </div>
            </div>
          )}

          {/* Transcript Content */}
          <div className="flex-1 overflow-auto max-h-[40vh] p-4 rounded-lg border border-border bg-card">
            {transcript ? (
              <p className="text-sm whitespace-pre-wrap leading-relaxed">
                {transcript}
              </p>
            ) : (
              <div className="text-center py-8 space-y-4">
                <p className="text-sm text-muted-foreground italic">
                  {call.status === 'completed' 
                    ? 'Transcript not available yet.' 
                    : 'No transcript available for this call.'}
                </p>
                {showFetchButton && (
                  <Button 
                    variant="outline" 
                    onClick={handleFetchTranscript}
                    disabled={isFetching}
                    className="gap-2"
                  >
                    {isFetching ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Fetching...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4" />
                        Fetch Transcript
                      </>
                    )}
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              Close
            </Button>
            {transcript && (
              <Button onClick={downloadTranscript} className="gap-2">
                <Download className="w-4 h-4" />
                Download .txt
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
