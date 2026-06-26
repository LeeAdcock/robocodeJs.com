import './App.css'
import ArenaSvg from './components/arena/arena'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom'
import TankApp from './types/tankApp'
import Arena from './types/arena'
// Lazy-loaded so the heavy editor chunk (ace-builds + prettier) isn't part of
// the initial arena/home bundle.
const AppPage = lazy(() => import('./page/app/appPage'))
import NavBar from './components/navbar'
import MarkdownPage from './page/markdownPage'
import User from './types/user'
import ArenaToolbar from './components/arena/arenaToolbar'
import 'bootstrap/dist/css/bootstrap.min.css'
import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'
import PointInTime from './types/pointInTime'
import applyArenaEvent from './util/arenaReducer'
const ArenaLogPage = lazy(() => import('./page/arena/arenaLogsPage'))
import { Emitter } from './util/emitter'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const google: any

interface NavProps {
    user: User
    arena: Arena
    isPaused: boolean
    doCreateApp: () => void
}
const Nav = (props: NavProps) => {
    const navigate = useNavigate()

    return (
        <NavBar
            apps={props.user?.apps}
            arena={props.arena}
            user={props.user}
            isPaused={props.isPaused}
            doPause={() => axios.post(`/api/user/${props.user.id}/arena/pause`)}
            doResume={() =>
                axios.post(`/api/user/${props.user.id}/arena/resume`)
            }
            doRestart={() =>
                axios.post(`/api/user/${props.user.id}/arena/restart`)
            }
            doSave={() => {
                /* todo */
            }}
            doCreateApp={() => {
                axios.post(`/api/user/${props.user.id}/app`).then((res) => {
                    const appId = res.data.appId
                    // automatically add to arena? if so need to refresh arena afterward
                    axios
                        .put(`/api/user/${props.user.id}/arena/app/${appId}`)
                        .then(() =>
                            axios.post(
                                `/api/user/${props.user.id}/arena/restart`
                            )
                        )
                    navigate(`/user/${props.user.id}/app/${appId}`)
                    props.doCreateApp()
                })
            }}
        />
    )
}

const emitter = new Emitter()

