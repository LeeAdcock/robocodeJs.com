import React from 'react'
import {
  Container,
  Row,
  Col,
  Accordion,
  Card,
  Button,
  Table,
  OverlayTrigger,
  Tooltip,
  ButtonToolbar,
  ButtonGroup,
  ProgressBar,
} from 'react-bootstrap'
import { colors } from '../util/colors'
import {
  FaMedal,
  FaEdit,
  FaListAlt,
  FaPlusSquare,
  FaMinusSquare,
  FaTrash,
  FaDownload,
  FaFireAlt,
} from 'react-icons/fa'
import Link from 'next/link'

// Convenience method to calculate a unqiue id
const getTankId = (appIndex: number, tankIndex: number) => (appIndex + 1) * 10 + (tankIndex + 1)

const explodedMessage = [
  'A ball of molten steel',
  'A very large number of very small pieces',
  'Smoldering ruins',
  'Rapidly disassembling',
  'Exploded',
  'Questioning life choices',
  'Taking an early retirement',
  'Collecting rust',
  'Burning rapidly',
]

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

const IndexPage = props => {
  const apps = props.apps

  const remaining = apps.filter(app =>
    app.tanks.reduce((acc, cur) => acc || cur.health > 0, false),
  ).length

  return (
    <Accordion defaultActiveKey={'0'} style={{ marginTop: '10px' }}>
      {apps.map((app, appIndex) => {
        const appHealth =
          app.tanks.reduce((acc, next) => acc + Math.max(0, next.health), 0) /
          (app.tanks.length * 100)

        return (
          <Card key={appIndex}>
            <Accordion.Toggle as={Card.Header} variant="link" eventKey={appIndex + ''}>
              <Container>
                <Row style={{ cursor: 'pointer' }}>
                  <Col style={{ paddingLeft: '0px' }}>
                    <h5
                      style={{
                        textDecoration:
                          appHealth <= 0 || app.tanks.length === 0 ? 'line-through' : undefined,
                      }}
                    >
                      {appHealth > 0 && remaining === 1 && (
                        <FaMedal style={{ color: 'gold', paddingRight: '5px' }} />
                      )}
                      <img
                        src={'/Lee/battlebots/sprites/tank_' + colors[appIndex] + '.png'}
                        style={{ height: '1em', paddingBottom: '2px', marginRight: '5px' }}
                      />{' '}
                      <Link href={`/app/${appIndex}/source`}>
                        <a>{titleCase(app.name)}</a>
                      </Link>
                    </h5>
                  </Col>
                  <Col>
                    <Container>
                      <Row>
                        <Col>
                          <ProgressBar
                            style={{ marginTop: '8px' }}
                            label={Math.ceil(appHealth * 100)}
                            now={appHealth * 100}
                          />
                        </Col>
                        <Col xs={8} style={{ padding: '0px', margin: '0px' }}>
                          <ButtonToolbar>
                            <ButtonGroup style={{ marginRight: '5px' }}>
                              <OverlayTrigger
                                placement={'bottom'}
                                overlay={
                                  <Tooltip id={`add`}>
                                    Add a new bot using this application logic.
                                  </Tooltip>
                                }
                              >
                                <Button
                                  variant="secondary"
                                  disabled={props.apps[appIndex].tanks.length === 9}
                                  size="sm"
                                  onClick={e => {
                                    props.addTank(appIndex)
                                    e.stopPropagation()
                                  }}
                                >
                                  <FaPlusSquare />
                                </Button>
                              </OverlayTrigger>

                              <Button disabled={true} variant="secondary" size="sm">
                                {props.apps[appIndex].tanks.length}
                              </Button>

                              <OverlayTrigger
                                placement={'bottom'}
                                overlay={
                                  <Tooltip id={`remove`}>
                                    Remove a bot that is using this application logic.
                                  </Tooltip>
                                }
                              >
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  disabled={props.apps[appIndex].tanks.length === 0}
                                  onClick={e => {
                                    props.removeTank(appIndex)
                                    e.stopPropagation()
                                  }}
                                >
                                  <FaMinusSquare />
                                </Button>
                              </OverlayTrigger>
                            </ButtonGroup>
                            <ButtonGroup>
                              <OverlayTrigger
                                placement={'bottom'}
                                overlay={
                                  <Tooltip id={`delete-app`}>
                                    Detroy this application and its bots. Be careful!
                                  </Tooltip>
                                }
                              >
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  disabled={props.apps.length === 1}
                                  onClick={e => {
                                    props.removeApp(appIndex)
                                    e.stopPropagation()
                                  }}
                                >
                                  <FaTrash />
                                </Button>
                              </OverlayTrigger>

                              <OverlayTrigger
                                placement={'bottom'}
                                overlay={
                                  <Tooltip id={`download-app`}>
                                    Download this application as a js file.
                                  </Tooltip>
                                }
                              >
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={e => {
                                    const link = document.createElement('a')
                                    link.download = `bot.js`
                                    link.href =
                                      'data:text/javascript;charset=utf-8,' +
                                      encodeURIComponent(props.apps[appIndex].source)
                                    link.click()
                                    e.stopPropagation()
                                  }}
                                >
                                  <FaDownload />
                                </Button>
                              </OverlayTrigger>

                              <OverlayTrigger
                                placement={'bottom'}
                                overlay={
                                  <Tooltip id={`download-app`}>Edit the application logic.</Tooltip>
                                }
                              >
                                <Button size="sm" variant="secondary">
                                  <Link href={`/app/${appIndex}/source`}>
                                    <a>
                                      <FaEdit />
                                    </a>
                                  </Link>
                                </Button>
                              </OverlayTrigger>

                              <OverlayTrigger
                                placement={'bottom'}
                                overlay={
                                  <Tooltip id={`download-app`}>View the application logs.</Tooltip>
                                }
                              >
                                <Button size="sm" variant="secondary">
                                  <Link href={`/app/${appIndex}/logs`}>
                                    <a>
                                      <FaListAlt />
                                    </a>
                                  </Link>
                                </Button>
                              </OverlayTrigger>
                            </ButtonGroup>
                          </ButtonToolbar>
                        </Col>
                      </Row>
                    </Container>
                  </Col>
                </Row>
              </Container>
            </Accordion.Toggle>
            <Accordion.Collapse eventKey={appIndex + ''}>
              <Card.Body>
                <Table striped bordered hover size="sm">
                  <thead>
                    <tr>
                      <th style={{ width: '30px' }}>#</th>
                      <th style={{ width: '100px' }}>Speed</th>
                      <th style={{ width: '100px' }}>Health</th>
                      <th style={{ width: '100px' }}>Radar</th>
                      <th style={{ width: '100px' }}>Turret</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {app.tanks.map((tank, tankIndex) => {
                      const speed =
                        (100 * Math.max(0, Math.abs(tank.health > 0 ? tank.speed : 0))) /
                        tank.speedMax
                      const health = Math.ceil((100 * Math.max(0, tank.health)) / 100)
                      const radar = Math.ceil(100 * (tank.radarCharged / 100))
                      const turret = Math.ceil(100 * (tank.turretLoaded / 100))
                      return (
                        <tr key={tankIndex}>
                          <td
                            style={{
                              textDecoration: tank.health <= 0 ? 'line-through' : undefined,
                            }}
                          >
                            {getTankId(appIndex, tankIndex)}
                          </td>
                          <td>
                            <ProgressBar
                              label={speed}
                              style={{ marginTop: '5px' }}
                              variant={speed >= 0 ? undefined : 'danger'}
                              now={speed}
                            />
                          </td>
                          <td>
                            <ProgressBar label={health} style={{ marginTop: '5px' }} now={health} />
                          </td>
                          <td>
                            <ProgressBar label={radar} style={{ marginTop: '5px' }} now={radar} />
                          </td>
                          <td>
                            <ProgressBar label={turret} style={{ marginTop: '5px' }} now={turret} />
                          </td>
                          <td style={{ maxHeight: '1em' }}>
                            {tank.health <= 0 ? (
                              <>
                                <FaFireAlt style={{ marginRight: '5px' }} />
                                {
                                  explodedMessage[
                                    getTankId(appIndex, tankIndex) % explodedMessage.length
                                  ]
                                }
                              </>
                            ) : undefined}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </Table>
              </Card.Body>
            </Accordion.Collapse>
          </Card>
        )
      })}
    </Accordion>
  )
}

export default IndexPage
