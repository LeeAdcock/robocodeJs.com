// A read-only variant of the bot code editor (../app/appEditor), used by the
// sample viewer (samplePage) to show example bot source inside the styled app.
// It deliberately drops everything write-oriented — onChange, the debounced
// linter, autocompletion/snippets, and the save/reboot/clean/check key
// commands — keeping only font-size zoom. The Ace setup (mode, themes,
// useWorker:false) mirrors appEditor so the look matches the editable editor.
import AceEditorImport from 'react-ace';
const AceEditor =
  (AceEditorImport as unknown as { default?: typeof AceEditorImport })
    .default ?? AceEditorImport;

import 'ace-builds/src-noconflict/mode-javascript';
import 'ace-builds/src-noconflict/theme-github';
import 'ace-builds/src-noconflict/theme-kr_theme';

import { useDarkMode } from '../../util/theme';

interface SampleEditorProps {
  code: string;
  fontSize: number;
  doZoomIn: () => void;
  doZoomOut: () => void;
  doZoomReset: () => void;
}

export default function SampleEditor(props: SampleEditorProps) {
  const darkMode = useDarkMode();
  return (
    <AceEditor
      mode="javascript"
      theme={darkMode ? 'kr_theme' : 'github'}
      readOnly={true}
      commands={[
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
      fontSize={props.fontSize}
      showGutter={true}
      highlightActiveLine={false}
      value={props.code}
      height="calc(100% - 51px)"
      width="100%"
      setOptions={{
        showLineNumbers: true,
        tabSize: 2,
        printMargin: false,
        // The cursor/highlight are pointless in a read-only view.
        highlightGutterLine: false,
        // See appEditor: Ace's syntax worker resolves a same-origin URL that
        // doesn't exist under our Vite build, so disable it.
        useWorker: false,
      }}
    />
  );
}
