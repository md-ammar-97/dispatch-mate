import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dataset, Call, CSVRow } from '@/lib/types';
import { formatPhoneNumber } from '@/lib/csv-parser';
import { toast } from 'sonner';

export type Screen = 'intake' | 'command' | 'summary';

const TERMINAL_STATUSES = ['completed', 'failed', 'canceled'];

export function useDispatch() {
  const [screen, setScreen] = useState<Screen>('intake');
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [calls, setCalls] = useState<Call[]>([]);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isStopped, setIsStopped] = useState(false);

  // Subscribe to realtime updates for calls
  useEffect(() => {
    if (!dataset?.id) return;

    console.log(`[Realtime] Subscribing to calls for dataset ${dataset.id}`);

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
          console.log('[Realtime] Call update received:', payload.new);
          const updatedCall = payload.new as Call;
          
          setCalls(prev => 
            prev.map(c => c.id === updatedCall.id ? updatedCall : c)
          );
        }
      )
      .subscribe((status) => {
        console.log(`[Realtime] Calls subscription status: ${status}`);
      });

    return () => {
      console.log(`[Realtime] Unsubscribing from calls for dataset ${dataset.id}`);
      supabase.removeChannel(channel);
    };
  }, [dataset?.id]);

  // Subscribe to dataset updates
  useEffect(() => {
    if (!dataset?.id) return;

    console.log(`[Realtime] Subscribing to dataset ${dataset.id}`);

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
          console.log('[Realtime] Dataset update received:', payload.new);
          const updatedDataset = payload.new as Dataset;
          setDataset(updatedDataset);
          
          // Auto-navigate to summary when dataset completes
          if (updatedDataset.status === 'completed' || updatedDataset.status === 'failed') {
            console.log('[Realtime] Dataset reached terminal status, stopping execution');
            setIsExecuting(false);
            setScreen('summary');
          }
        }
      )
      .subscribe((status) => {
        console.log(`[Realtime] Dataset subscription status: ${status}`);
      });

    return () => {
      console.log(`[Realtime] Unsubscribing from dataset ${dataset.id}`);
      supabase.removeChannel(channel);
    };
  }, [dataset?.id]);

  // Batch watcher: Auto-terminate when all calls reach terminal status
  useEffect(() => {
    if (!dataset?.id || !isExecuting || calls.length === 0) return;

    const allCallsTerminal = calls.every(call => 
      TERMINAL_STATUSES.includes(call.status)
    );

    if (allCallsTerminal) {
      console.log('[BatchWatcher] All calls in terminal status, auto-completing');
      setIsExecuting(false);
      setScreen('summary');
      toast.success('Batch execution completed');
    }
  }, [calls, dataset?.id, isExecuting]);

  const initializeDataset = useCallback(async (data: CSVRow[]) => {
    try {
      // Create dataset
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

      // Create call records with message field
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
      // Update dataset status to executing
      await supabase
        .from('datasets')
        .update({ status: 'executing' })
        .eq('id', dataset.id);

      // Trigger calls via edge function
      const { error } = await supabase.functions.invoke('trigger-calls', {
        body: { dataset_id: dataset.id },
      });

      if (error) throw error;

      toast.success('Batch execution started');
    } catch (error) {
      console.error('Error starting batch:', error);
      toast.error('Failed to start batch execution');
      setIsExecuting(false);
    }
  }, [dataset]);

  const emergencyStop = useCallback(async () => {
    if (!dataset) return;

    setIsStopped(true);

    try {
      // Update dataset status to failed
      await supabase
        .from('datasets')
        .update({ status: 'failed', completed_at: new Date().toISOString() })
        .eq('id', dataset.id);

      // Mark remaining queued/active calls as failed
      await supabase
        .from('calls')
        .update({ status: 'failed', error_message: 'Emergency stop triggered' })
        .eq('dataset_id', dataset.id)
        .in('status', ['queued', 'ringing', 'active']);

      toast.warning('Emergency stop executed');
      setIsExecuting(false);
    } catch (error) {
      console.error('Error stopping batch:', error);
      toast.error('Failed to stop batch');
    }
  }, [dataset]);

  const resetToIntake = useCallback(() => {
    console.log('[Reset] Clearing all batch state and returning to intake');
    setScreen('intake');
    setDataset(null);
    setCalls([]);
    setSelectedCallId(null);
    setIsExecuting(false);
    setIsStopped(false);
  }, []);

  const selectedCall = useMemo(() => 
    calls.find(c => c.id === selectedCallId) || null,
    [calls, selectedCallId]
  );

  const progress = useMemo(() => {
    if (!dataset?.total_calls) return 0;
    return ((dataset.successful_calls + dataset.failed_calls) / dataset.total_calls) * 100;
  }, [dataset?.total_calls, dataset?.successful_calls, dataset?.failed_calls]);

  return {
    screen,
    setScreen,
    dataset,
    calls,
    selectedCall,
    selectedCallId,
    setSelectedCallId,
    isExecuting,
    isStopped,
    progress,
    initializeDataset,
    startBatch,
    emergencyStop,
    resetToIntake,
  };
}
