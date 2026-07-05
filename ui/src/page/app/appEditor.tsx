import React from 'react';
import { useState, useRef, useEffect } from 'react';
// react-ace is a CommonJS package; under Vite's dependency pre-bundling its
// default import arrives wrapped as the module namespace object
// ({ default, split, diff }) rather than the component itself, which makes React
// throw "Element type is invalid ... got: object". Unwrap the real component
// (the `?? ` keeps it working if a build hands back the component directly).
import AceEditorImport from 'react-ace';
const AceEditor =
  (AceEditorImport as unknown as { default?: typeof AceEditorImport })
    .default ?? AceEditorImport;
import { Ace } from 'ace-builds';

import languageTools from 'ace-builds/src-noconflict/ext-language_tools';
import 'ace-builds/src-noconflict/mode-javascript';
import 'ace-builds/src-noconflict/theme-github';
import 'ace-builds/src-noconflict/theme-kr_theme';
import 'ace-builds/src-noconflict/snippets/javascript';

import * as prettier from 'prettier/standalone';
import babel from 'prettier/plugins/babel';
import estree from 'prettier/plugins/estree';

import { completionsFor } from '../../util/botApi';
import { useDarkMode } from '../../util/theme';

// Editor font-size bounds and default, shared with the toolbar zoom controls so
// the two can't disagree.
export const EDITOR_FONT_MIN = 8;
export const EDITOR_FONT_MAX = 30;
export const EDITOR_FONT_DEFAULT = 12;

interface CodeEditorProps {
  code: string;
  onChange: (source: string) => void;
  // A server-reported crash location to mark in the gutter and scroll to.
  faultAnnotation?: { line: number; message: string } | null;
  doClean: () => void;
  doExecute: () => void;
  doReboot: () => void;
  fontSize: number;
  doZoomIn: () => void;
  doZoomOut: () => void;
  doZoomReset: () => void;
}

// Context-aware completer for the bot API (bot/arena/clock/Event …). It reads
// the line up to the cursor so it can offer the right members after `obj.`
// (with signatures + hover docs), driven by the shared model in botApi.ts.
const botApiCompleter = {
  getCompletions(
    _editor: Ace.Editor,
    session: Ace.EditSession,
    pos: { row: number; column: number },
    _prefix: string,
    callback: (error: null, completions: unknown[]) => void
  ) {
    const line = session.getLine(pos.row).slice(0, pos.column);
    callback(null, completionsFor(line));
  },
};

// Register once for the whole app — addCompleter is global, and the editor can
// mount more than once (so doing this in onLoad would stack duplicates).
let completerRegistered = false;

export default function CodeEditor(props: CodeEditorProps) {
  const [editor, setEditor] = useState<Ace.Editor | null>(null);
  const darkMode = useDarkMode();
  const compileTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  // Mark a server-reported crash line in the gutter (same shape as the local
  // syntax-error annotation) and scroll to it. Editing clears the fault upstream,
  // after which the local compile() below governs annotations again.
  useEffect(() => {
    if (!editor || !props.faultAnnotation) return;
    const { line, message } = props.faultAnnotation;
    editor
      .getSession()
      .setAnnotations([
        { row: line - 1, column: 0, type: 'error' as const, text: message },
      ]);
    editor.gotoLine(line, 0, true);
  }, [editor, props.faultAnnotation]);

  const compile = async (source: string) => {
    try {
      new Function('x', source);
      if (editor) {
        editor.getSession().setAnnotations([]);
      }
    } catch {
      try {
        // Prettier 3's format() is async, so await it to surface the parse error
        // (with its precise loc) for the editor's error annotation below.
        await prettier.format(source || ' ', {
          parser: 'babel',
          plugins: [babel, estree],
        });
      } catch (lintError) {
        const err = lintError as {
          loc: { start: { line: number; column: number } };
          message: string;
        };
        if (editor) {
          editor.getSession().setAnnotations([
            {
              row: err.loc.start.line - 1,
              column: err.loc.start.column,
              type: 'error' as const,
              text: err.message,
            },
          ]);
        }
      }
    }
  };

  return (
    <AceEditor
      mode="javascript"
      theme={darkMode ? 'kr_theme' : 'github'}
      commands={[
        {
          name: 'save',
          bindKey: { win: 'Ctrl-S', mac: 'Cmd-S' },
          exec: () => props.doExecute(),
        },
        {
          // Shift-save: save and reboot (re-run START) in one keystroke.
          name: 'saveAndReboot',
          bindKey: { win: 'Ctrl-Shift-S', mac: 'Cmd-Shift-S' },
          exec: () => props.doReboot(),
        },
        {
          name: 'clean',
          bindKey: { win: 'Ctrl-R', mac: 'Cmd-R' },
          exec: () => props.doClean(),
        },
        {
          name: 'zoomIn',
          // Both '=' and '+' so it works with and without Shift.
          bindKey: { win: 'Ctrl-=|Ctrl-+', mac: 'Cmd-=|Cmd-+' },
          exec: () => props.doZoomIn(),
        },
        {
          name: 'zoomOut',
          bindKey: { win: 'Ctrl--', mac: 'Cmd--' },
          exec: () => props.doZoomOut(),
        },
        {
          name: 'zoomReset',
          bindKey: { win: 'Ctrl-0', mac: 'Cmd-0' },
          exec: () => props.doZoomReset(),
        },
      ]}
      onChange={(source) => {
        clearTimeout(compileTimer.current);
        compileTimer.current = setTimeout(() => compile(source), 5000);
        props.onChange(source);
      }}
      onLoad={(editor) => {
        setEditor(editor);
        if (!completerRegistered) {
          languageTools.addCompleter(botApiCompleter as Ace.Completer);
          completerRegistered = true;
        }
      }}
      fontSize={props.fontSize}
      showGutter={true}
      highlightActiveLine={true}
      value={props.code}
      height="calc(100% - 51px)"
      width="100%"
      setOptions={{
        enableBasicAutocompletion: true,
        enableLiveAutocompletion: true,
        enableSnippets: true,
        showLineNumbers: true,
        tabSize: 2,
        printMargin: false,
        // Ace loads its syntax-check worker via a same-origin URL resolved
        // against the current route (…/app/worker-javascript.js), which doesn't
        // exist under our Vite build/tunnel and throws an importScripts
        // NetworkError. We don't rely on the worker's inline linting, so disable
        // it; editing and highlighting are unaffected.
        useWorker: false,
      }}
    />
  );
}
