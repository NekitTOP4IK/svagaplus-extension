const resolveHref = (target: string, frontendUrl: string): string | null => {
  if (target.startsWith('/') && !target.startsWith('//')) {
    return frontendUrl.replace(/\/+$/, '') + target;
  }
  if (!target.startsWith('https://')) return null;
  try {
    return new URL(target).protocol === 'https:' ? target : null;
  } catch {
    return null;
  }
};

const isTight = (content: string): boolean =>
  content.length > 0 && !/^\s|\s$|\n/.test(content);

const findLinkEnd = (text: string, open: number): number => {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\n') return -1;
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
};

export const renderMarkdown = (text: string, frontendUrl: string): DocumentFragment => {
  const fragment = document.createDocumentFragment();
  let literal = '';

  const flush = (): void => {
    if (!literal) return;
    fragment.appendChild(document.createTextNode(literal));
    literal = '';
  };

  const emit = (node: Node): void => {
    flush();
    fragment.appendChild(node);
  };

  const emphasis = (tag: 'b' | 'i', content: string): void => {
    const element = document.createElement(tag);
    element.textContent = content;
    emit(element);
  };

  let index = 0;
  while (index < text.length) {
    const char = text[index];

    if (char === '\n') {
      emit(document.createElement('br'));
      index += 1;
      continue;
    }

    if (text.startsWith('**', index)) {
      const close = text.indexOf('**', index + 2);
      const content = close === -1 ? '' : text.slice(index + 2, close);
      if (isTight(content)) {
        emphasis('b', content);
        index = close + 2;
      } else {
        literal += '**';
        index += 2;
      }
      continue;
    }

    if (char === '*') {
      const close = text.indexOf('*', index + 1);
      const content = close === -1 ? '' : text.slice(index + 1, close);
      if (isTight(content)) {
        emphasis('i', content);
        index = close + 1;
      } else {
        literal += '*';
        index += 1;
      }
      continue;
    }

    if (char === '[') {
      const labelEnd = text.indexOf(']', index + 1);
      const label = labelEnd === -1 ? '' : text.slice(index + 1, labelEnd);
      if (label && !label.includes('\n') && text[labelEnd + 1] === '(') {
        const targetEnd = findLinkEnd(text, labelEnd + 1);
        if (targetEnd !== -1) {
          const href = resolveHref(text.slice(labelEnd + 2, targetEnd).trim(), frontendUrl);
          if (href) {
            const anchor = document.createElement('a');
            anchor.setAttribute('href', href);
            anchor.setAttribute('target', '_blank');
            anchor.setAttribute('rel', 'noopener noreferrer');
            anchor.textContent = label;
            emit(anchor);
          } else {
            literal += text.slice(index, targetEnd + 1);
          }
          index = targetEnd + 1;
          continue;
        }
      }
    }

    literal += char;
    index += 1;
  }

  flush();
  return fragment;
};
