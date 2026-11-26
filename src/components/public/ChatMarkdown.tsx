import React from 'react';

interface ChatMarkdownProps {
  content: string;
  variant?: 'ai' | 'user';
  theme?: 'dark' | 'whatsapp';
  onNavigateInternal?: (path: string) => void;
}

function isSafeLinkHref(rawHref: string): boolean {
  const href = rawHref.trim();
  if (!href) return false;
  if (href.startsWith('/veiculo/') || href.startsWith('/chat') || href === '/') {
    return true;
  }
  try {
    const parsed = new URL(href);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function renderInlineFormatting(
  text: string,
  variant: 'ai' | 'user',
  theme: 'dark' | 'whatsapp',
  onNavigateInternal?: (path: string) => void
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const tokenRegex =
    /(\[[^\]]+\]\((?:https?:\/\/[^\s)]+|\/veiculo\/[a-zA-Z0-9_-]+)\)|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|https?:\/\/[^\s<>()]+|\/veiculo\/[a-zA-Z0-9_-]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  const isWa = theme === 'whatsapp';

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith('[') && token.includes('](') && token.endsWith(')')) {
      const mdMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const label = mdMatch?.[1] || token;
      const href = mdMatch?.[2] || '';
      if (isSafeLinkHref(href)) {
        const isInternal = href.startsWith('/');
        nodes.push(
          <a
            key={`a-${keyIdx++}`}
            href={href}
            target={isInternal ? undefined : '_blank'}
            rel={isInternal ? undefined : 'noopener noreferrer'}
            onClick={(e) => {
              if (isInternal && onNavigateInternal) {
                e.preventDefault();
                onNavigateInternal(href);
              }
            }}
            className={
              isWa
                ? 'underline font-semibold text-[#006B58] hover:text-[#004D3F] break-all'
                : 'underline font-semibold text-red-400 hover:text-red-300 break-all'
            }
          >
            {label}
          </a>
        );
      } else {
        nodes.push(label);
      }
    } else if (token.startsWith('http://') || token.startsWith('https://') || token.startsWith('/veiculo/')) {
      const cleanHref = token.replace(/[.,;:!?]+$/, '');
      const trailing = token.slice(cleanHref.length);
      const isInternal = cleanHref.startsWith('/');
      if (isSafeLinkHref(cleanHref)) {
        nodes.push(
          <React.Fragment key={`u-${keyIdx++}`}>
            <a
              href={cleanHref}
              target={isInternal ? undefined : '_blank'}
              rel={isInternal ? undefined : 'noopener noreferrer'}
              onClick={(e) => {
                if (isInternal && onNavigateInternal) {
                  e.preventDefault();
                  onNavigateInternal(cleanHref);
                }
              }}
              className={
                isWa
                  ? 'underline font-semibold text-[#006B58] hover:text-[#004D3F] break-all'
                  : 'underline font-semibold text-red-400 hover:text-red-300 break-all'
              }
            >
              {cleanHref}
            </a>
            {trailing}
          </React.Fragment>
        );
      } else {
        nodes.push(token);
      }
    } else if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(
        <strong
          key={`b-${keyIdx++}`}
          className={
            isWa
              ? 'font-semibold text-[#111B21]'
              : variant === 'ai'
                ? 'font-semibold text-white'
                : 'font-semibold text-white'
          }
        >
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push(
        <em
          key={`i-${keyIdx++}`}
          className={isWa ? 'italic text-[#111B21]' : 'italic text-zinc-100'}
        >
          {token.slice(1, -1)}
        </em>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code
          key={`c-${keyIdx++}`}
          className={
            isWa
              ? 'px-1.5 py-0.5 rounded bg-black/[0.06] font-mono text-[12px] text-[#111B21]'
              : 'px-1.5 py-0.5 rounded bg-black/40 font-mono text-[11px] text-zinc-100'
          }
        >
          {token.slice(1, -1)}
        </code>
      );
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

type ParsedBlock =
  | { type: 'heading'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'paragraph'; lines: string[] };

function parseMarkdownBlocks(raw: string): ParsedBlock[] {
  const normalized = raw.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const lines = normalized.split('\n');
  const blocks: ParsedBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!line) {
      i++;
      continue;
    }

    // Heading (#, ##, ###)
    const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch) {
      blocks.push({ type: 'heading', text: headingMatch[1].trim() });
      i++;
      continue;
    }

    // Unordered list (- or *)
    if (/^[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const cur = lines[i].trim();
        const itemMatch = cur.match(/^[-*•]\s+(.+)$/);
        if (!itemMatch) break;
        items.push(itemMatch[1].trim());
        i++;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    // Ordered list (1., 2., etc.)
    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const cur = lines[i].trim();
        const itemMatch = cur.match(/^\d+[.)]\s+(.+)$/);
        if (!itemMatch) break;
        items.push(itemMatch[1].trim());
        i++;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    // Regular paragraph until blank line, heading, or list item
    const paragraphLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i].trim();
      if (
        !cur ||
        /^#{1,3}\s+/.test(cur) ||
        /^[-*•]\s+/.test(cur) ||
        /^\d+[.)]\s+/.test(cur)
      ) {
        break;
      }
      paragraphLines.push(cur);
      i++;
    }
    if (paragraphLines.length > 0) {
      blocks.push({ type: 'paragraph', lines: paragraphLines });
    }
  }

  return blocks;
}

