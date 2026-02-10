import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Play, Download } from 'lucide-react';
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

interface CallHistoryPanelProps {
  onFetchCallHistory?: () => Promise<Call[]>;
}

export function CallHistoryPanel({ onFetchCallHistory }: CallHistoryPanelProps) {
  const [history, setHistory] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!onFetchCallHistory) return;
    setLoading(true);
    onFetchCallHistory()
      .then(setHistory)
      .finally(() => setLoading(false));
  }, [onFetchCallHistory]);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString();
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">Loading history...</span>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        No call history found in the last 30 days.
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border bg-card overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-border bg-muted/30">
        <span className="font-medium text-sm">{history.length} calls in the last 30 days</span>
      </div>
      <div className="max-h-[600px] overflow-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/20">
              <TableHead>Date</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Driver</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Vehicle No</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Transcript</TableHead>
              <TableHead className="text-right">Recording</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.map((call, i) => (
              <motion.tr
                key={call.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.01 }}
                className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors"
              >
                <TableCell className="text-sm">
                  {formatDate(call.client_timestamp || call.created_at)}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatTime(call.client_timestamp || call.created_at)}
                </TableCell>
                <TableCell className="font-medium">{call.driver_name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{call.phone_number}</TableCell>
                <TableCell className="font-mono font-bold text-primary">{call.reg_no}</TableCell>
                <TableCell>
                  <span className="text-xs capitalize">{call.status}</span>
                </TableCell>
                <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                  {call.refined_transcript
                    ? call.refined_transcript.slice(0, 60) + (call.refined_transcript.length > 60 ? '…' : '')
                    : '-'}
                </TableCell>
                <TableCell className="text-right">
                  {call.recording_url ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={() => window.open(call.recording_url!, '_blank')}
                    >
                      <Play className="w-3.5 h-3.5" />
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </TableCell>
              </motion.tr>
            ))}
          </TableBody>
        </Table>
      </div>
    </motion.div>
  );
}
