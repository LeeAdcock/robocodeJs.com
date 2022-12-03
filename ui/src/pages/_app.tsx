import React from 'react'
import App from 'next/app'
import 'bootstrap/dist/css/bootstrap.min.css'
import Head from 'next/head'

import 'bootstrap/dist/css/bootstrap.min.css'

import '../../public/style.css'

import { Container, Row, Col } from 'react-bootstrap'
import moment from 'moment'
import axios from 'axios'
import { createLogger, ConsoleFormattedStream } from 'browser-bunyan'

import { Simulation, Compiler, TankApp, Tank, Stats } from '@battletank/lib'

import RingBuffer from '../util/ringBuffer'
import Arena from '../components/arena'
import NavBar from '../components/navbar'

const consoleBuffer = new RingBuffer()

const logger = createLogger({
  name: 'Battlebots',
  streams: [
    {
      level: 'TRACE',
      stream: new ConsoleFormattedStream(),
    },
    {
      level: 'TRACE',
      stream: consoleBuffer,
    },
  ],
})

let debounceSaveTimer
function debounceSave(func) {
  clearTimeout(debounceSaveTimer)
  debounceSaveTimer = setTimeout(func, 10000)
}

let debounceCompilerTimer
function debounceCompile(func) {
  clearTimeout(debounceCompilerTimer)
  debounceCompilerTimer = setTimeout(func, 1000)
}

export default class BattleBotsTankApp extends App<
  {},
  {},
  {
    darkMode: boolean
    version: number
    lastSaved: any
    apps: any[]
    simulationTimer: any
    isPaused: boolean
    time: number
  }
