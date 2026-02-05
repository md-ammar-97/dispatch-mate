 import { motion } from 'framer-motion';
 import { CheckCircle, XCircle, Clock, Download, RotateCcw, Play, FileText } from 'lucide-react';
 import { Dataset, Call } from '@/lib/types';
 import { Button } from '@/components/ui/button';
 import { CallHistoryTable } from './CallHistoryTable';
 import { cn } from '@/lib/utils';
 
 interface BatchSummaryProps {
   dataset: Dataset;
   calls: Call[];
   onReset: () => void;
   onSelectCall: (id: string) => void;
 }
 
 export function BatchSummary({ dataset, calls, onReset, onSelectCall }: BatchSummaryProps) {
   const successRate = dataset.total_calls > 0 
     ? Math.round((dataset.successful_calls / dataset.total_calls) * 100) 
     : 0;
 
   const exportTranscripts = (format: 'json' | 'txt' | 'pdf') => {
     const data = calls.map(c => ({
       reg_no: c.reg_no,
       driver_name: c.driver_name,
       phone_number: c.phone_number,
       status: c.status,
       transcript: c.refined_transcript || c.live_transcript || '',
       duration: c.call_duration,
       recording_url: c.recording_url,
     }));
 
     if (format === 'json') {
       const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
       downloadBlob(blob, `batch-${dataset.id}-transcripts.json`);
     } else if (format === 'txt') {
       const text = data.map(d => 
         `=== ${d.reg_no} - ${d.driver_name} ===\nStatus: ${d.status}\n${d.transcript}\n`
       ).join('\n');
       const blob = new Blob([text], { type: 'text/plain' });
       downloadBlob(blob, `batch-${dataset.id}-transcripts.txt`);
     }
   };
 
   const downloadBlob = (blob: Blob, filename: string) => {
     const url = URL.createObjectURL(blob);
     const a = document.createElement('a');
     a.href = url;
     a.download = filename;
     a.click();
     URL.revokeObjectURL(url);
   };
 
   return (
     <motion.div
       initial={{ opacity: 0 }}
       animate={{ opacity: 1 }}
       className="space-y-6"
     >
       {/* Stats header */}
       <motion.div
         initial={{ opacity: 0, y: 20 }}
         animate={{ opacity: 1, y: 0 }}
         className="grid grid-cols-1 md:grid-cols-4 gap-4"
       >
         <StatCard
           icon={CheckCircle}
           label="Successful"
           value={dataset.successful_calls}
           total={dataset.total_calls}
           color="success"
         />
         <StatCard
           icon={XCircle}
           label="Failed"
           value={dataset.failed_calls}
           total={dataset.total_calls}
           color="destructive"
         />
         <StatCard
           icon={Clock}
           label="Success Rate"
           value={`${successRate}%`}
           color="primary"
         />
         <StatCard
           icon={FileText}
           label="Total Calls"
           value={dataset.total_calls}
           color="muted"
         />
       </motion.div>
 
       {/* Actions */}
       <motion.div
         initial={{ opacity: 0, y: 20 }}
         animate={{ opacity: 1, y: 0 }}
         transition={{ delay: 0.1 }}
         className="flex flex-wrap gap-3"
       >
         <Button
           onClick={() => exportTranscripts('json')}
           variant="outline"
           className="gap-2"
         >
           <Download className="w-4 h-4" />
           Export JSON
         </Button>
         <Button
           onClick={() => exportTranscripts('txt')}
           variant="outline"
           className="gap-2"
         >
           <Download className="w-4 h-4" />
           Export TXT
         </Button>
         <div className="flex-1" />
         <Button
           onClick={onReset}
           variant="default"
           className="gap-2"
         >
           <RotateCcw className="w-4 h-4" />
           Start New Batch
         </Button>
       </motion.div>
 
       {/* Call history table */}
       <motion.div
         initial={{ opacity: 0, y: 20 }}
         animate={{ opacity: 1, y: 0 }}
         transition={{ delay: 0.2 }}
       >
         <CallHistoryTable calls={calls} onSelectCall={onSelectCall} />
       </motion.div>
     </motion.div>
   );
 }
 
 interface StatCardProps {
   icon: React.ComponentType<{ className?: string }>;
   label: string;
   value: number | string;
   total?: number;
   color: 'success' | 'destructive' | 'primary' | 'muted';
 }
 
 function StatCard({ icon: Icon, label, value, total, color }: StatCardProps) {
   const colorClasses = {
     success: 'text-success bg-success/10',
     destructive: 'text-destructive bg-destructive/10',
     primary: 'text-primary bg-primary/10',
     muted: 'text-muted-foreground bg-muted',
   };
 
   return (
     <div className="p-4 rounded-xl border border-border bg-card">
       <div className="flex items-center gap-3">
         <div className={cn("p-2 rounded-lg", colorClasses[color])}>
           <Icon className="w-5 h-5" />
         </div>
         <div>
           <p className="text-xs text-muted-foreground">{label}</p>
           <p className="text-2xl font-bold">
             {value}
             {total !== undefined && (
               <span className="text-sm font-normal text-muted-foreground">
                 /{total}
               </span>
             )}
           </p>
         </div>
       </div>
     </div>
   );
 }