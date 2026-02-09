import { motion } from 'framer-motion';
import { Play, StopCircle, Radio, Loader2 } from 'lucide-react';
import { Dataset, Call } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { CallCard } from '@/components/calls/CallCard';
import { TranscriptPanel } from '@/components/calls/TranscriptPanel';
import { ProgressBar } from '@/components/layout/ProgressBar';
import { PageTransition } from '@/components/layout/PageTransition';
import { supabase } from "@/integrations/supabase/client";

interface LiveCommandCenterProps {
  dataset: Dataset;
  calls: Call[];
  selectedCall: Call | null;
  onSelectCall: (id: string) => void;
  isExecuting: boolean;
  progress: number;
  onStartBatch: () => void;
  onEmergencyStop: () => void;
}

export function LiveCommandCenter({
  dataset,
  calls,
  selectedCall,
  onSelectCall,
  isExecuting,
  progress,
  onStartBatch,
  onEmergencyStop,
}: LiveCommandCenterProps) {
  const activeCalls = calls.filter(c => c.status === 'active').length;
  const completedCalls = calls.filter(c => c.status === 'completed' || c.status === 'failed').length;

  // New function to handle the API stop calls + UI state update
  const handleEmergencyStop = async () => {
    // Loop through all active calls and kill them via the Edge Function
    const activeCalls = calls.filter(c => c.status === 'active');
    
    // Fire the stop requests in parallel
    await Promise.all(activeCalls.map(call => 
      supabase.functions.invoke('stop-call', { body: { call_id: call.id } })
    ));

    // CRITICAL: Call the original prop to ensure the UI updates (stops the spinner, etc.)
    onEmergencyStop();
  };

  return (
    <PageTransition className="min-h-screen flex flex-col">
      <ProgressBar progress={progress} visible={isExecuting} />

      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-primary/10">
                <Radio className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-foreground">Live Command Center</h1>
                <p className="text-sm text-muted-foreground">
                  {dataset.name} • {calls.length} calls
                </p>
              </div>
            </div>

            {/* Control buttons */}
            <div className="flex items-center gap-3">
              {!isExecuting ? (
                <Button
                  size="lg"
                  variant="success"
                  onClick={onStartBatch}
                  className="gap-2"
                >
                  <Play className="w-4 h-4" />
                  Start Batch
                </Button>
              ) : (
                <Button
                  size="lg"
                  variant="emergency"
                  onClick={handleEmergencyStop} // Updated to use the new handler
                  className="gap-2"
                >
                  <StopCircle className="w-4 h-4" />
                  Emergency Stop
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Stats bar */}
      <div className="border-b border-border bg-muted/30">
        <div className="container mx-auto px-6 py-3">
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Queued:</span>
              <span className="font-semibold">
                {calls.filter(c => c.status === 'queued').length}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                {activeCalls > 0 && (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
                  </>
                )}
                {activeCalls === 0 && (
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-muted-foreground" />
                )}
              </span>
              <span className="text-muted-foreground">Active:</span>
              <span className="font-semibold text-success">{activeCalls}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Completed:</span>
              <span className="font-semibold">{completedCalls}/{calls.length}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 container mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-200px)]">
          {/* Call cards grid */}
          <div className="lg:col-span-2 overflow-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {calls.map((call) => (
                <CallCard
                  key={call.id}
                  call={call}
                  isActive={call.id === selectedCall?.id}
                  onClick={() => onSelectCall(call.id)}
                />
              ))}
            </div>
          </div>

          {/* Transcript panel */}
          <div className="hidden lg:block">
            <TranscriptPanel call={selectedCall} />
          </div>
        </div>
      </main>

      {/* Mobile transcript panel */}
      {selectedCall && (
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          className="lg:hidden fixed bottom-0 left-0 right-0 h-1/2 bg-card border-t border-border z-20"
        >
          <TranscriptPanel call={selectedCall} />
        </motion.div>
      )}
    </PageTransition>
  );
}
