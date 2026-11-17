import React from 'react';

interface ChatMarkdownProps {
  content: string;
  variant?: 'ai' | 'user';
}

function renderInlineFormatting(
  text: string,
  variant: 'ai' | 'user'
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const tokenRegex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(
        <strong
          key={`b-${keyIdx++}`}
          className={
            variant === 'ai'
              ? 'font-semibold text-white'
              : 'font-semibold text-white'
          }
        >
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push(
        <em key={`i-${keyIdx++}`} className="italic text-zinc-100">
          {token.slice(1, -1)}
        </em>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code
          key={`c-${keyIdx++}`}
          className="px-1.5 py-0.5 rounded bg-black/40 font-mono text-[11px] text-zinc-100"
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
}) => {
  const blocks = parseMarkdownBlocks(content);

  if (blocks.length === 0) {
    return <span>{content}</span>;
  }

  return (
    <div className="space-y-2.5 text-[13px] leading-relaxed">
      {blocks.map((block, idx) => {
        if (block.type === 'heading') {
          return (
            <p
              key={idx}
              className="font-display font-semibold text-white text-[13px] pt-0.5"
            >
              {renderInlineFormatting(block.text, variant)}
            </p>
          );
        }

        if (block.type === 'ul') {
          return (
            <ul key={idx} className="space-y-1.5 pl-1">
              {block.items.map((item, itemIdx) => (
                <li key={itemIdx} className="flex items-start gap-2">
                  <span
                    aria-hidden="true"
                    className={`mt-2 w-1.5 h-1.5 rounded-full shrink-0 ${
                      variant === 'ai' ? 'bg-red-500' : 'bg-white/75'
                    }`}
                  />
                  <span className="flex-1 text-zinc-200">
                    {renderInlineFormatting(item, variant)}
                  </span>
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === 'ol') {
          return (
            <ol key={idx} className="space-y-1.5 pl-1">
              {block.items.map((item, itemIdx) => (
                <li key={itemIdx} className="flex items-start gap-2">
                  <span className="font-mono text-[11px] font-semibold text-red-400 mt-0.5 shrink-0 tabular-nums">
                    {itemIdx + 1}.
                  </span>
                  <span className="flex-1 text-zinc-200">
                    {renderInlineFormatting(item, variant)}
                  </span>
                </li>
              ))}
            </ol>
          );
        }

        return (
          <p
            key={idx}
            className={variant === 'ai' ? 'text-zinc-200' : 'text-zinc-100'}
          >
            {block.lines.map((line, lineIdx) => (
              <React.Fragment key={lineIdx}>
                {lineIdx > 0 && <br />}
                {renderInlineFormatting(line, variant)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
};
