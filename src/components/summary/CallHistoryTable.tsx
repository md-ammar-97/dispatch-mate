import { useState } from 'react';
import { motion } from 'framer-motion';
import { Play, Download, Eye, CheckCircle, XCircle, Clock, RefreshCw } from 'lucide-react';
import { Call } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { TranscriptModal } from './TranscriptModal';

interface CallHistoryTableProps {
  calls: Call[];
  onSelectCall: (id: string) => void;
  onFetchTranscript?: (callId: string) => Promise<{ transcript?: string; recording_url?: string } | null>;
}

export function CallHistoryTable({ calls, onSelectCall, onFetchTranscript }: CallHistoryTableProps) {
  const [filter, setFilter] = useState<'all' | 'completed' | 'failed'>('all');
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const filteredCalls = calls.filter(c => {
    if (filter === 'all') return true;
    return c.status === filter;
  });

  const statusIcon = {
    completed: <CheckCircle className="w-4 h-4 text-success" />,
    failed: <XCircle className="w-4 h-4 text-destructive" />,
    queued: <Clock className="w-4 h-4 text-muted-foreground" />,
    ringing: <Clock className="w-4 h-4 text-warning" />,
    active: <Clock className="w-4 h-4 text-success animate-pulse" />,
  };

  const openTranscriptModal = (call: Call) => {
    setSelectedCall(call);
    setModalOpen(true);
  };

  const handleDownload = (call: Call) => {
    if (!call.refined_transcript) return;
    const element = document.createElement("a");
    const file = new Blob([call.refined_transcript], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `transcript-${call.reg_no}-${call.id.slice(0, 8)}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <>
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
          <span className="font-medium text-sm">Call History</span>
          <div className="flex gap-1">
            {(['all', 'completed', 'failed'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                  filter === f 
                    ? "bg-primary text-primary-foreground" 
                    : "text-muted-foreground hover:bg-muted"
                )}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-[500px] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/20">
                <TableHead className="w-[120px]">Reg No</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead className="w-[100px]">Status</TableHead>
                <TableHead className="w-[100px]">Duration</TableHead>
                <TableHead className="w-[180px]">Transcript</TableHead>
                <TableHead className="w-[120px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCalls.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground italic">
                    No call history found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredCalls.map((call, i) => (
                  <motion.tr
                    key={call.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.02 }}
                    className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <TableCell className="font-mono font-bold text-primary">
                      {call.reg_no}
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{call.driver_name}</p>
                        <p className="text-xs text-muted-foreground">{call.phone_number}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {statusIcon[call.status as keyof typeof statusIcon] || <Clock className="w-4 h-4" />}
                        <span className="text-xs capitalize">{call.status}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {call.call_duration ? `${call.call_duration}s` : '-'}
                    </TableCell>
                    <TableCell>
                      {call.status === 'completed' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className={cn(
                            "h-7 gap-1.5 text-xs",
                            !call.refined_transcript && "border-warning/50 text-warning hover:bg-warning/10"
                          )}
                          onClick={() => openTranscriptModal(call)}
                        >
                          {call.refined_transcript ? (
                            <>
                              <Eye className="w-3.5 h-3.5" />
                              View
                            </>
                          ) : (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-pulse" />
                              Fetch Summary
                            </>
                          )}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">
                          {call.status === 'failed' ? 'Call failed' : 'In Progress...'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {call.refined_transcript && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            title="Download Transcript"
                            onClick={() => handleDownload(call)}
                          >
                            <Download className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {call.recording_url && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            title="Play recording"
                            onClick={() => window.open(call.recording_url!, '_blank')}
                          >
                            <Play className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </motion.tr>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <TranscriptModal
        call={selectedCall}
        open={modalOpen}
        onOpenChange={setModalOpen}
        onFetchTranscript={onFetchTranscript}
      />
    </>
  );
}
