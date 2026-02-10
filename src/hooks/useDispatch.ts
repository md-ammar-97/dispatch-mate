{
type: "file_update",
fileName: "src/hooks/useDispatch.ts",
fullContent: `import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dataset, Call, CSVRow } from '@/lib/types';
import { formatPhoneNumber } from '@/lib/csv-parser';
import { toast } from 'sonner';

export type Screen = 'intake' | 'command' | 'summary';

const TERMINAL_STATUSES = ['completed', 'failed', 'canceled'];
// Updated timeout to 45 seconds as requested to prevent hanging batches
const STUCK_CALL_TIMEOUT_MS = 45 * 1000; 

export function useDispatch() {
  const [screen, setScreen] = useState<Screen>('intake');
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [calls, setCalls] = useState<Call[]>([]);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  
  // Ref for the watchdog timer
  const watchdogIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Realtime Calls Subscription
  useEffect(() => {
    if (!dataset?.id) return;

    const channel = supabase
      .channel(\`calls-\${dataset.id}\`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'calls',
          filter: \`dataset_id=eq.\${dataset.id}\`,
        },
        (payload) => {
          const updatedCall = payload.new as Call;
          setCalls(prev => {
            const index = prev.findIndex(c => c.id === updatedCall.id);
            if (index === -1) return prev; 
            const newCalls = [...prev];
            newCalls[index] = { ...newCalls[index], ...updatedCall };
            return newCalls;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [dataset?.id]);

  // 2. Realtime Dataset Subscription
  useEffect(() => {
    if (!dataset?.id) return;

    const channel = supabase
      .channel(\`dataset-\${dataset.id}\`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'datasets',
          filter: \`id=eq.\${dataset.id}\`,
        },
        (payload) => {
          const updatedDataset = payload.new as Dataset;
          setDataset(updatedDataset);
          
          // If the dataset is marked completed/failed by the backend, redirect
          if (updatedDataset.status === 'completed' || updatedDataset.status === 'failed') {
            setIsExecuting(false);
            setScreen('summary');
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [dataset?.id]);

  // 3. Batch Completion Watcher (The Auto-Redirect Logic)
  useEffect(() => {
    if (!dataset?.id || !isExecuting || calls.length === 0) return;

    // Check if ALL calls are in a terminal state
    const allTerminal = calls.every(c => TERMINAL_STATUSES.includes(c.status));

    if (allTerminal) {
      console.log('[Batch] All calls terminal. Redirecting to summary.');
      setIsExecuting(false);
      setScreen('summary');
      toast.success('Batch execution completed');
    }
  }, [calls, dataset?.id, isExecuting]);

  // 4. Stuck Call Watchdog (The "45 Second" Logic)
  const reconcileStuckCalls = useCallback(async () => {
    if (!dataset?.id || !isExecuting) return;

    const now = Date.now();
    
    // Identify calls stuck in 'queued' or 'ringing' for > 45s
    const stuckCalls = calls.filter(c => {
      if (TERMINAL_STATUSES.includes(c.status)) return false;
      
      // Use created_at for queued calls, started_at for ringing/active
      const startTime = c.started_at ? new Date(c.started_at).getTime() : new Date(c.created_at).getTime();
      const activeTime = now - startTime;
      
      // Target only queued or ringing calls that are timing out
      // We generally avoid killing 'active' calls unless explicitly required, 
      // but if 'active' hangs without a transcript for too long, logic could be added here.
      // For now, focusing on 'queued'/'ringing' as requested.
      return (c.status === 'queued' || c.status === 'ringing') && activeTime > STUCK_CALL_TIMEOUT_MS;
    });

    if (stuckCalls.length === 0) return;

    console.log(\`[Watchdog] Cleaning up \${stuckCalls.length} stuck calls...\`);

    // Process cleanup in parallel
    await Promise.all(stuckCalls.map(async (call) => {
      try {
        // 1. Attempt to cancel via API (Backend handles the PUT /call/cancel/{id})
        await supabase.functions.invoke('stop-call', {
          body: { call_id: call.id },
        });

        // 2. Force local update to 'failed' to ensure batch can finish
        // (In case the Edge Function fails or network is spotty)
        const { error } = await supabase.from('calls').update({ 
           status: 'failed', 
           error_message: 'Timeout (45s Limit)',
           completed_at: new Date().toISOString()
        }).eq('id', call.id);

        if (error) throw error;
        
      } catch (err) {
        console.error(\`[Watchdog] Error cleaning call \${call.id}:\`, err);
      }
    }));
    
  }, [calls, dataset?.id, isExecuting]);

  // 5. Watchdog Interval
  useEffect(() => {
    if (isExecuting && dataset?.id) {
      if (watchdogIntervalRef.current) clearInterval(watchdogIntervalRef.current);
      // Run checks more frequently (every 5s) to catch the 45s mark accurately
      watchdogIntervalRef.current = setInterval(reconcileStuckCalls, 5000); 
    } else {
      if (watchdogIntervalRef.current) {
        clearInterval(watchdogIntervalRef.current);
        watchdogIntervalRef.current = null;
      }
    }

    return () => {
      if (watchdogIntervalRef.current) {
        clearInterval(watchdogIntervalRef.current);
        watchdogIntervalRef.current = null;
      }
    };
  }, [isExecuting, dataset?.id, reconcileStuckCalls]);

  const initializeDataset = useCallback(async (data: CSVRow[]) => {
    try {
      const { data: newDataset, error: datasetError } = await supabase
        .from('datasets')
        .insert({
          name: \`Batch \${new Date().toLocaleDateString()} \${new Date().toLocaleTimeString()}\`,
          status: 'approved',
          total_calls: data.length,
          approved_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (datasetError) throw datasetError;

      const callRecords = data.map(row => ({
        dataset_id: newDataset.id,
        driver_name: row.driver_name,
        phone_number: formatPhoneNumber(row.phone_number),
        reg_no: row.reg_no,
        message: row.message || null,
        status: 'queued' as const,
      }));

      const { data: newCalls, error: callsError } = await supabase
        .from('calls')
        .insert(callRecords)
        .select();

      if (callsError) throw callsError;

      setDataset(newDataset as Dataset);
      setCalls(newCalls as Call[]);
      setScreen('command');
      toast.success('Dataset initialized. Ready to execute.');
    } catch (error) {
      console.error('Error initializing dataset:', error);
      toast.error('Failed to initialize dataset');
    }
  }, []);

  const startBatch = useCallback(async () => {
    if (!dataset) return;

    setIsExecuting(true);

    try {
      await supabase.from('datasets').update({ status: 'executing' }).eq('id', dataset.id);

      const { error } = await supabase.functions.invoke('trigger-calls', {
        body: { dataset_id: dataset.id },
      });

      if (error) throw error;
      toast.success('Batch execution started');
    } catch (error) {
      console.error('Error starting batch:', error);
      setIsExecuting(false);
      toast.error('Failed to start batch execution');
    }
  }, [dataset]);

  const resetToIntake = useCallback(() => {
    setScreen('intake');
    setDataset(null);
    setCalls([]);
    setSelectedCallId(null);
    setIsExecuting(false);
  }, []);

  const fetchTranscript = useCallback(async (callId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('fetch-transcript', {
        body: { call_id: callId },
      });

      if (error) throw error;

      if (data?.transcript) {
        setCalls(prev => prev.map(c => 
          c.id === callId ? { 
            ...c, 
            refined_transcript: data.transcript, 
            recording_url: data.recording_url || c.recording_url 
          } : c
        ));
        toast.success('Transcript fetched');
        return data;
      }
      toast.info('No transcript available yet');
      return null;
    } catch (error) {
      console.error('Error fetching transcript:', error);
      toast.error('Failed to fetch transcript');
      return null;
    }
  }, []);

  const selectedCall = calls.find(c => c.id === selectedCallId) || null;
  const progress = dataset?.total_calls 
    ? (((dataset.successful_calls ?? 0) + (dataset.failed_calls ?? 0)) / dataset.total_calls) * 100 
    : 0;

  return {
    screen, setScreen, dataset, calls, selectedCall, selectedCallId,
    setSelectedCallId, isExecuting, progress,
    initializeDataset, startBatch, resetToIntake, fetchTranscript
  };
}
`
}
