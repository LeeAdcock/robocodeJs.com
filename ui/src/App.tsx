import './App.css'
import ArenaSvg from './components/arena/arena'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom'
import Container from 'react-bootstrap/Container'
import Row from 'react-bootstrap/Row'
import Col from 'react-bootstrap/Col'
import TankApp from './types/tankApp'
import Arena from './types/arena'
import AppPage from './page/app/appPage'
import NavBar from './components/navbar'
import MarkdownPage from './page/markdownPage'
import User from './types/user'
import ArenaToolbar from './components/arena/arenaToolbar'
import 'bootstrap/dist/css/bootstrap.min.css'
import { useState, useEffect } from 'react'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'
import PointInTime from './types/pointInTime'
import Simulate from './util/simulate'
import ArenaLogPage from './page/arena/arenaLogsPage'

declare const google: any

interface NavProps {
    user: User
    arena: Arena
    isPaused: boolean
    doLogin: () => void
    doCreateApp: () => void
}
const Nav = (props: NavProps) => {
    const navigate = useNavigate()

    return (
        <NavBar
            apps={props.user?.apps}
            arena={props.arena}
            user={props.user}
            doLogin={props.doLogin}
            isPaused={props.isPaused}
            doPause={() => axios.post(`/api/user/${props.user.id}/arena/pause`)}
            doResume={() =>
                axios.post(`/api/user/${props.user.id}/arena/resume`)
            }
            doRestart={() =>
                axios.post(`/api/user/${props.user.id}/arena/restart`)
            }
            doSave={() => {/* todo */}}
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

let eventSource: EventSource | undefined

function App() {
    const [user, setUser] = useState(null as unknown as User)
    const [arena, setArena] = useState({
        clock: { time: 0 },
        apps: [] as TankApp[],
    } as Arena)
    const [time, setTime] = useState(0)
    const [isPaused, setPaused] = useState(true)

    const doLogin = () => {
        // prompt to authenticate
        google.accounts.id.initialize({
            client_id:
                '926984742216-a5uuqefrrrvnn5pa87e357kld6rv2bsc.apps.googleusercontent.com',
            callback: (response) => {
                document.cookie = 'auth=' + response.credential + '; path=/'
                axios
                    .get(`/api/user`)
                    .then((res) =>
                        axios
                            .get(`/api/user/${res.data.id}`)
                            .then((res) => setUser(res.data))
                    )
            },
        })
        google.accounts.id.prompt()
    }

    const doReloadArena = () => {
        return new Promise((resolve) => {
            axios.get(`/api/user/${user.id}/arena`).then((res) => {
                setTime(res.data.clock.time)
                setArena(res.data)
                setPaused(!res.data.running)
                resolve(res.data)
            })
        })
    }

    useEffect(() => {
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
                .catch(doLogin)
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
        if (user) {
            doReloadArena()
        }
    }, [user])

    useEffect(() => {
        if (eventSource) {
            eventSource.close()
            eventSource = undefined
        }
        if (user) {
            // todo externalize the server
            eventSource = new EventSource(
                `${window.location.protocol}//${window.location.host}/api/user/${user.id}/arena/events`
            )

            eventSource.onmessage = (message) => {
                // workaround to access arena inside of callback
                setArena((messageArena) => {
                    const data = JSON.parse(message.data)
                    let apps = messageArena.apps
                    console.log('message', data)
                    if (
                        data.type === 'tick' &&
                        messageArena.clock.time !== data.time
                    ) {
                        Simulate(
                            messageArena.clock.time,
                            messageArena.apps,
                            750, //todo get this from the server
                            750
                        )
                        messageArena.clock.time = data.time
                        setTime(data.time)
                    } else if (data.type === 'tankTurn') {
                        apps.forEach((app) =>
                            app.tanks
                                .filter((tank) => tank.id === data.id)
                                .forEach((tank) => {
                                    if (tank.id === data.id) {
                                        //const delta = normalizeAngle(normalizeAngle(tank.bodyOrientation) - data.bodyOrientation)
                                        //tank.bodyOrientation = data.bodyOrientation + (delta <= 180 ? -1 : 1) * (360-delta)
                                        tank.bodyOrientationTarget =
                                            data.bodyOrientationTarget
                                        tank.bodyOrientationVelocity =
                                            data.bodyOrientationVelocity
                                        tank.x = data.x
                                        tank.y = data.y
                                    }
                                })
                        )
                    } else if (data.type === 'tankAccelerate') {
                        apps.forEach((app) =>
                            app.tanks.forEach((tank) => {
                                if (tank.id === data.id) {
                                    tank.speed = data.speed
                                    tank.speedTarget = data.speedTarget
                                    tank.speedAcceleration =
                                        data.speedAcceleration
                                    tank.speedMax = data.speedMax
                                    tank.x = data.x
                                    tank.y = data.y
                                }
                            })
                        )
                    } else if (data.type === 'tankStop') {
                        apps.forEach((app) =>
                            app.tanks.forEach((tank) => {
                                if (tank.id === data.id) {
                                    tank.speed = 0
                                    tank.speedTarget = 0
                                    tank.x = data.x
                                    tank.y = data.y
                                }
                            })
                        )
                    } else if (data.type === 'radarScan') {
                        apps.forEach((app) =>
                            app.tanks.forEach((tank) => {
                                if (tank.id === data.id) {
                                    tank.radarOn = true
                                    setTimeout(
                                        () => (tank.radarOn = false),
                                        200
                                    )
                                }
                            })
                        )
                    } else if (data.type === 'radarTurn') {
                        apps.forEach((app) =>
                            app.tanks.forEach((tank) => {
                                if (tank.id === data.id) {
                                    //tank.radarOrientation = data.radarOrientation
                                    tank.radarOrientationTarget =
                                        data.radarOrientationTarget
                                    tank.radarOrientationVelocity =
                                        data.radarOrientationVelocity
                                }
                            })
                        )
                    } else if (data.type === 'tankDamaged') {
                        apps.forEach((app) =>
                            app.tanks.forEach((tank) => {
                                if (tank.id === data.id) {
                                    tank.health = data.health
                                    if (tank.health <= 0) {
                                        tank.speed = 0
                                        tank.speedTarget = 0
                                    }
                                }
                            })
                        )
                    } else if (data.type === 'appRenamed') {
                        const app = apps.find((app) => app.id === data.appId)
                        if (app && app.name !== data.name) {
                            app.name = data.name
                            axios
                                .get(`/api/user/${user.id}`)
                                .then((res) => setUser(res.data))
                        }
                    } else if (data.type === 'arenaRestart') {
                        if (isPaused) doReloadArena()
                        else {
                            messageArena.apps = []
                        }
                    } else if (data.type === 'arenaPaused') {
                        setPaused(true)
                    } else if (data.type === 'arenaResumed') {
                        setPaused(false)
                    } else if (data.type === 'arenaRemoveApp') {
                        const removedApp = apps.find(
                            (app) => app.id === data.id
                        )
                        if (removedApp) {
                            apps = apps.slice(apps.indexOf(removedApp), 1)
                        }
                    } else if (data.type === 'arenaPlaceApp') {
                        const removedApp = apps.find(
                            (app) => app && app.id === data.id
                        )
                        if (removedApp) {
                            apps = apps.slice(apps.indexOf(removedApp), 1)
                        }
                        const newApp = {
                            id: data.id,
                            name: data.name,
                            tanks: [],
                        }
                        apps.push(newApp)
                    } else if (data.type === 'arenaRemoveTank') {
                        apps.filter((app) => app.id === data.appId).forEach(app => {
                            const removedTank = app.tanks.find(
                                (tank) => tank.id === data.id
                            )
                            if (removedTank) {
                                app.tanks = app.tanks.slice(app.tanks.indexOf(removedTank), 1)
                            }
                        })
                    } else if (data.type === 'arenaPlaceTank') {
                        apps.filter((app) => app.id === data.appId).forEach(
                            (app) => {
                                if (!app.tanks.find((t) => t.id === data.id)) {
                                    const tank = {
                                        id: data.id,
                                        speed: data.speed,
                                        speedTarget: 0,
                                        speedAcceleration: 0,
                                        speedMax: data.speedMax,
                                        bodyOrientation: data.bodyOrientation,
                                        bodyOrientationTarget:
                                            data.bodyOrientation,
                                        bodyOrientationVelocity:
                                            data.bodyOrientationVelocity,
                                        turretOrientation:
                                            data.turretOrientation,
                                        turretOrientationTarget:
                                            data.turretOrientation,
                                        turretOrientationVelocity:
                                            data.turretOrientationVelocity,
                                        radarOrientation: data.radarOrientation,
                                        radarOrientationTarget:
                                            data.radarOrientation,
                                        radarOrientationVelocity:
                                            data.radarOrientationVelocity,
                                        radarOn: false,
                                        bullets: [],
                                        health: 100,
                                        path: Array<PointInTime>(20),
                                        pathIndex: 0,
                                        x: data.x,
                                        y: data.y,
                                    }
                                    tank.path[0] = {
                                        x: data.x,
                                        y: data.y,
                                        time,
                                    }
                                    tank.pathIndex = 1
                                    app.tanks.push(tank)
                                }
                            }
                        )
                    } else if (data.type === 'turretTurn') {
                        apps.forEach((app) =>
                            app.tanks.forEach((tank) => {
                                if (tank.id === data.id) {
                                    //tank.turretOrientation =
                                    //    data.turretOrientation
                                    tank.turretOrientationTarget =
                                        data.turretOrientationTarget
                                    tank.turretOrientationVelocity =
                                        data.turretOrientationVelocity
                                }
                            })
                        )
                    } else if (data.type === 'bulletFired') {
                        apps.forEach((app) =>
                            app.tanks.forEach((tank) => {
                                if (
                                    !tank.bullets.find(
                                        (bullet) => bullet.id === data.id
                                    )
                                ) {
                                    if (tank.id === data.tankId) {
                                        tank.bullets.push({
                                            id: data.id,
                                            x: data.x,
                                            y: data.y,
                                            orientation: data.orientation,
                                            origin: {
                                                x: data.x,
                                                y: data.y,
                                            },
                                            explodedAt: undefined,
                                            speed: data.speed,
                                        })
                                    }
                                }
                            })
                        )
                    } else if (data.type === 'bulletRemoved') {
                        apps.forEach((app) =>
                            app.tanks.forEach((tank) =>
                                tank.bullets.forEach(
                                    (bullet, bulletIndex, bullets) => {
                                        if (bullet.id === data.id) {
                                            bullets.splice(bulletIndex, 1)
                                        }
                                    }
                                )
                            )
                        )
                    } else if (data.type === 'bulletExploded') {
                        apps.forEach((app) =>
                            app.tanks.forEach((tank) =>
                                tank.bullets.forEach((bullet) => {
                                    //if(tank.id === data.tankId) {
                                    if (bullet.id === data.id) {
                                        bullet.explodedAt = data.time
                                    }
                                    //}
                                })
                            )
                        )
                    }
                    return messageArena
                })
            }
        }

        return () => {
            if (eventSource) {
                eventSource.close()
                eventSource = undefined
            }
        }
    }, [user])

    return (
        <Container
            fluid
            style={{
                height: '100%',
                paddingTop: 'calc(var(--bs-gutter-x) * .5)',
                paddingBottom: 'calc(var(--bs-gutter-x) * .5)',
            }}
        >
            <Row style={{ height: '100%' }}>
                <Col style={{ position: 'relative', height: '100%' }}>
                    <Router>
                        <Nav
                            user={user}
                            arena={arena}
                            isPaused={isPaused}
                            doLogin={doLogin}
                            doCreateApp={() => {
                                // todo
                                axios
                                    .get(`/api/user/${user.id}`)
                                    .then((res) => setUser(res.data))
                            }}
                        />

                        <Routes>
                            <Route
                                path="/"
                                element={
                                    <MarkdownPage path="./docs/index.md" />
                                }
                            />
                            <Route path="user/:userId" element={<>user</>} />
                            <Route
                                path="user/:userId/arena"
                                element={<>user arena</>}
                            />
                            <Route
                                path="user/:userId/app/:appId"
                                element={<AppPage arena={arena} doDelete={() => {
                                    // todo
                                    axios
                                        .get(`/api/user/${user.id}`)
                                        .then((res) => setUser(res.data))
                                }}/>}
                            />
                            <Route
                                path="user/:userId/arena/logs"
                                element={<ArenaLogPage arena={arena} />}
                            />
                        </Routes>
                    </Router>
                </Col>
                <Col style={{ position: 'relative' }}>
                    {user && (
                        <div
                            style={{
                                position: 'absolute',
                                top: '10px',
                                left: '22px',
                            }}
                        >
                            <ArenaToolbar
                                isPaused={isPaused}
                                doPause={() =>
                                    axios.post(
                                        `/api/user/${user.id}/arena/pause`
                                    )
                                }
                                doResume={() =>
                                    axios.post(
                                        `/api/user/${user.id}/arena/resume`
                                    )
                                }
                                doRestart={() =>
                                    axios.post(
                                        `/api/user/${user.id}/arena/restart`
                                    )
                                }
                            />
                        </div>
                    )}
                    <ArenaSvg
                        darkMode={false}
                        arena={arena}
                        time={time}
                    ></ArenaSvg>
                </Col>
            </Row>
        </Container>
    )
}

export default App
