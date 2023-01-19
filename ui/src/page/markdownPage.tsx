import showdown from 'showdown'
import { useState, useEffect } from 'react'
import axios from 'axios'
import parse from 'html-react-parser'

interface MarkdownPageProps {
    path: string
}

export default function MarkdownPage(props: MarkdownPageProps) {
    const [html, setHtml] = useState('')
    const [md, setMd] = useState('')

    useEffect(() => {
        // todo validate path
        axios.get(props.path).then((res) => setMd(res.data))
    }, [])

    useEffect(() => {
        setHtml(new showdown.Converter().makeHtml(md))
    }, [md])

    return (
        <div
            style={{
                height: 'calc(100% - 77px)',
                overflow: 'scroll',
                margin: '10px',
            }}
        >
            {parse(html)}
        </div>
    )
}
