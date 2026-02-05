 import { motion } from 'framer-motion';
 
 interface ProgressBarProps {
   progress: number;
   visible: boolean;
 }
 
 export function ProgressBar({ progress, visible }: ProgressBarProps) {
   if (!visible) return null;
 
   return (
     <div className="progress-bar">
       <motion.div
         className="progress-bar-fill"
         initial={{ width: '0%' }}
         animate={{ width: `${progress}%` }}
         transition={{ duration: 0.3, ease: 'easeOut' }}
       />
     </div>
   );
 }