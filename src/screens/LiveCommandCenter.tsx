import { Play, Radio, Loader2 } from 'lucide-react';
import { Dataset, Call, RetryConfig } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { CallCard } from '@/components/calls/CallCard';
import { ProgressBar } from '@/components/layout/ProgressBar';
import { PageTransition } from '@/components/layout/PageTransition';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface LiveCommandCenterProps {
  dataset: Dataset;
  calls: Call[];
  selectedCall: Call | null;
  onSelectCall: (id: string) => void;
  isExecuting: boolean;
  progress: number;
  onStartBatch: () => void;
  retryConfig: RetryConfig;
  onRetryConfigChange: (config: RetryConfig) => void;
}

export function LiveCommandCenter({
  dataset,
  calls,
  selectedCall,
  onSelectCall,
  isExecuting,
  progress,
  onStartBatch,
  retryConfig,
  onRetryConfigChange,
}: LiveCommandCenterProps) {
  const activeCalls = calls.filter(c => c.status === 'active').length;
  const completedCalls = calls.filter(c => c.status === 'completed' || c.status === 'failed').length;

  return (
    <PageTransition className="min-h-screen flex flex-col">
      <ProgressBar progress={progress} visible={isExecuting} />

      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center">
            {/* Left: Title */}
            <div className="flex items-center gap-3 flex-1">
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

            {/* Center: Start / Executing */}
            <div className="flex-1 flex justify-center">
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
                <div className="flex items-center gap-2 px-4 py-2 bg-muted/50 rounded-lg border border-border">
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  <span className="text-sm font-medium text-muted-foreground">Executing Batch...</span>
                </div>
              )}
            </div>

            {/* Right: spacer for logout button area */}
            <div className="flex-1" />
          </div>
        </div>
      </header>

      {/* Stats bar with retry controls */}
      <div className="border-b border-border bg-muted/30">
        <div className="container mx-auto px-6 py-3">
          <div className="flex items-center gap-6 text-sm flex-wrap">
            {/* Retry controls - left aligned */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground text-xs whitespace-nowrap">Retry after:</span>
                <Select
                  value={String(retryConfig.retryAfterMinutes)}
                  onValueChange={(v) => onRetryConfigChange({ ...retryConfig, retryAfterMinutes: Number(v) })}
                  disabled={isExecuting}
                >
                  <SelectTrigger className="h-7 w-[72px] text-xs bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-background z-50">
                    {Array.from({ length: 14 }, (_, i) => i + 2).map(n => (
                      <SelectItem key={n} value={String(n)}>{n} min</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground text-xs whitespace-nowrap">Total attempts:</span>
                <Select
                  value={String(retryConfig.totalAttempts)}
                  onValueChange={(v) => onRetryConfigChange({ ...retryConfig, totalAttempts: Number(v) })}
                  disabled={isExecuting}
                >
                  <SelectTrigger className="h-7 w-[56px] text-xs bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-background z-50">
                    {[2, 3, 4, 5].map(n => (
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="h-4 w-px bg-border" />

            {/* Existing stats */}
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

      {/* Main content - full width, no transcript panel */}
      <main className="flex-1 container mx-auto px-6 py-6">
        <div className="h-[calc(100vh-200px)] overflow-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
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
      </main>
    </PageTransition>
  );
}
