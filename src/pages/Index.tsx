import { AnimatePresence } from 'framer-motion';
import { useDispatch } from '@/hooks/useDispatch';
import { CSVIntake } from '@/screens/CSVIntake';
import { LiveCommandCenter } from '@/screens/LiveCommandCenter';
import { BatchSummaryScreen } from '@/screens/BatchSummaryScreen';

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
    emergencyStop,
    resetToIntake,
    fetchTranscript,
  } = useDispatch();

  return (
    <div className="min-h-screen bg-background">
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
            onEmergencyStop={emergencyStop}
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
