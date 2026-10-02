import apiClient from '../services/api';

const saveBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const filenameFrom = (disposition: string | undefined, fallback: string): string => {
  const match = /filename="?([^";]+)"?/i.exec(disposition || '');
  return match ? match[1] : fallback;
};

// API files need the JWT header, so fetch them as blobs instead of linking directly.
export const downloadFile = async (
  path: string,
  params: Record<string, string | number | undefined>,
  fallbackName: string
): Promise<void> => {
  const res = await apiClient.get(path, { params, responseType: 'blob' });
  saveBlob(res.data as Blob, filenameFrom(res.headers['content-disposition'], fallbackName));
};

export const downloadInvoicePdf = (invoiceId: string, invoiceNumber: string): Promise<void> =>
  downloadFile(
    `/invoices/${invoiceId}/pdf`,
    { download: 1 },
    `${invoiceNumber.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`
  );