export const ChatMarkdown: React.FC<ChatMarkdownProps> = ({
  content,
  variant = 'ai',
  theme = 'dark',
  onNavigateInternal,
}) => {
  const blocks = parseMarkdownBlocks(content);
  const isWa = theme === 'whatsapp';

  if (blocks.length === 0) {
    return <span>{content}</span>;
  }

  return (
    <div
      className={
        isWa
          ? 'space-y-2 text-[14px] leading-[1.45] text-[#111B21]'
          : 'space-y-2.5 text-[13px] leading-relaxed'
      }
    >
      {blocks.map((block, idx) => {
        if (block.type === 'heading') {
          return (
            <p
              key={idx}
              className={
                isWa
                  ? 'font-semibold text-[#111B21] text-[14px] pt-0.5'
                  : 'font-display font-semibold text-white text-[13px] pt-0.5'
              }
            >
              {renderInlineFormatting(block.text, variant, theme, onNavigateInternal)}
            </p>
          );
        }

        if (block.type === 'ul') {
          return (
            <ul key={idx} className="space-y-1 pl-0.5">
              {block.items.map((item, itemIdx) => (
                <li key={itemIdx} className="flex items-start gap-2">
                  <span
                    aria-hidden="true"
                    className={`mt-2 w-1.5 h-1.5 rounded-full shrink-0 ${
                      isWa
                        ? 'bg-[#008069]'
                        : variant === 'ai'
                          ? 'bg-red-500'
                          : 'bg-white/75'
                    }`}
                  />
                  <span
                    className={
                      isWa ? 'flex-1 text-[#111B21]' : 'flex-1 text-zinc-200'
                    }
                  >
                    {renderInlineFormatting(item, variant, theme, onNavigateInternal)}
                  </span>
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === 'ol') {
          return (
            <ol key={idx} className="space-y-1 pl-0.5">
              {block.items.map((item, itemIdx) => (
                <li key={itemIdx} className="flex items-start gap-2">
                  <span
                    className={`font-mono text-[12px] font-semibold mt-0.5 shrink-0 tabular-nums ${
                      isWa ? 'text-[#008069]' : 'text-red-400'
                    }`}
                  >
                    {itemIdx + 1}.
                  </span>
                  <span
                    className={
                      isWa ? 'flex-1 text-[#111B21]' : 'flex-1 text-zinc-200'
                    }
                  >
                    {renderInlineFormatting(item, variant, theme, onNavigateInternal)}
                  </span>
                </li>
              ))}
            </ol>
          );
        }

        return (
          <p
            key={idx}
            className={
              isWa
                ? 'text-[#111B21]'
                : variant === 'ai'
                  ? 'text-zinc-200'
                  : 'text-zinc-100'
            }
          >
            {block.lines.map((line, lineIdx) => (
              <React.Fragment key={lineIdx}>
                {lineIdx > 0 && <br />}
                {renderInlineFormatting(line, variant, theme, onNavigateInternal)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
};
