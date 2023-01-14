import React from 'react'
import AceEditor from 'react-ace'

import 'ace-builds/src-noconflict/mode-javascript'
import 'ace-builds/src-noconflict/theme-github'
import 'ace-builds/src-noconflict/theme-kr_theme'

import prettier from 'prettier/standalone'
import babel from 'prettier/parser-babel'

let debounceCompileTimer
function debounce(func, timeout) {
  clearTimeout(debounceCompileTimer)
  debounceCompileTimer = setTimeout(func, timeout)
}

export default class CodeEditor extends React.Component<
  {
    darkMode: boolean
    code: string
    onChange: Function
    onSave: Function
  },
  {
    editor: any
  }
> {
  constructor(props: any) {
    super(props)
    this.state = {
      editor: null,
    }
    this.compile = this.compile.bind(this)
  }

  shouldComponentUpdate(nextProps, nextState) {
    return nextProps.code !== this.props.code
  }

  compile(source) {
    try {
      new Function('x', source)
      this.state.editor.getSession().setAnnotations([])
    } catch (error) {
      try {
        prettier.format(source || ' ', {
          plugins: [babel],
        })
      } catch (lintError) {
        this.state.editor.getSession().setAnnotations([
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

  render() {
    const onSave = this.props.onSave

    return (
      <>
        <AceEditor
          onLoad={editor => this.setState({ editor })}
          mode="javascript"
          theme={this.props.darkMode ? 'kr_theme' : 'github'}
          commands={[
            {
              name: 'save',
              bindKey: { win: 'Ctrl-S', mac: 'Cmd-S' },
              exec: () => onSave(),
            },
          ]}
          onChange={source => {
            debounce(() => this.compile(source), 5000)
            this.props.onChange(source)
          }}
          fontSize={12}
          showGutter={true}
          highlightActiveLine={true}
          value={this.props.code}
          height="100%"
          width="100%"
          setOptions={{
            enableBasicAutocompletion: true,
            enableLiveAutocompletion: false,
            enableSnippets: false,
            showLineNumbers: true,
            tabSize: 2,
            printMargin: false,
          }}
        />
      </>
    )
  }
}
