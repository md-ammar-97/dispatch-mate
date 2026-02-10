import { useState } from 'react';
import { BarChart3, History, ArrowLeft } from 'lucide-react';
import { Dataset, Call } from '@/lib/types';
import { BatchSummary } from '@/components/summary/BatchSummary';
import { CallHistoryPanel } from '@/components/summary/CallHistoryPanel';
import { PageTransition } from '@/components/layout/PageTransition';
import { Button } from '@/components/ui/button';

interface BatchSummaryScreenProps {
  dataset: Dataset;
  calls: Call[];
  onReset: () => void;
  onSelectCall: (id: string) => void;
  onFetchTranscript?: (callId: string) => Promise<{ transcript?: string; recording_url?: string } | null>;
  onFetchCallHistory?: () => Promise<Call[]>;
}

export function BatchSummaryScreen({
  dataset,
  calls,
  onReset,
  onSelectCall,
  onFetchTranscript,
  onFetchCallHistory,
}: BatchSummaryScreenProps) {
  const [showHistory, setShowHistory] = useState(false);

  return (
    <PageTransition className="min-h-screen flex flex-col">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4 relative flex items-center justify-between">
          
          {/* Left Side: Title & Icon */}
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10">
              <BarChart3 className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">
                {showHistory ? 'Call History (Last 30 Days)' : 'Batch Summary'}
              </h1>
              <p className="text-sm text-muted-foreground">{dataset.name}</p>
            </div>
          </div>

          {/* Center: Toggle Button (Absolutely Positioned) */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <Button
              variant={showHistory ? "secondary" : "outline"}
              size="sm"
              className="gap-2 shadow-sm"
              onClick={() => setShowHistory(!showHistory)}
            >
              {showHistory ? (
                <>
                  <ArrowLeft className="w-4 h-4" />
                  Back to Summary
                </>
              ) : (
                <>
                  <History className="w-4 h-4" />
                  View History
                </>
              )}
            </Button>
          </div>

          {/* Right Side: Spacer (To ensure header height matches but stays empty for the fixed Logout button) */}
          <div className="w-[100px]"></div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-6 py-6">
        {showHistory ? (
          <CallHistoryPanel onFetchCallHistory={onFetchCallHistory} />
        ) : (
          <BatchSummary
            dataset={dataset}
            calls={calls}
            onReset={onReset}
            onSelectCall={onSelectCall}
            onFetchTranscript={onFetchTranscript}
          />
        )}
      </main>
    </PageTransition>
  );
}
