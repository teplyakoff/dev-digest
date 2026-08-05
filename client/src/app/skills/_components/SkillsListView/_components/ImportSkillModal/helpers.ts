/** Pure helpers for ImportSkillModal. */

/**
 * Read a File as bare base64 (no `data:` prefix).
 *
 * FileReader rather than `arrayBuffer()` + manual encoding: building base64 from
 * a Uint8Array by hand blows the call stack on a 1 MB archive
 * (`String.fromCharCode(...bytes)`), and chunking it is code nobody should have
 * to review.
 */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

/** Human-readable byte count for the origin block. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
