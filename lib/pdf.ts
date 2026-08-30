/**
 * A browser reports a file's type from its extension, so renaming report.docx
 * to report.pdf passes a `file.type` check. Real PDFs always begin with the
 * five bytes "%PDF-", so inspect the content instead of trusting the name.
 */
export const PDF_MAGIC = "%PDF-";

export function isPdfBytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PDF_MAGIC.length) return false;
  return Buffer.from(bytes.subarray(0, PDF_MAGIC.length)).toString("latin1") === PDF_MAGIC;
}