> {
  constructor(props: any) {
    super(props)
    this.state = {
      darkMode: false,
      version: 1,
      lastSaved: null,
      apps: [new TankApp()],
      simulationTimer: null,
      isPaused: false,
      time: 0,
    }

    this.restart = this.restart.bind(this)
    this.saveState = this.saveState.bind(this)
    this.doRunSimulation = this.doRunSimulation.bind(this)
  }

  arenaRef: React.RefObject<any> = React.createRef()

  restart(appIndex: number, tankIndex: number) {
    const tank = this.state.apps[appIndex].tanks[tankIndex]
    tank.health = 100
    tank.bullets = []
    tank.path = new Array(20)
    tank.pathIndex = 0
    tank.turretLoaded = 0
    tank.radarCharged = 0
    tank.appScope = {}
    tank.stats = new Stats()
    tank.speed = 0
    tank.speedTarget = 0
    tank.timers = {
      intervalMap: {},
      timerMap: {},
    }

    let overallClosestTank = null
    do {
      tank.x = 16 + (this.arenaRef.current.clientWidth - 32) * Math.random()
      tank.y = 16 + (this.arenaRef.current.clientHeight - 32) * Math.random()

      // Keep iterating if we placed this tank too close to another
      overallClosestTank = this.state.apps.reduce(
        (closestDistanceForTankApp, curTankApp, curTankAppIndex) => {
          const closestTankForThisTankApp = curTankApp.tanks.reduce(
            (closestDistanceForTank, curTank, curTankIndex) => {
              if (curTankAppIndex === appIndex && curTankIndex === tankIndex)
                return closestDistanceForTank
              const curTankDistance = Math.sqrt(
                Math.pow(curTank.x - tank.x, 2) + Math.pow(curTank.y - tank.y, 2),
              )
              return !closestDistanceForTank
                ? curTankDistance
                : Math.min(closestDistanceForTank, curTankDistance)
            },
            null,
          )
          if (!closestDistanceForTankApp) return closestTankForThisTankApp
          if (!closestTankForThisTankApp) return closestDistanceForTankApp
          return Math.min(closestDistanceForTankApp, closestTankForThisTankApp)
        },
        null,
      )
    } while (overallClosestTank !== null && overallClosestTank < 50)

    tank.bodyOrientation = Math.random() * 360
    tank.bodyOrientationTarget = tank.bodyOrientation
    tank.turretOrientation = Math.random() * 360
    tank.turretOrientationTarget = tank.turretOrientation
    tank.radarOrientation = Math.random() * 360
    tank.radarOrientationTarget = tank.radarOrientation

    Compiler.compile(
      this.state.apps,
      appIndex,
      tankIndex,
      () => this.arenaRef.current.clientWidth,
      () => this.arenaRef.current.clientHeight,
      consoleBuffer,
      true,
      () => this.state.time,
    )

    tank.needsStarting = true

    this.setState({ time: 0, apps: this.state.apps })
  }

  componentDidUpdate(prevProps, prevState) {
    this.state.apps.forEach(
      ((app, appIndex) => {
        if (app.recompile) {
          app.recompile = false
          debounceCompile(() => {
            try {
              app.tanks.forEach((tank, tankIndex) => {
                Compiler.compile(
                  this.state.apps,
                  appIndex,
                  tankIndex,
                  () => this.arenaRef.current.clientWidth,
                  () => this.arenaRef.current.clientHeight,
                  consoleBuffer,
                  true,
                  () => this.state.time,
                )
              })
              this.setState({ apps: this.state.apps, lastSaved: moment() })
              this.saveState()
            } catch (e) {
              // do nothing
            }
          })
        }
      }).bind(this),
    )
  }

  loadState() {
    // If we have a saved prior state, load it.
    const state = localStorage.getItem('state')
    logger.trace('Starting')
    if (state) {
      const stateObj = JSON.parse(state)
      if (stateObj.version === this.state.version) {
        stateObj.apps.forEach((app, appIndex) => {
          app.recompile = true
          app.tanks.forEach((tank, tankIndex) => {
            tank.timers = {
              intervalMap: {},
              timerMap: {},
            }
          })
        })
        this.setState(stateObj)
        return
      }
    }

    // If there was no state, then initialize the default bots.
    Promise.all([
      axios.get('/Lee/battlebots/samples/firstbot.js').then(res => {
        const app = new TankApp()
        app.source = res.data as string
        return app
      }),
      axios.get('/Lee/battlebots/samples/secondbot.js').then(res => {
        const app = new TankApp()
        app.source = res.data as string
        return app
      }),
    ]).then(apps => {
      this.setState({ apps })
      apps.forEach((app, appIndex) =>
        app.tanks.forEach((tank, tankIndex) => this.restart(appIndex, tankIndex)),
      )
    })
  }

  saveState() {
    debounceSave(() => {
      localStorage.setItem('state', JSON.stringify(this.state))
      this.setState({ lastSaved: moment() })
      logger.trace('Saving')
    })
  }

  componentDidMount() {
    this.loadState()
    this.setState({ simulationTimer: setInterval(this.doRunSimulation, 100) })
  }

  doRunSimulation() {
    if (!this.arenaRef.current) return
    if (this.state.isPaused) return

    const time = this.state.time + 1

    Simulation.run(
      time,
      this.state.apps,
      this.arenaRef.current.clientWidth,
      this.arenaRef.current.clientHeight,
    )

    this.setState({ time, apps: this.state.apps })
  }

  render() {
    const { Component, pageProps } = this.props

    return (
      <>
        <Head>
          <title>Battlebots.js</title>
          <link rel="icon" type="image/png" href="/Lee/battlebots/sprites/tank_blue.png" />
        </Head>

        <div
          className={this.state.darkMode ? 'dark' : undefined}
          style={{ overflow: 'hidden', minHeight: '100vh' }}
        >
          <Container
            fluid
            style={{
              paddingTop: '20px',
              paddingBottom: '20px',
              minHeight: '100vh',
              boxShadow: '0px 0px 10px #888888',
            }}
            className="container-fluid d-flex flex-column"
          >
            <Row className="flex-fill">
              <Col className="d-flex flex-column">
                <NavBar
                  appNames={this.state.apps.map(app => app.name)}
                  isPaused={this.state.isPaused}
                  toggleDarkMode={() => this.setState({ darkMode: !this.state.darkMode })}
                  pause={() => {
                    logger.trace('Paused')
                    this.setState({ isPaused: true })
                  }}
                  resume={() => {
                    logger.trace('Resumed')
                    this.setState({ isPaused: false })
                  }}
                  new={() => {
                    this.state.apps.push(new TankApp())
                    this.setState({
                      apps: this.state.apps,
                    })
                    // TODO redirect
                    this.restart(this.state.apps.length - 1, 0)
                  }}
                  restart={() => {
                    consoleBuffer.clear()
                    logger.trace('Starting')
                    this.state.apps.forEach((app, appIndex) =>
                      app.tanks.forEach((tank, tankIndex) => this.restart(appIndex, tankIndex)),
                    )
                    this.saveState()
                  }}
                  save={this.saveState}
                />

                <Component
                  {...pageProps}
                  darkMode={this.state.darkMode}
                  apps={this.state.apps}
                  consoleBuffer={consoleBuffer}
                  saveState={this.saveState}
                  restart={this.restart}
                  updateApps={apps => this.setState({ apps })}
                  createApp={() => {}}
                  removeApp={appIndex => {
                    // TODO nav
                    this.state.apps.splice(appIndex, 1)
                    this.setState({ apps: this.state.apps })
                  }}
                  addTank={appIndex => {
                    this.state.apps[appIndex].tanks.push(new Tank())
                    this.setState({ apps: this.state.apps })
                    this.restart(appIndex, this.state.apps[appIndex].tanks.length - 1)
                  }}
                  removeTank={appIndex => {
                    this.state.apps[appIndex].tanks.pop()
                    this.setState({ apps: this.state.apps })
                  }}
                />
              </Col>
              <Col style={{ paddingLeft: '0px' }}>
                <svg
                  ref={this.arenaRef}
                  width="100%"
                  height="100%"
                  xmlns="http://www.w3.org/2000/svg"
                  style={{ border: '2px solid black' }}
                >
                  <Arena darkMode={this.state.darkMode} apps={this.state.apps} />
                </svg>
              </Col>
            </Row>
          </Container>
        </div>
      </>
    )
  }
}
