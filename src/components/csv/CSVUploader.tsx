 import { useCallback, useState } from 'react';
 import { motion, AnimatePresence } from 'framer-motion';
 import { Upload, FileSpreadsheet, AlertCircle, CheckCircle } from 'lucide-react';
 import { parseCSV } from '@/lib/csv-parser';
 import { CSVRow, ValidationError } from '@/lib/types';
 import { cn } from '@/lib/utils';
 
 interface CSVUploaderProps {
   onDataParsed: (data: CSVRow[], errors: ValidationError[]) => void;
   isProcessing: boolean;
 }
 
 export function CSVUploader({ onDataParsed, isProcessing }: CSVUploaderProps) {
   const [isDragging, setIsDragging] = useState(false);
   const [fileName, setFileName] = useState<string | null>(null);
   const [parseStatus, setParseStatus] = useState<'idle' | 'success' | 'error'>('idle');
 
   const handleFile = useCallback(async (file: File) => {
     if (!file.name.endsWith('.csv')) {
       onDataParsed([], [{ row: 0, field: 'file', message: 'Please upload a CSV file' }]);
       setParseStatus('error');
       return;
     }
 
     setFileName(file.name);
     const content = await file.text();
     const { data, errors } = parseCSV(content);
     
     setParseStatus(errors.length > 0 ? 'error' : 'success');
     onDataParsed(data, errors);
   }, [onDataParsed]);
 
   const handleDragOver = useCallback((e: React.DragEvent) => {
     e.preventDefault();
     setIsDragging(true);
   }, []);
 
   const handleDragLeave = useCallback((e: React.DragEvent) => {
     e.preventDefault();
     setIsDragging(false);
   }, []);
 
   const handleDrop = useCallback((e: React.DragEvent) => {
     e.preventDefault();
     setIsDragging(false);
     const file = e.dataTransfer.files[0];
     if (file) handleFile(file);
   }, [handleFile]);
 
   const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
     const file = e.target.files?.[0];
     if (file) handleFile(file);
   }, [handleFile]);
 
   return (
     <motion.div
       initial={{ opacity: 0, y: 20 }}
       animate={{ opacity: 1, y: 0 }}
       transition={{ duration: 0.4 }}
       className="w-full max-w-2xl mx-auto"
     >
       <label
         onDragOver={handleDragOver}
         onDragLeave={handleDragLeave}
         onDrop={handleDrop}
         className={cn(
           "relative flex flex-col items-center justify-center w-full min-h-[280px] p-8",
           "border-2 border-dashed rounded-2xl cursor-pointer",
           "transition-all duration-300 ease-out",
           isDragging 
             ? "border-primary bg-primary/5 scale-[1.02]" 
             : "border-border hover:border-primary/50 hover:bg-muted/30",
           isProcessing && "pointer-events-none opacity-50"
         )}
       >
         <input
           type="file"
           accept=".csv"
           onChange={handleInputChange}
           className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
           disabled={isProcessing}
         />
         
         <AnimatePresence mode="wait">
           {fileName ? (
             <motion.div
               key="file"
               initial={{ opacity: 0, scale: 0.9 }}
               animate={{ opacity: 1, scale: 1 }}
               exit={{ opacity: 0, scale: 0.9 }}
               className="flex flex-col items-center gap-4"
             >
               <div className={cn(
                 "p-4 rounded-2xl",
                 parseStatus === 'success' ? "bg-success/10" : parseStatus === 'error' ? "bg-destructive/10" : "bg-primary/10"
               )}>
                 {parseStatus === 'success' ? (
                   <CheckCircle className="w-12 h-12 text-success" />
                 ) : parseStatus === 'error' ? (
                   <AlertCircle className="w-12 h-12 text-destructive" />
                 ) : (
                   <FileSpreadsheet className="w-12 h-12 text-primary" />
                 )}
               </div>
               <div className="text-center">
                 <p className="font-medium text-foreground">{fileName}</p>
                 <p className="text-sm text-muted-foreground mt-1">
                   {parseStatus === 'success' 
                     ? 'File parsed successfully' 
                     : parseStatus === 'error' 
                       ? 'Validation errors found' 
                       : 'Processing...'}
                 </p>
               </div>
             </motion.div>
           ) : (
             <motion.div
               key="upload"
               initial={{ opacity: 0, scale: 0.9 }}
               animate={{ opacity: 1, scale: 1 }}
               exit={{ opacity: 0, scale: 0.9 }}
               className="flex flex-col items-center gap-4"
             >
               <motion.div
                 className="p-4 rounded-2xl bg-primary/10"
                 animate={{ y: isDragging ? -5 : 0 }}
                 transition={{ type: "spring", stiffness: 400 }}
               >
                 <Upload className="w-12 h-12 text-primary" />
               </motion.div>
               <div className="text-center">
                 <p className="font-medium text-foreground">
                   Drag & drop your CSV file here
                 </p>
                 <p className="text-sm text-muted-foreground mt-1">
                   or click to browse
                 </p>
               </div>
               <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
                 <span className="px-2 py-1 bg-muted rounded-md font-mono">driver_name</span>
                 <span className="px-2 py-1 bg-muted rounded-md font-mono">phone_number</span>
                 <span className="px-2 py-1 bg-muted rounded-md font-mono">reg_no</span>
               </div>
             </motion.div>
           )}
         </AnimatePresence>
       </label>
     </motion.div>
   );
 }