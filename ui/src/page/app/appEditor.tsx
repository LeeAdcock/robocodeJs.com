import React from 'react'
import { useState, useEffect } from 'react'
import AceEditor from 'react-ace'
import 'brace/mode/javascript'
import 'brace/theme/xcode'
import 'brace/snippets/javascript'
import 'brace/ext/language_tools'
import brace from 'brace'

import languageTools from 'ace-builds/src-noconflict/ext-language_tools'
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
            onLoad={(editor) => {
                setEditor(editor)

                const bots = {
                    getCompletions: function (
                        editor,
                        session,
                        pos,
                        prefix,
                        callback
                    ) {
                        return callback(null, ["bot","Event", "on", "Event.DETECTED", "DETECTED", "Event.HIT", "HIT", "Event.START", "START", "Event.COLLIDED", "COLLIDED", "Event.RECEIVED","RECEIVED","Event.FIRED","FIRED","Event.SCANNED","SCANNED","clock","arena", "turn()", "fire()", "radar", "turret()", "isReady()", "getHealthy()", "getTime()", "getWidth()", "getHeight()", "getSpeed()", "setOrientation()", "scan()", "send()", "setName()", "setSpeed()",].filter(code => code.startsWith(prefix)).map(code => ({
                            name: code,
                            value: code,
                            score: 1,
                            meta: '',
                        })))
                    },
                }
                languageTools.addCompleter(bots)
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
