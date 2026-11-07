import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CodeBlock from '../code/CodeBlock';
import { MediaThumb, MediaViewer, type MediaItem } from '../components/Media';

/**
 * An image in agent prose. Remote URLs are never loaded — a log is untrusted
 * input, and an <img> pointing off the machine is a request (and a beacon).
 * A local path goes through the media route; anything else is its alt text.
 */
function MdImage({
  src,
  alt,
  resolveMedia,
}: {
  src: string;
  alt: string;
  resolveMedia?: (ref: string) => string | null;
}) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  if (/^[a-z][a-z\d+.-]*:/i.test(src) || src.startsWith('//')) {
    let host = src;
    try {
      host = new URL(src, 'http://x').host || src;
    } catch {
      /* unparseable — show it whole */
    }
    return (
      <a className="md-remote-img" href={src} target="_blank" rel="noreferrer noopener">
        {alt || 'image'} · not loaded from {host}
      </a>
    );
  }
  const url = src !== '' ? resolveMedia?.(src) : null;
  if (!url || failed) return <span className="md-img-alt">{alt || src}</span>;
  const item: MediaItem = { src: url, kind: 'image', name: src, explicit: false };
  return (
    <>
      <MediaThumb item={item} onOpen={() => setOpen(true)} onFail={() => setFailed(true)} />
      {open && <MediaViewer items={[item]} start={0} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Assistant prose. react-markdown renders to React elements and never
 * injects raw HTML — session logs are untrusted input (a hostile repo can
 * steer what the agent writes), and this origin holds the API token.
 */
const Markdown = memo(function Markdown({
  text,
  resolveMedia,
}: {
  text: string;
  /** A local media path → its guarded URL; absent where nothing may load. */
  resolveMedia?: (ref: string) => string | null;
}) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, node, ...props }) {
            const langMatch = /language-(\w+)/.exec(className ?? '');
            const value = String(children).replace(/\n$/, '');
            const isBlock = node?.position
              ? value.includes('\n') || langMatch !== null
              : false;
            if (isBlock || langMatch) {
              return <CodeBlock code={value} langHint={langMatch?.[1]} />;
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          pre({ children }) {
            // CodeBlock brings its own <pre>; avoid double-wrapping.
            return <>{children}</>;
          },
          img({ src, alt }) {
            return (
              <MdImage
                src={typeof src === 'string' ? src : ''}
                alt={alt ?? ''}
                resolveMedia={resolveMedia}
              />
            );
          },
          a({ children, href }) {
            return (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

export default Markdown;
