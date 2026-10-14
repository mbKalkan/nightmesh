/** A blob: URL for embedded bytes: the only kind of URL the webview may fetch (D-008). */
export function blobUrl(contents: string | Uint8Array, type: string): string {
  return URL.createObjectURL(new Blob([contents as BlobPart], { type }));
}
