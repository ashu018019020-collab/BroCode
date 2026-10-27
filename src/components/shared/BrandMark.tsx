/**
 * The BroCode brand mark.
 *
 * The official artwork already ships in `public/brocode.png` (used by the app shell and the error
 * boundary). This component exists so a page does not re-spell the path: one asset, one alt text,
 * one size prop, and no generated replacement. `size` is applied to BOTH dimensions with
 * `object-fit: contain`, so the artwork's own aspect ratio is preserved rather than stretched.
 */
export function BrandMark({
  size = 28,
  className,
  alt = 'BroCode',
}: {
  size?: number;
  className?: string;
  alt?: string;
}) {
  return (
    <img
      src="./brocode.png"
      alt={alt}
      width={size}
      height={size}
      className={className ? `brand-mark ${className}` : 'brand-mark'}
      style={{ width: size, height: size, objectFit: 'contain', flex: '0 0 auto' }}
      loading="lazy"
      decoding="async"
    />
  );
}
