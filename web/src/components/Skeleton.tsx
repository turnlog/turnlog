/** Shimmer placeholders — used wherever content is on its way. */

export function Skel({
  w,
  h = 12,
  r = 6,
  className,
}: {
  /** Width: number (px) or CSS size. */
  w?: number | string;
  h?: number;
  r?: number;
  className?: string;
}) {
  return (
    <span
      className={`skel ${className ?? ''}`}
      style={{ width: w ?? '100%', height: h, borderRadius: r }}
      aria-hidden
    />
  );
}

const LINE_WIDTHS = ['92%', '78%', '85%', '64%', '88%', '71%'];

export function SkeletonLines({ n = 4 }: { n?: number }) {
  return (
    <div className="skel-lines" role="status" aria-label="Loading">
      {Array.from({ length: n }, (_, i) => (
        <Skel key={i} w={LINE_WIDTHS[i % LINE_WIDTHS.length]} />
      ))}
    </div>
  );
}

/** List placeholder: tile + two text bars, like session/recent rows. */
export function SkeletonRows({ n = 5, tile = 36 }: { n?: number; tile?: number }) {
  return (
    <div className="skel-rows" role="status" aria-label="Loading">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="skel-row">
          <Skel w={tile} h={tile} r={12} />
          <div className="skel-row-main">
            <Skel w={i % 2 === 0 ? '52%' : '40%'} h={13} />
            <Skel w={i % 2 === 0 ? '74%' : '82%'} h={10} />
          </div>
        </div>
      ))}
    </div>
  );
}
