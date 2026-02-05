 import { useState, useCallback } from 'react';
 import { motion, AnimatePresence } from 'framer-motion';
 import { FileSpreadsheet, Rocket, Loader2 } from 'lucide-react';
 import { CSVUploader } from '@/components/csv/CSVUploader';
 import { DataPreview } from '@/components/csv/DataPreview';
 import { Button } from '@/components/ui/button';
 import { PageTransition } from '@/components/layout/PageTransition';
 import { CSVRow, ValidationError } from '@/lib/types';
 
 interface CSVIntakeProps {
   onConfirm: (data: CSVRow[]) => void;
 }
 
 export function CSVIntake({ onConfirm }: CSVIntakeProps) {
   const [data, setData] = useState<CSVRow[]>([]);
   const [errors, setErrors] = useState<ValidationError[]>([]);
   const [isProcessing, setIsProcessing] = useState(false);
 
   const handleDataParsed = useCallback((parsedData: CSVRow[], parseErrors: ValidationError[]) => {
     setData(parsedData);
     setErrors(parseErrors);
   }, []);
 
   const handleConfirm = async () => {
     if (data.length === 0) return;
     setIsProcessing(true);
     await onConfirm(data);
   };
 
   const isReady = data.length > 0 && errors.filter(e => e.field !== 'headers').length === 0;
 
   return (
     <PageTransition className="min-h-screen flex flex-col">
       {/* Header */}
       <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
         <div className="container mx-auto px-6 py-4">
           <div className="flex items-center gap-3">
             <div className="p-2 rounded-xl bg-primary/10">
               <FileSpreadsheet className="w-6 h-6 text-primary" />
             </div>
             <div>
               <h1 className="text-xl font-semibold text-foreground">Voice Dispatch</h1>
               <p className="text-sm text-muted-foreground">Upload driver instructions</p>
             </div>
           </div>
         </div>
       </header>
 
       {/* Main content */}
       <main className="flex-1 container mx-auto px-6 py-12">
         <motion.div
           initial={{ opacity: 0, y: 20 }}
           animate={{ opacity: 1, y: 0 }}
           className="text-center mb-10"
         >
           <h2 className="text-3xl font-bold text-foreground mb-3">
             Upload Your CSV
           </h2>
           <p className="text-muted-foreground max-w-md mx-auto">
             Import driver data to start automated voice dispatch. 
             Your file should contain driver names, phone numbers, and registration numbers.
           </p>
         </motion.div>
 
         <CSVUploader onDataParsed={handleDataParsed} isProcessing={isProcessing} />
 
         <AnimatePresence>
           {(data.length > 0 || errors.length > 0) && (
             <DataPreview data={data} errors={errors} />
           )}
         </AnimatePresence>
 
         {/* Action buttons */}
         <AnimatePresence>
           {isReady && (
             <motion.div
               initial={{ opacity: 0, y: 20 }}
               animate={{ opacity: 1, y: 0 }}
               exit={{ opacity: 0, y: 20 }}
               className="flex justify-center mt-8"
             >
               <Button
                 size="xl"
                 onClick={handleConfirm}
                 disabled={isProcessing}
                 className="gap-2 shadow-lg hover:shadow-xl transition-shadow"
               >
                 {isProcessing ? (
                   <>
                     <Loader2 className="w-5 h-5 animate-spin" />
                     Initializing...
                   </>
                 ) : (
                   <>
                     <Rocket className="w-5 h-5" />
                     Confirm & Initialize ({data.length} calls)
                   </>
                 )}
               </Button>
             </motion.div>
           )}
         </AnimatePresence>
       </main>
     </PageTransition>
   );
 }