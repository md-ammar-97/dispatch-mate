 import { motion } from 'framer-motion';
 import { CSVRow, ValidationError } from '@/lib/types';
 import { AlertCircle, User, Phone, Car } from 'lucide-react';
 import {
   Table,
   TableBody,
   TableCell,
   TableHead,
   TableHeader,
   TableRow,
 } from '@/components/ui/table';
 
 interface DataPreviewProps {
   data: CSVRow[];
   errors: ValidationError[];
 }
 
 export function DataPreview({ data, errors }: DataPreviewProps) {
   if (data.length === 0 && errors.length === 0) return null;
 
   return (
     <motion.div
       initial={{ opacity: 0, height: 0 }}
       animate={{ opacity: 1, height: 'auto' }}
       exit={{ opacity: 0, height: 0 }}
       transition={{ duration: 0.4 }}
       className="w-full max-w-4xl mx-auto mt-6"
     >
       {errors.length > 0 && (
         <motion.div
           initial={{ opacity: 0, y: -10 }}
           animate={{ opacity: 1, y: 0 }}
           className="mb-4 p-4 bg-destructive/5 border border-destructive/20 rounded-xl"
         >
           <div className="flex items-center gap-2 text-destructive mb-2">
             <AlertCircle className="w-4 h-4" />
             <span className="font-medium">Validation Errors</span>
           </div>
           <ul className="text-sm text-destructive/80 space-y-1">
             {errors.slice(0, 5).map((error, i) => (
               <li key={i}>
                 Row {error.row}: {error.message}
               </li>
             ))}
             {errors.length > 5 && (
               <li className="text-muted-foreground">
                 ...and {errors.length - 5} more errors
               </li>
             )}
           </ul>
         </motion.div>
       )}
 
       {data.length > 0 && (
         <motion.div
           initial={{ opacity: 0 }}
           animate={{ opacity: 1 }}
           transition={{ delay: 0.1 }}
           className="rounded-xl border border-border overflow-hidden bg-card card-elevated"
         >
           <div className="px-4 py-3 border-b border-border bg-muted/30">
             <div className="flex items-center justify-between">
               <span className="text-sm font-medium text-foreground">
                 Preview
               </span>
               <span className="text-xs text-muted-foreground">
                 {data.length} record{data.length !== 1 ? 's' : ''} ready
               </span>
             </div>
           </div>
           
           <div className="max-h-[400px] overflow-auto">
             <Table>
               <TableHeader>
                 <TableRow className="bg-muted/20">
                   <TableHead className="font-medium">
                     <div className="flex items-center gap-2">
                       <User className="w-4 h-4 text-muted-foreground" />
                       Driver Name
                     </div>
                   </TableHead>
                   <TableHead className="font-medium">
                     <div className="flex items-center gap-2">
                       <Phone className="w-4 h-4 text-muted-foreground" />
                       Phone Number
                     </div>
                   </TableHead>
                   <TableHead className="font-medium">
                     <div className="flex items-center gap-2">
                       <Car className="w-4 h-4 text-muted-foreground" />
                       Reg No
                     </div>
                   </TableHead>
                 </TableRow>
               </TableHeader>
               <TableBody>
                 {data.slice(0, 50).map((row, i) => (
                   <motion.tr
                     key={i}
                     initial={{ opacity: 0, x: -10 }}
                     animate={{ opacity: 1, x: 0 }}
                     transition={{ delay: i * 0.02 }}
                     className="border-b border-border/50 last:border-0"
                   >
                     <TableCell className="font-medium">{row.driver_name}</TableCell>
                     <TableCell className="font-mono text-sm text-muted-foreground">
                       {row.phone_number}
                     </TableCell>
                     <TableCell className="font-mono text-sm font-semibold text-primary">
                       {row.reg_no}
                     </TableCell>
                   </motion.tr>
                 ))}
               </TableBody>
             </Table>
           </div>
           
           {data.length > 50 && (
             <div className="px-4 py-2 bg-muted/30 text-xs text-muted-foreground text-center">
               Showing first 50 of {data.length} records
             </div>
           )}
         </motion.div>
       )}
     </motion.div>
   );
 }