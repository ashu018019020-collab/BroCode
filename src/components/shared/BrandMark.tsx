/**
 * The BroCode brand mark — the ONE component every surface draws its logo with.
 *
 * The artwork is generated, not hand-exported: `npm run brand:write` renders
 * `public/brand/brocode-mark.svg` and every PNG size from a single geometry, so the tab icon, the
 * sidebar tile, the install icon and the recovery badge are the same mark. This component only
 * decides which file to ask for and keeps the aspect ratio intact.
 *
 * The SVG master is preferred because it stays sharp at any size; a browser or proxy that refuses
 * `image/svg+xml` falls back to the 192 px PNG, which is why `onError` swaps the source instead of
 * leaving a broken-image glyph in the sidebar.
 */
import { useState } from 'react';

const MARK_SVG = './brand/brocode-mark.svg';
const MARK_PNG = './brand/icon-192.png';

export function BrandMark({
  size = 28,
  className,
  alt = 'BroCode',
}: {
  size?: number;
  className?: string;
  alt?: string;
}) {
  const [src, setSrc] = useState(MARK_SVG);
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={className ? `brand-mark ${className}` : 'brand-mark'}
      style={{ width: size, height: size, objectFit: 'contain', flex: '0 0 auto' }}
      decoding="async"
      onError={() => setSrc((current) => (current === MARK_PNG ? current : MARK_PNG))}
    />
  );
}
