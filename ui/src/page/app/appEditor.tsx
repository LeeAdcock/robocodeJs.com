import React from 'react'
import { useState, useEffect } from 'react'
import AceEditor from 'react-ace'

import 'ace-builds/src-noconflict/mode-javascript'
import 'ace-builds/src-noconflict/theme-github'
import 'ace-builds/src-noconflict/theme-kr_theme'

import prettier from 'prettier/standalone'
import babel from 'prettier/parser-babel'

let debounceCompileTimer
const debounce = (func, timeout) => {
    clearTimeout(debounceCompileTimer)
    debounceCompileTimer = setTimeout(func, timeout)
}

interface CodeEditorProps {
    code: string
    onChange: (source) => void
    doClean: () => void
    doExecute: () => void
}

export default function CodeEditor(props: CodeEditorProps) {
    const [editor, setEditor] = useState(null as any)

    const compile = (source) => {
        try {
            new Function('x', source)
            if (editor) {
                editor.getSession().setAnnotations([])
            }
        } catch (error) {
            try {
                prettier.format(source || ' ', {
                    plugins: [babel],
                })
            } catch (lintError: any) {
                if (editor) {
                    editor.getSession().setAnnotations([
                        {
                            row: lintError.loc.start.line - 1,
                            column: lintError.loc.start.column,
                            type: 'error',
                            text: lintError.message,
                        },
                    ])
                }
            }
        }
    }

    return (
        <AceEditor
            onLoad={(e) => setEditor(e)}
            mode="javascript"
            theme={'github'}
            commands={[
                {
                    name: 'save',
                    bindKey: { win: 'Ctrl-S', mac: 'Cmd-S' },
                    exec: () => props.doExecute(),
                },
                {
                    name: 'clean',
                    bindKey: { win: 'Ctrl-R', mac: 'Cmd-R' },
                    exec: () => props.doClean(),
                },
            ]}
            onChange={(source) => {
                debounce(() => compile(source), 5000)
                props.onChange(source)
            }}
            fontSize={12}
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
    )
}
