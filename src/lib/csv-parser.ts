import readXlsxFile from 'read-excel-file';
import { CSVRow, ValidationError } from './types';

const REQUIRED_COLUMNS = ['driver_name', 'phone_number', 'reg_no'];

export async function parseXLSX(buffer: ArrayBuffer): Promise<{ data: CSVRow[]; errors: ValidationError[] }> {
  const errors: ValidationError[] = [];
  const data: CSVRow[] = [];

  try {
    const file = new File([buffer], 'upload.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const rows = await readXlsxFile(file);

    if (rows.length < 2) {
      errors.push({ row: 0, field: 'file', message: 'XLSX must have headers and at least one data row' });
      return { data, errors };
    }

    // Convert to CSV string and delegate to parseCSV
    const csvContent = rows.map(row => row.map(cell => {
      const val = cell != null ? String(cell) : '';
      return val.includes(',') || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;
    }).join(',')).join('\n');

    return parseCSV(csvContent);
  } catch (e) {
    errors.push({ row: 0, field: 'file', message: `Failed to parse XLSX: ${e instanceof Error ? e.message : 'Unknown error'}` });
    return { data, errors };
  }
}

export function parseCSV(content: string): { data: CSVRow[]; errors: ValidationError[] } {
   const lines = content.trim().split('\n');
   const errors: ValidationError[] = [];
   const data: CSVRow[] = [];
 
   if (lines.length < 2) {
     errors.push({ row: 0, field: 'file', message: 'CSV must have headers and at least one data row' });
     return { data, errors };
   }
 
   // Parse headers
   const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
   
   // Validate required columns
   const missingColumns = REQUIRED_COLUMNS.filter(col => !headers.includes(col));
   if (missingColumns.length > 0) {
     errors.push({ 
       row: 0, 
       field: 'headers', 
       message: `Missing required columns: ${missingColumns.join(', ')}` 
     });
     return { data, errors };
   }
 
  // Get column indices
  const columnIndices = {
    driver_name: headers.indexOf('driver_name'),
    phone_number: headers.indexOf('phone_number'),
    reg_no: headers.indexOf('reg_no'),
    message: headers.indexOf('message'),
  };

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);
    const row: CSVRow = {
      driver_name: values[columnIndices.driver_name]?.trim() || '',
      phone_number: values[columnIndices.phone_number]?.trim() || '',
      reg_no: values[columnIndices.reg_no]?.trim() || '',
      message: columnIndices.message >= 0 ? values[columnIndices.message]?.trim() || undefined : undefined,
    };
 
     // Validate row
     if (!row.driver_name) {
       errors.push({ row: i + 1, field: 'driver_name', message: 'Driver name is required' });
     }
     if (!row.phone_number) {
       errors.push({ row: i + 1, field: 'phone_number', message: 'Phone number is required' });
     } else if (!isValidPhoneNumber(row.phone_number)) {
       errors.push({ row: i + 1, field: 'phone_number', message: 'Invalid phone number format' });
     }
     if (!row.reg_no) {
       errors.push({ row: i + 1, field: 'reg_no', message: 'Registration number is required' });
     }
 
     // Only add valid rows
     if (row.driver_name && row.phone_number && row.reg_no) {
       data.push(row);
     }
   }
 
   return { data, errors };
 }
 
 function parseCSVLine(line: string): string[] {
   const result: string[] = [];
   let current = '';
   let inQuotes = false;
 
   for (let i = 0; i < line.length; i++) {
     const char = line[i];
     
     if (char === '"') {
       inQuotes = !inQuotes;
     } else if (char === ',' && !inQuotes) {
       result.push(current.replace(/^["']|["']$/g, ''));
       current = '';
     } else {
       current += char;
     }
   }
   result.push(current.replace(/^["']|["']$/g, ''));
   
   return result;
 }
 
 function isValidPhoneNumber(phone: string): boolean {
   // Allow various formats: +1234567890, (123) 456-7890, 123-456-7890, etc.
   const cleaned = phone.replace(/[\s\-\(\)\.]/g, '');
   return /^\+?\d{10,15}$/.test(cleaned);
 }
 
 export function formatPhoneNumber(phone: string): string {
   // Format to E.164 format
   let cleaned = phone.replace(/[\s\-\(\)\.]/g, '');
   if (!cleaned.startsWith('+')) {
     // Assume US number if no country code
     if (cleaned.length === 10) {
       cleaned = '+1' + cleaned;
     } else {
       cleaned = '+' + cleaned;
     }
   }
   return cleaned;
 }