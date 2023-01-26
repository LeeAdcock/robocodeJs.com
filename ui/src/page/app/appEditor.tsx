import React from 'react'
import { useState, useEffect } from 'react'
import AceEditor from 'react-ace'
import 'brace/mode/javascript';
import 'brace/theme/xcode';
import 'brace/snippets/javascript';
import 'brace/ext/language_tools';
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
            onLoad={editor => {

                setEditor(editor)

                const bots = {
                    getCompletions: function(editor, session, pos, prefix, callback) {  
                        console.log(session, pos)
                        switch(prefix) {
                            case "b":
                                return callback(null, [
                                    {name: "w", value: "bot", score: 1, meta: ""}
                                ])
                                case "c":
                                    return callback(null, [
                                        {name: "w", value: "clock", score: 1, meta: ""},
                                    ])
                                case "a":
                                    return callback(null, [
                                        {name: "w", value: "arena", score: 1, meta: ""},
                                    ])
                                case "i":
                                    return callback(null, [
                                        {name: "w", value: "isReady()", score: 1, meta: ""}
                                    ])
                                case "g":
                                    return callback(null, [
                                        {name: "w", value: "getHealth()", score: 1, meta: ""},
                                        {name: "w", value: "getId()", score: 1, meta: ""},
                                        {name: "w", value: "getTime()", score: 1, meta: ""},
                                        {name: "w", value: "getWidth()", score: 1, meta: ""},
                                        {name: "w", value: "getHeight()", score: 1, meta: ""},
                                        {name: "w", value: "getSpeed()", score: 1, meta: ""}
                                    ])
                                case "s":
                                    return callback(null, [
                                        {name: "w", value: "setOrientation", score: 1, meta: ""},
                                        {name: "w", value: "setName", score: 1, meta: ""},
                                        {name: "w", value: "setSpeed", score: 1, meta: ""},
                                        {name: "w", value: "scan()", score: 1, meta: ""},
                                        {name: "w", value: "send", score: 1, meta: ""}
                                    ])
                                case "t":
                                    return callback(null, [
                                        {name: "w", value: "turn", score: 1, meta: ""},
                                        {name: "w", value: "turret", score: 1, meta: ""}
                                    ])
                                case "f":
                                    return callback(null, [
                                        {name: "w", value: "fire", score: 1, meta: ""}
                                    ])
                                case "r":
                                    return callback(null, [
                                        {name: "w", value: "radar", score: 1, meta: ""}
                                    ])
                                case "E":
                                    return callback(null, [
                                        {name: "w", value: "Event.RECEIVED", score: 1, meta: ""},
                                        {name: "w", value: "Event.FIRED", score: 1, meta: ""},
                                        {name: "w", value: "Event.SCANNED", score: 1, meta: ""},
                                        {name: "w", value: "Event.COLLIDED", score: 1, meta: ""},
                                        {name: "w", value: "Event.START", score: 1, meta: ""},
                                        {name: "w", value: "Event.TICK", score: 1, meta: ""},
                                        {name: "w", value: "Event.HIT", score: 1, meta: ""},
                                        {name: "w", value: "Event.DETECTED", score: 1, meta: ""}                                      
                                    ])
                                case "o":
                                    return callback(null, [
                                        {name: "w", value: "on", score: 1, meta: ""}
                                    ])
                            }

                        return callback()
                    }
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
