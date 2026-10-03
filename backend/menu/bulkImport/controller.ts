import type { AuthenticatedUser } from '../../auth/policies';
import type { Request } from 'express';
import { MAX_BULK_UPLOAD_BYTES } from './parser';
import { confirmBulkImport, previewBulkImport } from './service';

export interface UploadedWorkbook { filename: string; buffer: Buffer }

function contentDispositionValue(header: string, key: string): string | undefined {
  const encoded = header.match(new RegExp(`${key}\\*=UTF-8''([^;]+)`, 'i'))?.[1];
  if (encoded) return decodeURIComponent(encoded);
  return header.match(new RegExp(`${key}="([^"]*)"`, 'i'))?.[1];
}

/** Read one bounded multipart file without trusting its client MIME type. */
export async function readWorkbookUpload(req: Request): Promise<UploadedWorkbook> {
  const contentType = String((req as any).headers?.['content-type'] ?? '');
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.slice(1).find(Boolean)?.trim();
  if (!contentType.toLowerCase().startsWith('multipart/form-data') || !boundary || boundary.length > 200) {
    throw Object.assign(new Error('multipart/form-data with a file field is required.'), { statusCode: 400 });
  }
  const chunks: Buffer[] = []; let size = 0;
  for await (const value of req as any) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.length;
    if (size > MAX_BULK_UPLOAD_BYTES + 64 * 1024) throw Object.assign(new Error('Excel file must be 5 MB or smaller.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  const marker = Buffer.from(`--${boundary}`);
  let cursor = body.indexOf(marker); let upload: UploadedWorkbook | undefined;
  while (cursor >= 0) {
    const headersStart = cursor + marker.length + 2;
    const headersEnd = body.indexOf(Buffer.from('\r\n\r\n'), headersStart);
    if (headersEnd < 0) break;
    const next = body.indexOf(marker, headersEnd + 4);
    if (next < 0) break;
    const headers = body.subarray(headersStart, headersEnd).toString('utf8');
    const disposition = headers.split('\r\n').find((line) => line.toLowerCase().startsWith('content-disposition:')) ?? '';
    if (contentDispositionValue(disposition, 'name') === 'file') {
      const filename = contentDispositionValue(disposition, 'filename')?.split(/[\\/]/).pop()?.trim() ?? '';
      if (!filename.toLowerCase().endsWith('.xlsx')) throw Object.assign(new Error('Only .xlsx files are accepted.'), { statusCode: 400 });
      if (upload) throw Object.assign(new Error('Upload exactly one Excel file.'), { statusCode: 400 });
      const end = next - 2;
      upload = { filename, buffer: body.subarray(headersEnd + 4, end) };
    }
    cursor = next;
  }
  if (!upload?.filename || !upload.buffer.length) throw Object.assign(new Error("Multipart field 'file' must contain an .xlsx workbook."), { statusCode: 400 });
  if (upload.buffer.length > MAX_BULK_UPLOAD_BYTES) throw Object.assign(new Error('Excel file must be 5 MB or smaller.'), { statusCode: 413 });
  return upload;
}

export const BulkMenuImportApi = {
  preview: (user: AuthenticatedUser, filename: string, file: Buffer) => previewBulkImport(user, filename, file),
  confirm: (user: AuthenticatedUser, token: string) => confirmBulkImport(user, token),
};
