export function dtrActionMenuPosition(
  anchor: { top: number; bottom: number; left: number; right: number },
  viewport: { width: number; height: number },
  contentHeight: number,
) {
  const margin = 8, gap = 6
  const below = Math.max(0, viewport.height - anchor.bottom - gap - margin)
  const above = Math.max(0, anchor.top - gap - margin)
  const opensUp = contentHeight > below && above > below
  const width = Math.min(217, Math.max(0, viewport.width - margin * 2))
  const left = Math.max(margin, Math.min(anchor.right - width, viewport.width - margin - width))
  return { opensUp, width, left: left - anchor.left, maxHeight: opensUp ? above : below }
}
