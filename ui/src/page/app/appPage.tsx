import Editor from './appEditor'
import axios from 'axios'
import { useParams } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Toolbar from './appEditorToolbar'
import prettier from 'prettier/standalone'
import babel from 'prettier/parser-babel'
import Container from 'react-bootstrap/Container'
import Row from 'react-bootstrap/Row'
import Col from 'react-bootstrap/Col'
import { colors } from '../../util/colors'
import { useNavigate } from 'react-router-dom'

let debounceSaveTimer
const debounce = (func: () => void, timeout: number) => {
    clearTimeout(debounceSaveTimer)
    debounceSaveTimer = setTimeout(func, timeout)
}

const titleCase = (str: string) =>
    str
        .toLowerCase()
        .split(' ')
        .map(function (word) {
            return word.charAt(0).toUpperCase() + word.slice(1)
        })
        .join(' ')

export default function AppPage(props) {
    const [code, setCode] = useState('')
    const [app, setApp] = useState(null as any)
    const { userId, appId } = useParams()

    const navigate = useNavigate()

    const listener = (event) => {
        setApp((app) => {
            if (event.appId === appId && app) {
                app.name = event.name
                return { ...app, name: event.name }
            }
            return app
        })
    }
    useEffect(() => {
        props.emitter.addListener('appRenamed', listener)
    })
    useEffect(() => {
        props.emitter.removeListener('appRenamed', listener)
    }, [])

    useEffect(() => {
        axios
            .get(`/api/user/${userId}/app/${appId}/source`)
            .then((res) => setCode(res.data))
        axios
            .get(`/api/user/${userId}/app/${appId}`)
            .then((res) => setApp(res.data))
    }, [userId, appId])

    useEffect(() => {
        debounce(
            () =>
                axios.put(`/api/user/${userId}/app/${appId}/source`, code, {
                    headers: { 'content-type': 'application/octet-stream' },
                }),
            30000
        )
    }, [code])

    const doExecute = () => {
        axios
            .put(`/api/user/${userId}/app/${appId}/source`, code, {
                headers: { 'content-type': 'application/octet-stream' },
            })
            .then(() => axios.post(`/api/user/${userId}/app/${appId}/compile`))
            .then((resp) => setApp({ ...app, name: resp.data.name }))
    }

    const doDelete = () => {
        axios
            .delete(`/api/user/${userId}/app/${appId}`)
            .then(props.doDelete)
            .then(() => navigate(`/user/${userId}`))
    }

    const doClean = () => {
        try {
            const prettyCode = prettier.format(code || ' ', {
                semi: false,
                trailingComma: 'none',
                plugins: [babel],
            })
            setCode(prettyCode)
        } catch (error) {
            // do nothing
        }
    }

    return (
        <>
            <Container
                fluid
                style={{ marginTop: '10px', marginBottom: '10px' }}
            >
                <Row>
                    <Col
                        style={{
                            verticalAlign: 'middle',
                            lineHeight: '31px',
                            paddingLeft: '0',
                        }}
                    >
                        {app && props.arena && (
                            <>
                                {props.arena.apps
                                    .map((a) => a.id)
                                    .includes(app.id) && (
                                    <img
                                        src={
                                            '/sprites/tank_' +
                                            colors[
                                                props.arena.apps.findIndex(
                                                    (otherApp) =>
                                                        otherApp.id === app.id
                                                )
                                            ] +
                                            '.png'
                                        }
                                        style={{
                                            height: '1em',
                                            marginRight: '5px',
                                        }}
                                    />
                                )}
                                {titleCase(app?.name)}
                            </>
                        )}
                    </Col>
                    <Col style={{ paddingRight: '0' }}>
                        <Toolbar
                            appName={app?.name}
                            code={code}
                            doDelete={doDelete}
                            doExecute={doExecute}
                            doClean={doClean}
                        />
                    </Col>
                </Row>
            </Container>
            <Editor
                code={code}
                onChange={setCode}
                doExecute={doExecute}
                doClean={doClean}
            />
        </>
    )
}