function App() {
    const [user, setUser] = useState(null as unknown as User)
    const [arena, setArena] = useState({
        clock: { time: 0 },
        apps: [] as TankApp[],
    } as Arena)
    const [time, setTime] = useState(0)
    const [isPaused, setPaused] = useState(true)
    const eventSource = useRef<EventSource | undefined>(undefined)

    // Reset the experience if the user session expires
    useEffect(() => {
        const interval = setInterval(() => {
            axios
                .get(`/api/user`)
                .catch(() => {
                    setUser(null as unknown as User)
                    /*setArena({
                        clock: { time: 0 },
                        apps: [] as TankApp[],
                    } as Arena)
                    setPaused(true)*/
                })
                .catch(() => google.accounts.id.prompt())
        }, 30000)
        return () => clearInterval(interval)
    }, [])

    const doReloadArena = () => {
        console.log('reloading arena')
        return new Promise((resolve) => {
            axios
                .get(user ? `/api/user/${user.id}/arena` : `/api/demo/arena`)
                .then((res) => {
                    setTime(res.data.clock.time)
                    res.data.apps.forEach((app: any) =>
                        app.tanks.forEach((tank: any) => {
                            tank.path = Array<PointInTime>(20)
                            tank.path[0] = {
                                x: tank.x,
                                y: tank.y,
                                time,
                            }
                            tank.pathIndex = 1
                        })
                    )
                    setArena(res.data)
                    setPaused(!res.data.running)
                    resolve(res.data)
                })
        })
    }

    useEffect(() => {
        google.accounts.id.initialize({
            client_id:
                '926984742216-a5uuqefrrrvnn5pa87e357kld6rv2bsc.apps.googleusercontent.com',
            callback: (response: { credential: string }) => {
                // The server verifies the credential and sets an HttpOnly
                // session cookie (so it isn't readable by client-side JS).
                axios
                    .post(`/api/session`, {
                        credential: response.credential,
                    })
                    .then(() => axios.get(`/api/user`))
                    .then((res) =>
                        axios
                            .get(`/api/user/${res.data.id}`)
                            .then((res) => setUser(res.data))
                            .then(() => google.accounts.id.cancel())
                    )
            },
        })
        google.accounts.id.renderButton(
            document.getElementById('GoogleLoginButton'),
            { theme: 'outline', size: 'medium' } // customization attributes
        )

        // On window open, try to authenticate
        window.onload = function () {
            axios
                .get(`/api/user`)
                .then((res) => {
                    // already authenticated
                    axios
                        .get(`/api/user/${res.data.id}`)
                        .then((res) => setUser(res.data))
                })
                .catch()
        }

        // pause on lost focus
        const pause = () => {
            if (user) axios.post(`/api/user/${user.id}/arena/pause`)
        }
        window.addEventListener('blur', pause)
        return () => {
            window.removeEventListener('blur', pause)
        }
    }, [])

    useEffect(() => {
        doReloadArena()
    }, [user])

    useEffect(() => {
        if (eventSource.current) {
            eventSource.current.close()
            eventSource.current = undefined
        }
        // todo externalize the server
        const source = new EventSource(
            user
                ? `${window.location.protocol}//${window.location.host}/api/user/${user.id}/arena/events`
                : `${window.location.protocol}//${window.location.host}/api/demo/events`
        )
        eventSource.current = source

        source.onmessage = (message) => {
            const data = JSON.parse(message.data)
            emitter.emit(data.type, data)

            // React-state side effects (not part of the arena object)
            if (data.type === 'tick') {
                setTime(data.time)
            } else if (data.type === 'arenaPaused') {
                setPaused(true)
            } else if (data.type === 'arenaResumed') {
                setPaused(false)
            } else if (data.type === 'appRenamed') {
                if (user) {
                    axios
                        .get(`/api/user/${user.id}`)
                        .then((res) => setUser(res.data))
                }
            } else if (data.type === 'arenaRestart') {
                setPaused((isPaused) => {
                    if (isPaused) doReloadArena()
                    else setArena((arena) => ({ ...arena, apps: [] }))
                    return isPaused
                })
                return
            }

            setArena((arena) => applyArenaEvent(arena, data, time))
        }

        return () => {
            source.close()
            eventSource.current = undefined
        }
    }, [user])

    return (
        <>
            <div
                style={{
                    position: 'absolute',
                    height: '100%',
                    width: '50%',
                    top: 0,
                    left: 0,
                    padding: '10px 5px 10px 10px',
                }}
            >
                <Router>
                    <Nav
                        user={user}
                        arena={arena}
                        isPaused={isPaused}
                        doCreateApp={() => {
                            // todo
                            axios
                                .get(`/api/user/${user.id}`)
                                .then((res) => setUser(res.data))
                        }}
                    />

                    <div
                        style={{
                            height: 'calc(100% - 77px)',
                            overflow: 'scroll',
                            margin: '10px',
                        }}
                    >
                        <Suspense fallback={null}>
                        <Routes>
                            <Route
                                path="/"
                                element={<MarkdownPage path="index" />}
                            />
                            <Route
                                path="/privacy"
                                element={<MarkdownPage path="privacy" />}
                            />
                            <Route
                                path="/examples"
                                element={<MarkdownPage path="examples" />}
                            />
                            <Route
                                path="/dev"
                                element={<MarkdownPage path="dev" />}
                            />

                            <Route path="user/:userId" element={<>user</>} />
                            <Route
                                path="user/:userId/arena"
                                element={<>user arena</>}
                            />
                            <Route
                                path="user/:userId/app/:appId"
                                element={
                                    <AppPage
                                        arena={arena}
                                        doDelete={() => {
                                            // todo
                                            axios
                                                .get(`/api/user/${user.id}`)
                                                .then((res) =>
                                                    setUser(res.data)
                                                )
                                        }}
                                        emitter={emitter}
                                    />
                                }
                            />
                            <Route
                                path="user/:userId/arena/logs"
                                element={<ArenaLogPage />}
                            />
                        </Routes>
                        </Suspense>
                    </div>
                </Router>
            </div>
            <div
                style={{
                    position: 'absolute',
                    height: '100%',
                    width: '50%',
                    top: 0,
                    left: '50%',
                    padding: '10px 10px 10px 5px',
                }}
            >
                {user && (
                    <div
                        style={{
                            position: 'absolute',
                            top: '22px',
                            left: '22px',
                        }}
                    >
                        <ArenaToolbar
                            isPaused={isPaused}
                            doPause={() =>
                                axios.post(`/api/user/${user.id}/arena/pause`)
                            }
                            doResume={() =>
                                axios.post(`/api/user/${user.id}/arena/resume`)
                            }
                            doRestart={() =>
                                axios.post(`/api/user/${user.id}/arena/restart`)
                            }
                        />
                    </div>
                )}
                <ArenaSvg darkMode={false} arena={arena} time={time}></ArenaSvg>
            </div>
        </>
    )
}

export default App
