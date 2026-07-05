import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CodeBlock from '../code/CodeBlock';

/**
 * Assistant prose. react-markdown renders to React elements and never
 * injects raw HTML — session logs are untrusted input (a hostile repo can
 * steer what the agent writes), and this origin holds the API token.
 */
const Markdown = memo(function Markdown({ text }: { text: string }) {
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
