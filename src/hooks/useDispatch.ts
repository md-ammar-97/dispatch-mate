import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dataset, Call, CSVRow } from '@/lib/types';
import { formatPhoneNumber } from '@/lib/csv-parser';
import { toast } from 'sonner';

export type Screen = 'intake' | 'command' | 'summary';

const TERMINAL_STATUSES = ['completed', 'failed', 'canceled'];
const STUCK_CALL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export function useDispatch() {
  const [screen, setScreen] = useState<Screen>('intake');
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [calls, setCalls] = useState<Call[]>([]);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isStopped, setIsStopped] = useState(false);
  
  const watchdogIntervalRef = useRef<NodeJS.Timeout | null>(null);

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
            if (index === -1) return prev; // Don't add if not in current batch
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
      setIsExecuting(false);
      setScreen('summary');
      toast.success('Batch completed');
    }
  }, [calls, dataset?.id, isExecuting]);

  // 4. Stuck Call Reconciliation Logic
  const reconcileStuckCalls = useCallback(async () => {
    if (!dataset?.id || !isExecuting) return;

    const now = Date.now();
    const stuckCalls = calls.filter(c => {
      if (c.status !== 'active' || !c.started_at) return false;
      const activeTime = now - new Date(c.started_at).getTime();
      return activeTime > STUCK_CALL_TIMEOUT_MS;
    });

    if (stuckCalls.length === 0) return;

    console.log(`[Watchdog] Attempting to reconcile ${stuckCalls.length} calls`);

    for (const call of stuckCalls) {
      try {
        const { data, error } = await supabase.functions.invoke('fetch-transcript', {
          body: { call_id: call.id },
        });

        if (error || !data?.transcript) {
           console.warn(`[Watchdog] Reconcile failed for ${call.id}, marking as failed.`);
           await supabase.from('calls').update({ 
             status: 'failed', 
             error_message: 'Call timed out / No response from provider' 
           }).eq('id', call.id);
        }
      } catch (err) {
        console.error('[Watchdog] Exception:', err);
      }
    }
  }, [calls, dataset?.id, isExecuting]);

  // 5. Watchdog Timer Lifecycle
  useEffect(() => {
    if (isExecuting && dataset?.id) {
      if (watchdogIntervalRef.current) clearInterval(watchdogIntervalRef.current);
      watchdogIntervalRef.current = setInterval(reconcileStuckCalls, 60000);
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

  // --- Core Functionalities ---

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
    setIsStopped(false);

    try {
      const { error: dsError } = await supabase
        .from('datasets')
        .update({ status: 'executing' })
        .eq('id', dataset.id);
      
      if (dsError) throw dsError;

      const { error: fnError } = await supabase.functions.invoke('trigger-calls', {
        body: { dataset_id: dataset.id },
      });

      if (fnError) throw fnError;
      toast.success('Batch execution started');
    } catch (error) {
      console.error('Error starting batch:', error);
      setIsExecuting(false);
      toast.error('Failed to start batch execution');
    }
  }, [dataset]);

  const emergencyStop = useCallback(async () => {
    if (!dataset) return;
    setIsStopped(true);

    try {
      // 1. First trigger the stop-call function for all active/ringing calls
      const stoppableCalls = calls.filter(call => 
        ['ringing', 'active'].includes(call.status)
      );

      // We don't await this blocking the UI update, but we fire them off
      stoppableCalls.map(call => 
        supabase.functions.invoke('stop-call', {
          body: { call_id: call.id },
        })
      );

      // 2. Then update DB status to reflect cancellation immediately
      await Promise.all([
        supabase.from('datasets')
          .update({ status: 'failed', completed_at: new Date().toISOString() })
          .eq('id', dataset.id),
        supabase.from('calls')
          .update({ status: 'canceled', error_message: 'Emergency stop triggered' })
          .eq('dataset_id', dataset.id)
          .in('status', ['queued', 'ringing', 'active'])
      ]);

      toast.warning('Emergency stop executed');
      setIsExecuting(false);
    } catch (error) {
      console.error('Error in emergency stop:', error);
      toast.error('Failed to stop batch');
    }
  }, [dataset, calls]); // Added 'calls' dependency

  const resetToIntake = useCallback(() => {
    setScreen('intake');
    setDataset(null);
    setCalls([]);
    setSelectedCallId(null);
    setIsExecuting(false);
    setIsStopped(false);
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
    ? ((dataset.successful_calls + dataset.failed_calls) / dataset.total_calls) * 100 
    : 0;

  return {
    screen, setScreen, dataset, calls, selectedCall, selectedCallId,
    setSelectedCallId, isExecuting, isStopped, progress,
    initializeDataset, startBatch, emergencyStop, resetToIntake, fetchTranscript
  };
}
