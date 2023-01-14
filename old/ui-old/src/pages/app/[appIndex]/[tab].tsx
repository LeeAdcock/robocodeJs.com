import React from 'react'
import Container from 'react-bootstrap/Container'
import Row from 'react-bootstrap/Row'
import Col from 'react-bootstrap/Col'
import Tab from 'react-bootstrap/Tab'
import Nav from 'react-bootstrap/Nav'
import Logs from '../../../components/logs'
import Toolbar from '../../../components/toolbar'
import { colors } from '../../../util/colors'
import { TankApp } from '@battletank/lib'
import { useRouter } from 'next/router'
import dynamic from 'next/dynamic'
import prettier from 'prettier/standalone'
import babel from 'prettier/parser-babel'

// Must load this dynamically because refernces to the
// window instances will fail on server-side compiling.
const DynamicCodeEditor = dynamic(() => import('../../../components/editor'), { ssr: false })

const titleCase = (str: string | null): string =>
  str === null
    ? ''
    : str
        .toLowerCase()
        .split(' ')
        .map(function (word) {
          return word.charAt(0).toUpperCase() + word.slice(1)
        })
        .join(' ')

const isServer = () => typeof window === 'undefined'

export class EditorPageHeader extends React.Component<
  {
    name: string
    appIndex: number
    apps: TankApp[]
    tankCount: number
    removeApp: Function
    addTank: Function
    removeTank: Function
    updateApps: Function
  },
  {
    editor: any
  }
> {
  shouldComponentUpdate(nextProps, nextState) {
    return this.props.name !== nextProps.name || this.props.tankCount !== nextProps.tankCount
  }

  render() {
    const selectedTankApp: TankApp = this.props.apps[this.props.appIndex]

    return (
      <Container style={{ paddingBottom: '5px' }}>
        <Row>
          <Col style={{ padding: '0px' }}>
            <h5 style={{ margin: '5px 0px 0px 0px' }}>
              <img
                src={'/Lee/battlebots/sprites/tank_' + colors[this.props.appIndex] + '.png'}
                style={{ height: '1em', paddingBottom: '2px', marginRight: '5px' }}
              />{' '}
              {titleCase(this.props.name)}
            </h5>
          </Col>
          <Col style={{ padding: '0px' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Toolbar
                apps={this.props.apps}
                tankCount={this.props.tankCount}
                selectedTankApp={selectedTankApp}
                removeApp={() => {
                  this.props.removeApp(this.props.appIndex)
                }}
                addTank={() => {
                  this.props.addTank(this.props.appIndex)
                }}
                cleanCode={() => {
                  try {
                    selectedTankApp.source = prettier.format(selectedTankApp.source || ' ', {
                      semi: false,
                      trailingComma: 'none',
                      plugins: [babel],
                    })
                    selectedTankApp.recompile = true
                    this.props.updateApps(this.props.apps)
                  } catch (error) {
                    // do nothing
                  }
                }}
                removeTank={() => {
                  this.props.removeTank(this.props.appIndex)
                }}
              />
            </div>
          </Col>
        </Row>
      </Container>
    )
  }
}

const AppEditorPage = (props: any) => {
  const router = useRouter()
  const { appIndex, tab } = router.query

  if (appIndex === undefined) return <></>
  if (isServer()) return <></>

  const selectedTankApp: TankApp = props.apps[parseInt(appIndex as string)]

  return selectedTankApp === null ? (
    <></>
  ) : (
    <>
      <Container
        className="h-100"
        style={{ paddingTop: '5px', display: 'flex', flexDirection: 'column' }}
      >
        <Row>
          <Col style={{ padding: '0px' }}>
            <EditorPageHeader
              name={selectedTankApp.name || 'Unknown'}
              tankCount={selectedTankApp.tanks.length}
              appIndex={parseInt(appIndex as string)}
              apps={props.apps}
              removeTank={props.removeTank}
              removeApp={removeAppIndex => {
                props.removeApp(removeAppIndex)
                router.push('/')
              }}
              updateApps={props.updateApp}
              addTank={props.addTank}
            />
          </Col>
        </Row>
        <Row className="flex-fill">
          <Col className="d-flex flex-column" style={{ padding: '0px' }}>
            <Tab.Container
              id="content-tabs"
              transition={false}
              mountOnEnter={true}
              unmountOnExit={true}
              activeKey={(tab as string) || undefined}
            >
              <Row>
                <Col>
                  <Nav variant="tabs" className="flex-rows">
                    <Nav.Item>
                      <Nav.Link
                        onClick={() => router.push(`/app/${appIndex}/source`)}
                        eventKey="source"
                        style={{ padding: '.25rem .5rem' }}
                      >
                        Source
                      </Nav.Link>
                    </Nav.Item>
                    <Nav.Item>
                      <Nav.Link
                        onClick={() => router.push(`/app/${appIndex}/logs`)}
                        eventKey="logs"
                        style={{ padding: '.25rem .5rem' }}
                      >
                        Logs
                      </Nav.Link>
                    </Nav.Item>
                  </Nav>
                </Col>
              </Row>
              <Row className="flex-fill">
                <Col className="d-flex flex-column">
                  <Tab.Content className="h-100">
                    <Tab.Pane
                      eventKey="source"
                      className="h-100"
                      style={{ borderBottom: '1px solid #dee2e6' }}
                    >
                      <DynamicCodeEditor
                        darkMode={props.darkMode}
                        code={selectedTankApp.source || ' '}
                        onSave={props.saveState}
                        onChange={source => {
                          selectedTankApp.source = source
                          selectedTankApp.recompile = true
                          props.updateApps(props.apps)
                        }}
                      />
                    </Tab.Pane>
                    <Tab.Pane
                      eventKey="logs"
                      className="h-100"
                      style={{ borderBottom: '1px solid #dee2e6' }}
                    >
                      <Logs
                        selectedTankApp={selectedTankApp}
                        logs={props.consoleBuffer.getRecords()}
                      />
                    </Tab.Pane>
                  </Tab.Content>
                </Col>
              </Row>
            </Tab.Container>
          </Col>
        </Row>
      </Container>
    </>
  )
}

export default AppEditorPage
