/*
 * Copyright 2026 The backstage-plugin-temporal Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/// <reference types="react-syntax-highlighter" />
import {
  KeyboardEvent,
  memo,
  MouseEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/light';
import yamlLanguage from 'react-syntax-highlighter/dist/esm/languages/hljs/yaml';
import { tp } from '../styles';

// Only the YAML grammar of highlight.js is loaded.
SyntaxHighlighter.registerLanguage('yaml', yamlLanguage);

/** Lines of a range, from 1. */
export interface LineRange {
  startLine: number;
  endLine: number;
}

export interface YamlViewProps {
  content: string;
  /** The lines of the selected task. */
  highlight?: LineRange;
  /** The line of the cursor. */
  cursorLine?: number;
  /** Changes when the view should scroll to `highlight` again. */
  scrollKey?: unknown;
  /** A line pressed, or moved to with the arrow keys. */
  onLineSelect(line: number): void;
  /** The line of a parse error. */
  errorLine?: number;
}

/**
 * The highlighted text. Only the content changes it, so moving the
 * selection does not highlight the file again.
 */
const Code = memo(function CodeView(props: { content: string }) {
  return (
    <SyntaxHighlighter
      language="yaml"
      useInlineStyles={false}
      showLineNumbers
      wrapLines
      lineProps={(line: number) => ({
        'data-line': line,
        className: tp('tp-yaml-line'),
      })}
      PreTag="div"
      className={tp('tp-yaml-code')}
    >
      {props.content}
    </SyntaxHighlighter>
  );
});

function lineElement(root: HTMLElement | null, line: number) {
  return root?.querySelector<HTMLElement>(`[data-line="${line}"]`) ?? null;
}

/** Top and height of the lines `range` in the code. */
function bandOf(root: HTMLElement | null, range: LineRange | undefined) {
  if (!range) return undefined;
  const first = lineElement(root, range.startLine);
  const last = lineElement(root, range.endLine) ?? first;
  if (!first || !last) return undefined;
  return {
    top: first.offsetTop,
    height: last.offsetTop + last.offsetHeight - first.offsetTop,
  };
}

/**
 * Read-only YAML with line numbers and syntax colors. The lines of the
 * selected task are marked; pressing a line (or the arrow keys) moves the
 * cursor to it.
 */
export function YamlView(props: YamlViewProps) {
  const { content, highlight, cursorLine, onLineSelect, errorLine } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const code = useRef<HTMLDivElement>(null);
  const [band, setBand] = useState<{ top: number; height: number }>();
  const [cursor, setCursor] = useState<{ top: number; height: number }>();
  const [error, setError] = useState<{ top: number; height: number }>();
  const lineCount = content.split('\n').length;

  useLayoutEffect(() => {
    setBand(bandOf(code.current, highlight));
    setCursor(
      cursorLine
        ? bandOf(code.current, { startLine: cursorLine, endLine: cursorLine })
        : undefined,
    );
    setError(
      errorLine
        ? bandOf(code.current, { startLine: errorLine, endLine: errorLine })
        : undefined,
    );
  }, [content, highlight, cursorLine, errorLine]);

  // Scroll the selected task into view when the selection comes from the
  // graph (a new scroll key).
  const { scrollKey } = props;
  useLayoutEffect(() => {
    const box = scroller.current;
    const target = bandOf(code.current, highlight);
    if (!box || !target || scrollKey === undefined) return;
    const visibleTop = box.scrollTop;
    const visibleBottom = visibleTop + box.clientHeight;
    if (target.top >= visibleTop && target.top + 24 <= visibleBottom) return;
    box.scrollTo?.({ top: Math.max(0, target.top - 32), behavior: 'smooth' });
    // jsdom has no scrollTo.
    if (!box.scrollTo) box.scrollTop = Math.max(0, target.top - 32);
    // Only a new scroll key scrolls; the band follows the content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey]);

  const onClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const line = (event.target as HTMLElement)
        .closest('[data-line]')
        ?.getAttribute('data-line');
      if (line) onLineSelect(Number(line));
    },
    [onLineSelect],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const from = cursorLine ?? 0;
    const next =
      event.key === 'ArrowDown'
        ? Math.min(lineCount, from + 1)
        : Math.max(1, from - 1);
    onLineSelect(next);
    const element = lineElement(code.current, next);
    element?.scrollIntoView?.({ block: 'nearest' });
  };

  return (
    <div
      ref={scroller}
      className={tp('tp-yaml')}
      role="textbox"
      aria-readonly="true"
      aria-multiline="true"
      aria-label="Workflow definition"
      tabIndex={0}
      data-testid="definition-yaml"
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <div ref={code} className={tp('tp-yaml-inner')}>
        {band && (
          <div
            className={tp('tp-yaml-band')}
            style={{ top: band.top, height: band.height }}
            data-testid="definition-yaml-band"
            data-start={highlight?.startLine}
            data-end={highlight?.endLine}
            aria-hidden
          />
        )}
        {error && (
          <div
            className={tp('tp-yaml-error')}
            style={{ top: error.top, height: error.height }}
            aria-hidden
          />
        )}
        {cursor && (
          <div
            className={tp('tp-yaml-cursor')}
            style={{ top: cursor.top, height: cursor.height }}
            aria-hidden
          />
        )}
        <Code content={content} />
      </div>
    </div>
  );
}
