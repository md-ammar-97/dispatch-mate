import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dataset, Call, CSVRow, RetryConfig } from '@/lib/types';
import { formatPhoneNumber } from '@/lib/csv-parser';
import { toast } from 'sonner';

export type Screen = 'intake' | 'command' | 'summary';

const TERMINAL_STATUSES = ['completed', 'failed', 'canceled'];
const STUCK_CALL_TIMEOUT_MS = 500 * 1000;

export function useDispatch() {
  const [screen, setScreen] = useState<Screen>('intake');
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [calls, setCalls] = useState<Call[]>([]);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [retryConfig, setRetryConfig] = useState<RetryConfig>({ retryAfterMinutes: 2, totalAttempts: 2 });
  
  const watchdogIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const retryTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // 1. Realtime Calls Subscription
  useEffect(() => {
    if (!dataset?.id) return;

    const channel = supabase
      .channel(`calls-${dataset.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'calls',
          filter: `dataset_id=eq.${dataset.id}`,
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
      .channel(`dataset-${dataset.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'datasets',
          filter: `id=eq.${dataset.id}`,
        },
        (payload) => {
          const updatedDataset = payload.new as Dataset;
          setDataset(updatedDataset);
          
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

  // 3. Batch Completion Watcher
  useEffect(() => {
    if (!dataset?.id || !isExecuting || calls.length === 0) return;

    const allTerminal = calls.every(c => TERMINAL_STATUSES.includes(c.status));

    if (allTerminal) {
      console.log('[Batch] All calls terminal. Redirecting to summary.');
      setIsExecuting(false);
      setScreen('summary');
      // Clear all retry timers
      retryTimersRef.current.forEach(t => clearTimeout(t));
      retryTimersRef.current.clear();
      toast.success('Batch execution completed');
    }
  }, [calls, dataset?.id, isExecuting]);

  // 3b. Auto-Retry: watch for "Could Not Connect" failures
  useEffect(() => {
    if (!dataset?.id || !isExecuting) return;

    calls.forEach(call => {
      if (
        call.status === 'failed' &&
        call.error_message?.includes('Could Not Connect') &&
        (call.attempt || 1) < (call.max_attempts || retryConfig.totalAttempts) &&
        !retryTimersRef.current.has(call.id) &&
        !call.retry_at
      ) {
        const retryAt = new Date(Date.now() + retryConfig.retryAfterMinutes * 60 * 1000).toISOString();
        const nextAttempt = (call.attempt || 1) + 1;

        // Set retry_at on the call locally
        setCalls(prev => prev.map(c =>
          c.id === call.id ? { ...c, retry_at: retryAt, attempt: call.attempt || 1, max_attempts: call.max_attempts || retryConfig.totalAttempts } : c
        ));

        const timer = setTimeout(async () => {
          retryTimersRef.current.delete(call.id);
          console.log(`[Retry] Retrying call ${call.id}, attempt ${nextAttempt}`);

          // Reset call to queued for re-trigger
          await supabase.from('calls').update({
            status: 'queued',
            error_message: null,
            completed_at: null,
            started_at: null,
            call_sid: null,
          }).eq('id', call.id);

          setCalls(prev => prev.map(c =>
            c.id === call.id ? { ...c, status: 'queued' as const, error_message: null, retry_at: null, attempt: nextAttempt, completed_at: null, started_at: null } : c
          ));

          // Re-trigger just this call
          try {
            await supabase.functions.invoke('trigger-calls', {
              body: { dataset_id: dataset!.id, call_ids: [call.id] },
            });
          } catch (err) {
            console.error(`[Retry] Failed to re-trigger call ${call.id}:`, err);
          }
        }, retryConfig.retryAfterMinutes * 60 * 1000);

        retryTimersRef.current.set(call.id, timer);
      }
    });
  }, [calls, dataset?.id, isExecuting, retryConfig]);

  // 4. Stuck Call Watchdog
  const reconcileStuckCalls = useCallback(async () => {
    if (!dataset?.id || !isExecuting) return;

    const now = Date.now();
    
    const stuckCalls = calls.filter(c => {
      if (TERMINAL_STATUSES.includes(c.status)) return false;
      
      const startTime = c.started_at ? new Date(c.started_at).getTime() : new Date(c.created_at).getTime();
      const activeTime = now - startTime;
      
      return (c.status === 'queued' || c.status === 'ringing') && activeTime > STUCK_CALL_TIMEOUT_MS;
    });

    if (stuckCalls.length === 0) return;

    console.log(`[Watchdog] Cleaning up ${stuckCalls.length} stuck calls...`);

    await Promise.all(stuckCalls.map(async (call) => {
      try {
        await supabase.functions.invoke('stop-call', {
          body: { call_id: call.id },
        });

        const { error } = await supabase.from('calls').update({ 
           status: 'failed', 
           error_message: 'Timeout (500s Limit)',
           completed_at: new Date().toISOString()
        }).eq('id', call.id);

        if (error) throw error;
        
      } catch (err) {
        console.error(`[Watchdog] Error cleaning call ${call.id}:`, err);
      }
    }));
    
  }, [calls, dataset?.id, isExecuting]);

  // 5. Watchdog Interval
  useEffect(() => {
    if (isExecuting && dataset?.id) {
      if (watchdogIntervalRef.current) clearInterval(watchdogIntervalRef.current);
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
          name: `Batch ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
          status: 'approved',
          total_calls: data.length,
          approved_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (datasetError) throw datasetError;

      const clientTimestamp = new Date().toISOString();
      const callRecords = data.map(row => ({
        dataset_id: newDataset.id,
        driver_name: row.driver_name,
        phone_number: formatPhoneNumber(row.phone_number),
        reg_no: row.reg_no,
        message: row.message || null,
        status: 'queued' as const,
        client_timestamp: clientTimestamp,
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

    // Stamp retry config onto all calls
    setCalls(prev => prev.map(c => ({ ...c, attempt: 1, max_attempts: retryConfig.totalAttempts, retry_at: null })));

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
  }, [dataset, retryConfig]);

  const resetToIntake = useCallback(() => {
    // Clear retry timers
    retryTimersRef.current.forEach(t => clearTimeout(t));
    retryTimersRef.current.clear();
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

  const fetchCallHistory = useCallback(async () => {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data, error } = await supabase
        .from('calls')
        .select('*')
        .gte('created_at', thirtyDaysAgo.toISOString())
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data as Call[]) || [];
    } catch (error) {
      console.error('Error fetching call history:', error);
      toast.error('Failed to fetch call history');
      return [];
    }
  }, []);

  const selectedCall = calls.find(c => c.id === selectedCallId) || null;
  const progress = dataset?.total_calls 
    ? (((dataset.successful_calls ?? 0) + (dataset.failed_calls ?? 0)) / dataset.total_calls) * 100 
    : 0;

  return {
    screen, setScreen, dataset, calls, selectedCall, selectedCallId,
    setSelectedCallId, isExecuting, progress,
    retryConfig, setRetryConfig,
    initializeDataset, startBatch, resetToIntake, fetchTranscript, fetchCallHistory
  };
}
