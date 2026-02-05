 import { motion } from 'framer-motion';
 import { Phone, User, Car, Loader2, CheckCircle, XCircle, PhoneCall } from 'lucide-react';
 import { Call } from '@/lib/types';
 import { cn } from '@/lib/utils';
 
 interface CallCardProps {
   call: Call;
   isActive?: boolean;
   onClick?: () => void;
 }
 
 const statusConfig = {
   queued: {
     icon: Phone,
     label: 'Queued',
     color: 'text-muted-foreground',
     bg: 'bg-muted/50',
   },
   ringing: {
     icon: PhoneCall,
     label: 'Ringing',
     color: 'text-warning',
     bg: 'bg-warning/10',
   },
   active: {
     icon: Loader2,
     label: 'Active',
     color: 'text-success',
     bg: 'bg-success/10',
   },
   completed: {
     icon: CheckCircle,
     label: 'Completed',
     color: 'text-success',
     bg: 'bg-success/10',
   },
   failed: {
     icon: XCircle,
     label: 'Failed',
     color: 'text-destructive',
     bg: 'bg-destructive/10',
   },
 };
 
 export function CallCard({ call, isActive, onClick }: CallCardProps) {
   const config = statusConfig[call.status];
   const Icon = config.icon;
 
   return (
     <motion.div
       layout
       initial={{ opacity: 0, scale: 0.95 }}
       animate={{ opacity: 1, scale: 1 }}
       exit={{ opacity: 0, scale: 0.95 }}
       whileHover={{ scale: 1.02 }}
       whileTap={{ scale: 0.98 }}
       onClick={onClick}
       className={cn(
         "relative p-4 rounded-xl border bg-card cursor-pointer",
         "transition-all duration-200",
         isActive 
           ? "border-primary shadow-lg ring-2 ring-primary/20" 
           : "border-border hover:border-primary/30",
         call.status === 'active' && "card-glow"
       )}
     >
       {/* Active pulse indicator */}
       {call.status === 'active' && (
         <div className="absolute top-3 right-3">
           <span className="relative flex h-3 w-3">
             <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
             <span className="relative inline-flex rounded-full h-3 w-3 bg-success" />
           </span>
         </div>
       )}
 
       {/* Reg No - Prominent */}
       <div className="flex items-center justify-between mb-3">
         <div className="flex items-center gap-2">
           <Car className="w-4 h-4 text-primary" />
           <span className="font-bold text-lg text-foreground font-mono">
             {call.reg_no}
           </span>
         </div>
         <div className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium", config.bg, config.color)}>
           <Icon className={cn("w-3.5 h-3.5", call.status === 'active' && "animate-spin")} />
           {config.label}
         </div>
       </div>
 
       {/* Driver info */}
       <div className="space-y-1.5 text-sm">
         <div className="flex items-center gap-2 text-muted-foreground">
           <User className="w-3.5 h-3.5" />
           <span>{call.driver_name}</span>
         </div>
         <div className="flex items-center gap-2 text-muted-foreground">
           <Phone className="w-3.5 h-3.5" />
           <span className="font-mono">{call.phone_number}</span>
         </div>
       </div>
 
       {/* Live transcript preview */}
       {call.live_transcript && call.status === 'active' && (
         <motion.div
           initial={{ opacity: 0, height: 0 }}
           animate={{ opacity: 1, height: 'auto' }}
           className="mt-3 pt-3 border-t border-border"
         >
           <p className="text-xs text-muted-foreground line-clamp-2 typewriter">
             {call.live_transcript.slice(-100)}
           </p>
         </motion.div>
       )}
 
       {/* Error message */}
       {call.error_message && (
         <motion.div
           initial={{ opacity: 0 }}
           animate={{ opacity: 1 }}
           className="mt-3 pt-3 border-t border-destructive/20"
         >
           <p className="text-xs text-destructive">
             {call.error_message}
           </p>
         </motion.div>
       )}
     </motion.div>
   );
 }