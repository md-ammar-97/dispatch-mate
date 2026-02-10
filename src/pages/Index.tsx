import { AnimatePresence } from 'framer-motion';
import { useDispatch } from '@/hooks/useDispatch';
import { CSVIntake } from '@/screens/CSVIntake';
import { LiveCommandCenter } from '@/screens/LiveCommandCenter';
import { BatchSummaryScreen } from '@/screens/BatchSummaryScreen';
import { LogoutButton } from '@/components/auth/LogoutButton'; // Import it

const Index = () => {
  const {
    screen,
    dataset,
    calls,
    selectedCall,
    setSelectedCallId,
    isExecuting,
    progress,
    initializeDataset,
    startBatch,
    resetToIntake,
    fetchTranscript,
  } = useDispatch();

  return (
    <div className="min-h-screen bg-background relative"> 
      {/* OPTION A: Floating Logout Button (Top Right)
         This ensures it is always accessible regardless of the screen 
      */}
      <div className="fixed top-4 right-4 z-50">
        <LogoutButton />
      </div>

      <AnimatePresence mode="wait">
        {screen === 'intake' && (
          <CSVIntake key="intake" onConfirm={initializeDataset} />
        )}

        {screen === 'command' && dataset && (
          <LiveCommandCenter
            key="command"
            dataset={dataset}
            calls={calls}
            selectedCall={selectedCall}
            onSelectCall={setSelectedCallId}
            isExecuting={isExecuting}
            progress={progress}
            onStartBatch={startBatch}
          />
        )}

        {screen === 'summary' && dataset && (
          <BatchSummaryScreen
            key="summary"
            dataset={dataset}
            calls={calls}
            onReset={resetToIntake}
            onSelectCall={setSelectedCallId}
            onFetchTranscript={fetchTranscript}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default Index;
