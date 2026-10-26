import { escapeHtml } from './htmlUtils.js';

const INLINE_TOKEN = '\u0001TCMD';

function safeMarkdownHref(value) {
  const href = String(value ?? '').trim();
  if (/^(?:https?:\/\/|mailto:|#\/|\/(?!\/))/i.test(href)) return href;
  return '';
}

function renderInlineMarkdown(value) {
  const tokens = [];
  const stash = html => {
    const token = `${INLINE_TOKEN}${tokens.length}\u0002`;
    tokens.push(html);
    return token;
  };

  let text = String(value ?? '');
  text = text.replace(/`([^`\n]+)`/g, (_, code) => stash(`<code>${escapeHtml(code)}</code>`));
  text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, label, rawHref) => {
    const href = safeMarkdownHref(rawHref);
    if (!href) return label;
    const external = /^(?:https?:\/\/|mailto:)/i.test(href);
    return stash(`<a href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${escapeHtml(label)}</a>`);
  });
  text = escapeHtml(text)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');

  return text.replace(new RegExp(`${INLINE_TOKEN}(\\d+)\\u0002`, 'g'), (_, index) => tokens[Number(index)] || '');
}

function isBlockStart(line) {
  return /^\s*(?:```|#{1,4}\s+|>\s?|[-+*]\s+|\d+[.)]\s+|(?:[-*_]\s*){3,})/.test(line);
}

/**
 * Рендерит ограниченное подмножество Markdown без поддержки сырого HTML.
 * Любой пользовательский текст сначала экранируется, а ссылки проходят allow-list схем.
 */
export function renderTaskCardMarkdown(value) {
  const source = String(value ?? '').replace(/\r\n?/g, '\n').trim();
  if (!source) return '<p>—</p>';

  const lines = source.split('\n');
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^\s*```\s*([\w-]*)\s*$/);
    if (fence) {
      const code = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const language = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : '';
      blocks.push(`<pre><code${language}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^\s*(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1].length + 2, 6);
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2].trim())}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push(`<blockquote><p>${quote.map(renderInlineMarkdown).join('<br>')}</p></blockquote>`);
      continue;
    }

    const list = line.match(/^\s*([-+*]|\d+[.)])\s+(.+)$/);
    if (list) {
      const ordered = /^\d/.test(list[1]);
      const tag = ordered ? 'ol' : 'ul';
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*([-+*]|\d+[.)])\s+(.+)$/);
        if (!item || /^\d/.test(item[1]) !== ordered) break;
        items.push(`<li>${renderInlineMarkdown(item[2].trim())}</li>`);
        index += 1;
      }
      blocks.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) {
      blocks.push('<hr>');
      index += 1;
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim() && (paragraph.length === 0 || !isBlockStart(lines[index]))) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(`<p>${paragraph.map(renderInlineMarkdown).join('<br>')}</p>`);
  }

  return blocks.join('');
}
