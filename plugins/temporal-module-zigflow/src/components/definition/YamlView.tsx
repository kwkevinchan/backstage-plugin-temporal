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

import { useEffect, useRef } from 'react';
import { yaml } from '@codemirror/lang-yaml';
import { syntaxHighlighting } from '@codemirror/language';
import {
  Compartment,
  EditorState,
  RangeSetBuilder,
  Text,
} from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  lineNumbers,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view';
import { classHighlighter } from '@lezer/highlight';
import { tp } from '../styles';

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
 * Gives every rendered line its number as `data-line`, so a click (and the
 * tests) can find the line. CodeMirror renders only the lines near the
 * visible part, so this follows the viewport.
 */
const lineNumberAttributes = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = numberLines(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = numberLines(update.view);
      }
    }
  },
  { decorations: plugin => plugin.decorations },
);

function numberLines(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = view.state;
  const last = doc.lineAt(view.viewport.to).number;
  for (let n = doc.lineAt(view.viewport.from).number; n <= last; n++) {
    builder.add(
      doc.line(n).from,
      doc.line(n).from,
      Decoration.line({ attributes: { 'data-line': String(n) } }),
    );
  }
  return builder.finish();
}

interface Marks {
  highlight?: LineRange;
  cursorLine?: number;
  errorLine?: number;
}

/**
 * Line decorations for the selected task (a band with a bar on the left),
 * the cursor and a parse error. They are part of the lines, so they always
 * line up with the text.
 */
function markLines(doc: Text, marks: Marks): DecorationSet {
  const lines = new Map<
    number,
    { classes: string[]; attributes: Record<string, string> }
  >();
  const at = (n: number) => {
    let entry = lines.get(n);
    if (!entry) {
      entry = { classes: [], attributes: {} };
      lines.set(n, entry);
    }
    return entry;
  };
  const inDoc = (n: number | undefined): n is number =>
    n !== undefined && n >= 1 && n <= doc.lines;
  const { highlight, cursorLine, errorLine } = marks;
  if (highlight && inDoc(highlight.startLine)) {
    const end = Math.min(
      Math.max(highlight.endLine, highlight.startLine),
      doc.lines,
    );
    for (let n = highlight.startLine; n <= end; n++) {
      at(n).classes.push(tp('tp-yaml-band'));
    }
    Object.assign(at(highlight.startLine).attributes, {
      'data-testid': 'definition-yaml-band',
      'data-start': String(highlight.startLine),
      'data-end': String(highlight.endLine),
    });
  }
  if (inDoc(errorLine)) at(errorLine).classes.push(tp('tp-yaml-error'));
  if (inDoc(cursorLine)) at(cursorLine).classes.push(tp('tp-yaml-cursor'));

  const builder = new RangeSetBuilder<Decoration>();
  for (const n of [...lines.keys()].sort((a, b) => a - b)) {
    const { classes, attributes } = lines.get(n)!;
    builder.add(
      doc.line(n).from,
      doc.line(n).from,
      Decoration.line({ class: classes.join(' '), attributes }),
    );
  }
  return builder.finish();
}

/**
 * Read-only YAML in CodeMirror, with line numbers and syntax colors. The
 * lines of the selected task are marked; pressing a line (or the arrow keys)
 * moves the cursor to it.
 */
export function YamlView(props: YamlViewProps) {
  const { content, highlight, cursorLine, onLineSelect, errorLine, scrollKey } =
    props;
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>();
  const marks = useRef(new Compartment());
  // The editor's handlers read the latest props.
  const latest = useRef({ onLineSelect, cursorLine });
  latest.current = { onLineSelect, cursorLine };

  // The editor lives as long as the component; the content replaces the
  // document.
  useEffect(() => {
    if (!host.current) return undefined;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: content,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          // CodeMirror marks its content as a read-only, multiline textbox.
          EditorView.contentAttributes.of({
            'aria-label': 'Workflow definition',
          }),
          // CodeMirror's content is the focusable, read-only textbox; it
          // takes the clicks on lines and the arrow keys.
          EditorView.contentAttributes.of({ tabindex: '0' }),
          EditorView.domEventHandlers({
            click(event) {
              const line = (event.target as HTMLElement)
                .closest('[data-line]')
                ?.getAttribute('data-line');
              if (line) latest.current.onLineSelect(Number(line));
            },
            keydown(event, cm) {
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
                return false;
              }
              event.preventDefault();
              const from = latest.current.cursorLine ?? 0;
              const last = cm.state.doc.lines;
              const next =
                event.key === 'ArrowDown'
                  ? Math.min(last, from + 1)
                  : Math.max(1, from - 1);
              latest.current.onLineSelect(next);
              cm.dispatch({
                effects: EditorView.scrollIntoView(
                  cm.state.doc.line(next).from,
                  { y: 'nearest' },
                ),
              });
              return true;
            },
          }),
          // The line numbers are outside the lines: the gutter gives the line.
          lineNumbers({
            domEventHandlers: {
              click(cm, block) {
                latest.current.onLineSelect(
                  cm.state.doc.lineAt(block.from).number,
                );
                return true;
              },
            },
          }),
          yaml(),
          syntaxHighlighting(classHighlighter),
          lineNumberAttributes,
          marks.current.of([]),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = undefined;
    };
    // Created once; the effects below follow the props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new content replaces the document; the marks are computed for the
  // document they will be on, in the same transaction.
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const changed = editor.state.doc.toString() !== content;
    const doc = changed ? editor.state.toText(content) : editor.state.doc;
    editor.dispatch({
      ...(changed && {
        changes: { from: 0, to: editor.state.doc.length, insert: content },
      }),
      effects: marks.current.reconfigure(
        EditorView.decorations.of(
          markLines(doc, { highlight, cursorLine, errorLine }),
        ),
      ),
    });
  }, [content, highlight, cursorLine, errorLine]);

  // Scroll the selected task into view when the selection comes from the
  // graph (a new scroll key), unless its first line is already visible.
  useEffect(() => {
    const editor = view.current;
    if (!editor || !highlight || scrollKey === undefined) return;
    if (
      highlight.startLine < 1 ||
      highlight.startLine > editor.state.doc.lines
    ) {
      return;
    }
    const pos = editor.state.doc.line(highlight.startLine).from;
    const block = editor.lineBlockAt(pos);
    const scroller = editor.scrollDOM;
    const top = block.top + editor.documentPadding.top;
    if (
      top >= scroller.scrollTop &&
      top + 24 <= scroller.scrollTop + scroller.clientHeight
    ) {
      return;
    }
    editor.dispatch({
      effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 32 }),
    });
    // Only a new scroll key scrolls; the marks follow the props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey]);

  return (
    <div ref={host} className={tp('tp-yaml')} data-testid="definition-yaml" />
  );
}
