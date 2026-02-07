 import { motion } from 'framer-motion';
 import { BarChart3 } from 'lucide-react';
 import { Dataset, Call } from '@/lib/types';
 import { BatchSummary } from '@/components/summary/BatchSummary';
 import { PageTransition } from '@/components/layout/PageTransition';
 
interface BatchSummaryScreenProps {
  dataset: Dataset;
  calls: Call[];
  onReset: () => void;
  onSelectCall: (id: string) => void;
  onFetchTranscript?: (callId: string) => Promise<{ transcript?: string; recording_url?: string } | null>;
}

export function BatchSummaryScreen({
  dataset,
  calls,
  onReset,
  onSelectCall,
  onFetchTranscript,
}: BatchSummaryScreenProps) {
   return (
     <PageTransition className="min-h-screen flex flex-col">
       {/* Header */}
       <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
         <div className="container mx-auto px-6 py-4">
           <div className="flex items-center gap-3">
             <div className="p-2 rounded-xl bg-primary/10">
               <BarChart3 className="w-6 h-6 text-primary" />
             </div>
             <div>
               <h1 className="text-xl font-semibold text-foreground">Batch Summary</h1>
               <p className="text-sm text-muted-foreground">{dataset.name}</p>
             </div>
           </div>
         </div>
       </header>
 
       {/* Main content */}
       <main className="flex-1 container mx-auto px-6 py-6">
          <BatchSummary
            dataset={dataset}
            calls={calls}
            onReset={onReset}
            onSelectCall={onSelectCall}
            onFetchTranscript={onFetchTranscript}
          />
       </main>
     </PageTransition>
   );
 }