import { PDFDocument, PDFName, PDFNumber, PDFNull, PDFString } from 'pdf-lib';

export interface TocEntry {
  label: string;
  page: number; // 1-based
}

export function parseToc(toc: string): TocEntry[] {
  return toc
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(line => {
      const [label, pageStr] = line.split('|').map(s => s.trim());
      const page = parseInt(pageStr ?? '1', 10);
      return { label: label ?? line, page: isNaN(page) ? 1 : page };
    });
}

/**
 * Loads the PDF from R2, injects a bookmark outline from the TOC entries,
 * and writes the patched PDF back to R2 under the same key.
 * No-ops silently on non-PDF or missing files.
 */
export async function injectPdfBookmarks(
  r2: R2Bucket,
  r2Key: string,
  entries: TocEntry[],
): Promise<void> {
  if (!entries.length) return;

  const obj = await r2.get(r2Key);
  if (!obj) return;

  const bytes = await obj.arrayBuffer();
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch {
    return; // not a valid PDF — skip silently
  }

  const ctx = pdf.context;
  const pageCount = pdf.getPageCount();

  // Reserve a ref for the outline root so items can point to their Parent
  const outlinesRef = ctx.nextRef();
  const itemRefs = entries.map(() => ctx.nextRef());

  // Build each outline item
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const pageIdx = Math.min(Math.max(entry.page - 1, 0), pageCount - 1);
    const page = pdf.getPage(pageIdx);
    const { height } = page.getSize();

    // Destination: jump to top of the target page at its natural zoom
    const dest = ctx.obj([
      page.ref,
      PDFName.of('XYZ'),
      PDFNull,
      PDFNumber.of(height),
      PDFNull,
    ]);

    const item = ctx.obj({
      Title: PDFString.of(entry.label),
      Parent: outlinesRef,
      Dest: dest,
      ...(i > 0 ? { Prev: itemRefs[i - 1] } : {}),
      ...(i < entries.length - 1 ? { Next: itemRefs[i + 1] } : {}),
    });

    ctx.assign(itemRefs[i], item);
  }

  // Build the outline root dict
  ctx.assign(
    outlinesRef,
    ctx.obj({
      Type: PDFName.of('Outlines'),
      First: itemRefs[0],
      Last: itemRefs[itemRefs.length - 1],
      Count: PDFNumber.of(entries.length),
    }),
  );

  // Remove old Outlines entry if present, then point catalog at the new one
  pdf.catalog.delete(PDFName.of('Outlines'));
  pdf.catalog.set(PDFName.of('Outlines'), outlinesRef);

  const patched = await pdf.save();
  await r2.put(r2Key, patched, {
    httpMetadata: { contentType: 'application/pdf' },
  });
}
