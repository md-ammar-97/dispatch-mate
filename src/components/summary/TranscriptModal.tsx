import { useState } from 'react';
import { X, Download, FileText } from 'lucide-react';
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
}

export function TranscriptModal({ call, open, onOpenChange }: TranscriptModalProps) {
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

${call.refined_transcript || 'No transcript available'}
`;
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-${call.reg_no}-${call.driver_name.replace(/\s+/g, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!call) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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

          {/* Transcript Content */}
          <div className="flex-1 overflow-auto max-h-[40vh] p-4 rounded-lg border border-border bg-card">
            {call.refined_transcript ? (
              <p className="text-sm whitespace-pre-wrap leading-relaxed">
                {call.refined_transcript}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground italic text-center py-8">
                No transcript available for this call.
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
            {call.refined_transcript && (
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
