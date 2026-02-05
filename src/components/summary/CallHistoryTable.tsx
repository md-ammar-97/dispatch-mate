 import { useState } from 'react';
 import { motion } from 'framer-motion';
 import { Play, Pause, FileText, CheckCircle, XCircle, Clock } from 'lucide-react';
 import { Call } from '@/lib/types';
 import { Button } from '@/components/ui/button';
 import {
   Table,
   TableBody,
   TableCell,
   TableHead,
   TableHeader,
   TableRow,
 } from '@/components/ui/table';
 import {
   Dialog,
   DialogContent,
   DialogHeader,
   DialogTitle,
 } from '@/components/ui/dialog';
 import { cn } from '@/lib/utils';
 
 interface CallHistoryTableProps {
   calls: Call[];
   onSelectCall: (id: string) => void;
 }
 
 export function CallHistoryTable({ calls, onSelectCall }: CallHistoryTableProps) {
   const [selectedCall, setSelectedCall] = useState<Call | null>(null);
   const [isPlaying, setIsPlaying] = useState(false);
   const [filter, setFilter] = useState<'all' | 'completed' | 'failed'>('all');
 
   const filteredCalls = calls.filter(c => {
     if (filter === 'all') return true;
     return c.status === filter;
   });
 
   const statusIcon = {
     completed: <CheckCircle className="w-4 h-4 text-success" />,
     failed: <XCircle className="w-4 h-4 text-destructive" />,
     queued: <Clock className="w-4 h-4 text-muted-foreground" />,
     ringing: <Clock className="w-4 h-4 text-warning" />,
     active: <Clock className="w-4 h-4 text-success animate-pulse" />,
   };
 
   return (
     <>
       <div className="rounded-xl border border-border bg-card overflow-hidden">
         <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
           <span className="font-medium text-sm">Call History</span>
           <div className="flex gap-1">
             {(['all', 'completed', 'failed'] as const).map(f => (
               <button
                 key={f}
                 onClick={() => setFilter(f)}
                 className={cn(
                   "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                   filter === f 
                     ? "bg-primary text-primary-foreground" 
                     : "text-muted-foreground hover:bg-muted"
                 )}
               >
                 {f.charAt(0).toUpperCase() + f.slice(1)}
               </button>
             ))}
           </div>
         </div>
 
         <div className="max-h-[500px] overflow-auto">
           <Table>
             <TableHeader>
               <TableRow className="bg-muted/20">
                 <TableHead className="w-[120px]">Reg No</TableHead>
                 <TableHead>Driver</TableHead>
                 <TableHead className="w-[100px]">Status</TableHead>
                 <TableHead className="w-[100px]">Duration</TableHead>
                 <TableHead className="w-[120px] text-right">Actions</TableHead>
               </TableRow>
             </TableHeader>
             <TableBody>
               {filteredCalls.map((call, i) => (
                 <motion.tr
                   key={call.id}
                   initial={{ opacity: 0 }}
                   animate={{ opacity: 1 }}
                   transition={{ delay: i * 0.02 }}
                   className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors"
                 >
                   <TableCell className="font-mono font-bold text-primary">
                     {call.reg_no}
                   </TableCell>
                   <TableCell>
                     <div>
                       <p className="font-medium">{call.driver_name}</p>
                       <p className="text-xs text-muted-foreground">{call.phone_number}</p>
                     </div>
                   </TableCell>
                   <TableCell>
                     <div className="flex items-center gap-1.5">
                       {statusIcon[call.status]}
                       <span className="text-xs capitalize">{call.status}</span>
                     </div>
                   </TableCell>
                   <TableCell className="text-sm text-muted-foreground">
                     {call.call_duration ? `${call.call_duration}s` : '-'}
                   </TableCell>
                   <TableCell className="text-right">
                     <div className="flex justify-end gap-1">
                       {call.recording_url && (
                         <Button
                           size="sm"
                           variant="ghost"
                           className="h-7 w-7 p-0"
                           onClick={() => {
                             setSelectedCall(call);
                           }}
                         >
                           <Play className="w-3.5 h-3.5" />
                         </Button>
                       )}
                       {(call.live_transcript || call.refined_transcript) && (
                         <Button
                           size="sm"
                           variant="ghost"
                           className="h-7 w-7 p-0"
                           onClick={() => setSelectedCall(call)}
                         >
                           <FileText className="w-3.5 h-3.5" />
                         </Button>
                       )}
                     </div>
                   </TableCell>
                 </motion.tr>
               ))}
             </TableBody>
           </Table>
         </div>
       </div>
 
       {/* Transcript dialog */}
       <Dialog open={!!selectedCall} onOpenChange={() => setSelectedCall(null)}>
         <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
           <DialogHeader>
             <DialogTitle className="flex items-center gap-2">
               <span className="font-mono text-primary">{selectedCall?.reg_no}</span>
               <span className="text-muted-foreground">-</span>
               <span>{selectedCall?.driver_name}</span>
             </DialogTitle>
           </DialogHeader>
 
           {selectedCall?.recording_url && (
             <div className="p-4 bg-muted/30 rounded-lg">
               <audio
                 controls
                 className="w-full"
                 src={selectedCall.recording_url}
                 onPlay={() => setIsPlaying(true)}
                 onPause={() => setIsPlaying(false)}
                 onEnded={() => setIsPlaying(false)}
               />
             </div>
           )}
 
           <div className="flex-1 overflow-auto">
             <div className="grid grid-cols-2 gap-4">
               <div>
                 <h4 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                   Live Transcript
                 </h4>
                 <div className="p-4 bg-muted/30 rounded-lg min-h-[200px]">
                   <p className="text-sm whitespace-pre-wrap">
                     {selectedCall?.live_transcript || 'No transcript available'}
                   </p>
                 </div>
               </div>
               <div>
                 <h4 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide flex items-center gap-2">
                   Refined Transcript
                   {!selectedCall?.refined_transcript && (
                     <span className="text-xs text-warning animate-pulse">Processing...</span>
                   )}
                 </h4>
                 <div className="p-4 bg-muted/30 rounded-lg min-h-[200px]">
                   <p className="text-sm whitespace-pre-wrap">
                     {selectedCall?.refined_transcript || 'Processing...'}
                   </p>
                 </div>
               </div>
             </div>
           </div>
         </DialogContent>
       </Dialog>
     </>
   );
 }