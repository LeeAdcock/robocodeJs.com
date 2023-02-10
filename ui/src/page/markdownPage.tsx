import showdown from 'showdown'
import { useState, useEffect } from 'react'
import axios from 'axios'
import parse from 'html-react-parser'
import React from 'react'
import { useLocation } from 'react-router-dom'

interface MarkdownPageProps {
    path: string
}

export default function MarkdownPage(props: MarkdownPageProps) {
    const [html, setHtml] = useState('')
    const [md, setMd] = useState('')

    const divRef = React.createRef<HTMLDivElement>()

    const location = useLocation()

    const scrollToSection = () => {
        const header = document.getElementById(location.hash.substring(1))
        const offsetTop =
            (header?.offsetTop || 0) - (header?.offsetHeight || 0) - 77
        if (offsetTop && divRef.current?.parentElement) {
            divRef.current.parentElement.scrollTop = offsetTop
        }
    }

    useEffect(() => {
        return () => {
            window.removeEventListener('hashchange', scrollToSection, false)
        }
    }, [])

    useEffect(() => {
        if (props.path.match(/[a-zA-Z\-_]{1,32}/)) {
            axios
                .get(`/docs/${encodeURIComponent(props.path)}.md`)
                .then((res) => setMd(res.data))
        }
    }, [props.path])

    useEffect(() => {
        setHtml(new showdown.Converter().makeHtml(md))
    }, [md])

    useEffect(() => {
        // force a rescroll
        setTimeout(scrollToSection, 500)
    }, [html, location])

    return (
        <div ref={divRef} id="markdown" className="markdown">
            {parse(html)}
        </div>
    )
}
