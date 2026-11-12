// Conversioni geometriche pure (senza DOM), usate dal visualizzatore e dalle aree.

/**
 * Rettangolo PDF [x1,y1,x2,y2] → {left,top,width,height} nel viewport.
 * pdf.js 6 non ha più PageViewport.convertToViewportRectangle: si convertono i due angoli
 * con convertToViewportPoint e si normalizza (con rotazione gli angoli si scambiano).
 */
export function rectToCss(vp, [ax, ay, bx, by]) {
  const [x1, y1] = vp.convertToViewportPoint(ax, ay);
  const [x2, y2] = vp.convertToViewportPoint(bx, by);
  return { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}
