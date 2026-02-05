 import { motion, AnimatePresence } from 'framer-motion';
 import { ReactNode } from 'react';
 
 interface PageTransitionProps {
   children: ReactNode;
   className?: string;
 }
 
 export function PageTransition({ children, className = '' }: PageTransitionProps) {
   return (
     <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
       className={className}
     >
       {children}
     </motion.div>
   );
 }
 
 export function StaggerContainer({ children, className = '' }: PageTransitionProps) {
   return (
     <motion.div
       initial="initial"
       animate="animate"
       exit="exit"
      transition={{ staggerChildren: 0.1 }}
       className={className}
     >
       {children}
     </motion.div>
   );
 }
 
 export function StaggerItem({ children, className = '' }: PageTransitionProps) {
   return (
     <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
       className={className}
     >
       {children}
     </motion.div>
   );
 }