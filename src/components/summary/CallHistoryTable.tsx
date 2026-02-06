import { useState } from 'react';
import { motion } from 'framer-motion';
import { Play, Download, Eye, CheckCircle, XCircle, Clock, X } from 'lucide-react';
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

interface CallHistoryTableProps {
  calls: Call[];
  onSelectCall: (id: string) => void;
}

export function CallHistoryTable({ calls, onSelectCall }: CallHistoryTableProps) {
  const [filter, setFilter] = useState<'all' | 'completed' | 'failed'>('all');
  const [hoveredCallId, setHoveredCallId] = useState<string | null>(null);

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

  const downloadTranscript = (call: Call) => {
    const content = `Driver: ${call.driver_name}
Vehicle: ${call.reg_no}
Phone: ${call.phone_number}
Status: ${call.status}
Duration: ${call.call_duration ? `${call.call_duration}s` : 'N/A'}

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

  return (
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
              <TableHead className="w-[200px]">Transcript</TableHead>
              <TableHead className="w-[100px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCalls.map((call, i) => (
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
                    {statusIcon[call.status]}
                    <span className="text-xs capitalize">{call.status}</span>
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {call.call_duration ? `${call.call_duration}s` : '-'}
                </TableCell>
                <TableCell className="relative">
                  {call.refined_transcript ? (
                    <div 
                      className="relative"
                      onMouseEnter={() => setHoveredCallId(call.id)}
                      onMouseLeave={() => setHoveredCallId(null)}
                    >
                      <p className="text-xs text-muted-foreground truncate max-w-[180px] cursor-pointer hover:text-foreground">
                        {call.refined_transcript.substring(0, 50)}...
                      </p>
                      
                      {/* Tooltip on hover */}
                      {hoveredCallId === call.id && (
                        <div className="absolute left-0 top-full mt-2 z-50 w-80 max-h-64 overflow-auto p-4 bg-popover border border-border rounded-lg shadow-lg">
                          <div className="flex items-start justify-between mb-2">
                            <span className="text-xs font-medium text-muted-foreground uppercase">Transcript</span>
                            <button 
                              onClick={() => setHoveredCallId(null)}
                              className="p-0.5 hover:bg-muted rounded"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                          <p className="text-sm whitespace-pre-wrap">
                            {call.refined_transcript}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground italic">
                      {call.status === 'completed' ? 'No transcript' : 'Pending...'}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {call.refined_transcript && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          title="View transcript"
                          onMouseEnter={() => setHoveredCallId(call.id)}
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          title="Download transcript"
                          onClick={() => downloadTranscript(call)}
                        >
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                      </>
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
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}