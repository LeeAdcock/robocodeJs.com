import React from 'react';
import { useState, useRef } from 'react';
import AceEditor from 'react-ace';
import { Ace } from 'ace-builds';

import languageTools from 'ace-builds/src-noconflict/ext-language_tools';
import 'ace-builds/src-noconflict/mode-javascript';
import 'ace-builds/src-noconflict/theme-github';
import 'ace-builds/src-noconflict/theme-kr_theme';
import 'ace-builds/src-noconflict/snippets/javascript';

import prettier from 'prettier/standalone';
import babel from 'prettier/parser-babel';

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
    _editor: any,
    session: any,
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
  const [editor, setEditor] = useState(null as any);
  const darkMode = useDarkMode();
  const compileTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  const compile = (source: string) => {
    try {
      new Function('x', source);
      if (editor) {
        editor.getSession().setAnnotations([]);
      }
    } catch (error) {
      try {
        prettier.format(source || ' ', {
          plugins: [babel],
        });
      } catch (lintError: any) {
        if (editor) {
          editor.getSession().setAnnotations([
            {
              row: lintError.loc.start.line - 1,
              column: lintError.loc.start.column,
              type: 'error',
              text: lintError.message,
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
      }}
    />
  );
}
