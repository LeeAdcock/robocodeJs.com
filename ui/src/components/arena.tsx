import React from 'react'
import { TankApp } from 'battle-bots'
import { generateTerrain } from '../util/terraformer'
import { colors } from '../util/colors'
import { Popover, OverlayTrigger } from 'react-bootstrap'
import Link from 'next/link'

// Convenience method to calculate a unqiue id
const getTankId = (appIndex: number, tankIndex: number) => (appIndex + 1) * 10 + (tankIndex + 1)

const drawPaths = apps =>
  apps.map((app, appIndex) => (
    <g name="paths" key={appIndex}>
      {app.tanks.map((tank, tankIndex) => (
        <g name="path" key={tankIndex}>
          {[
            ...tank.path.filter(path => path && path.time).sort((a, b) => a.time - b.time),
            { x: tank.x, y: tank.y },
          ].map((point, pointIndex, points) => {
            const next = points[pointIndex + 1]
            if (!next) return null

            const distance = Math.sqrt(
              Math.pow(next.x - point.x, 2) + Math.pow(next.y - point.y, 2),
            )

            if (distance < 5) return null
            const angle: number =
              Math.atan2(point.y - next.y, point.x - next.x) * (180 / Math.PI) - 90

            return (
              <rect
                key={point.time}
                opacity={0.45 - (1 - pointIndex / points.length) * 0.45}
                fill="url(#tracks)"
                x={-16}
                y={-16}
                height={distance}
                width={32}
                transform={[
                  'translate(' + point.x + ',' + point.y + ')',
                  'rotate(180)',
                  'rotate(' + angle + ')',
                ].join(' ')}
              />
            )
          })}
        </g>
      ))}
    </g>
  ))

const drawTankPopover = (appName, appIndex, tank, tankIndex) => {
  const toProperCase = text => {
    const withSpaces = text.replace(/([A-Z])/g, ' $1')
    return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1)
  }

  return (
    <Popover id="popover-basic">
      <Popover.Title as="h3">
        <img
          src={'/Lee/battlebots/sprites/tank_' + colors[appIndex] + '.png'}
          style={{ height: '1em', paddingBottom: '2px', marginRight: '5px' }}
        />{' '}
        {appName} &lt;{getTankId(appIndex, tankIndex)}&gt;
      </Popover.Title>
      <Popover.Content>
        Health:{' '}
        <span style={{ color: tank.health >= 75 ? 'green' : tank.health <= 25 ? 'red' : 'orange' }}>
          {Math.max(0, tank.health)}%
        </span>
        <br />
        Turret Armed:{' '}
        <span style={{ color: tank.turretLoaded >= 100 ? 'green' : 'black' }}>
          {tank.turretLoaded}%
        </span>
        <br />
        Radar Charged:{' '}
        <span style={{ color: tank.radarCharged >= 100 ? 'green' : 'black' }}>
          {tank.radarCharged}%
        </span>
        <br />
        Stats:
        <ul>
          {Object.keys(tank.stats).map(key => (
            <>
              <li>
                <i>{toProperCase(key)}</i>: {tank.stats[key]}
              </li>
            </>
          ))}
          {Object.keys(tank.appScope).map(key => {
            let value
            try {
              value = JSON.stringify(tank.appScope[key])
            } catch (e) {
              return <></>
            }
            return (
              <>
                <li>
                  <i>{key}</i>: {value}
                </li>
              </>
            )
          })}{' '}
        </ul>
      </Popover.Content>
    </Popover>
  )
}

const Tank = React.memo((props: any) => (
  <>
    <g
      key={props.tankIndex}
      opacity={props.health > 0 ? 1 : 0.5}
      filter={props.health > 0 ? undefined : 'url(#blur)'}
    >
      <image
        href={'/Lee/battlebots/sprites/tankBody_' + colors[props.appIndex] + '.png'}
        height="32"
        width="32"
        transform={[
          'translate(' + props.x + ',' + props.y + ')',
          'rotate(' + props.bodyOrientation + ')',
          'translate(-16, -16)',
        ].join(' ')}
      />
      <text
        textAnchor="end"
        opacity={0.5}
        transform={[
          'translate(' + props.x + ',' + props.y + ')',
          'rotate(' + props.bodyOrientation + ')',
          'rotate(180)',
          'translate(10, 14)',
        ].join(' ')}
        style={{ fontSize: '5pt', fontFamily: 'monospace', fontWeight: 'bold' }}
      >
        {getTankId(props.appIndex, props.tankIndex)}
      </text>
      <image
        href={
          '/Lee/battlebots/sprites/tank' +
          colors[props.appIndex][0].toUpperCase() +
          colors[props.appIndex].substring(1).toLowerCase() +
          '_barrel2_outline.png'
        }
        height="32"
        width="32"
        transform={[
          'translate(' + props.x + ',' + props.y + ')',
          'rotate(180)',
          'rotate(' + (props.bodyOrientation + props.turretOrientation) + ')',
          'translate(-16, -24)',
        ].join(' ')}
      />
      <g
        transform={[
          'translate(' + props.x + ',' + props.y + ')',
          'rotate(' +
            (props.bodyOrientation + props.turretOrientation + props.radarOrientation) +
            ')',
        ].join(' ')}
      >
        {props.radarOn && <polygon points="-4,0,4,0,60,300,-60,300" fill="url(#radar)"></polygon>}
        <image
          href={'/Lee/battlebots/sprites/barrelRust_top.png'}
          height="8"
          width="16"
          preserveAspectRatio="xMinYMin slice"
          transform={'translate(-8, -2)'}
        />
      </g>
      {props.health > 0 && (
        <g opacity={0.75} transform={'translate(' + props.x + ',' + props.y + ')'}>
          <rect
            width={32}
            height={4}
            x={-16}
            y={16}
            stroke={'black'}
            fill="#DE7A4A"
            fillOpacity="0.9"
          />
          <rect
            width={32 * (props.health / 100)}
            height={4}
            x={-16}
            y={16}
            fill="green"
            fillOpacity="0.9"
          />
        </g>
      )}
    </g>
  </>
))

const Bullet = React.memo((props: any) => (
  <g key={props.id} name="bullet">
    <image
      href={'/Lee/battlebots/sprites/shotLarge.png'}
      height="46"
      width="16"
      opacity={0.9}
      style={{
        transition: 'all 200ms linear',
      }}
      transform={[
        'translate(' + props.x + ',' + props.y + ')',
        'rotate(180)',
        'rotate(' + props.orientation + ')',
        'translate(-6, -32)',
      ].join(' ')}
    />

    <image
      href={
        '/Lee/battlebots/sprites/bullet' +
        colors[props.appIndex][0].toUpperCase() +
        colors[props.appIndex].substring(1).toLowerCase() +
        '1_outline.png'
      }
      style={{
        transition: 'all 200ms linear',
      }}
      height="14"
      width="4"
      transform={[
        'translate(' + props.x + ',' + props.y + ')',
        'rotate(180)',
        'rotate(' + props.orientation + ')',
        'translate(0, -32)',
      ].join(' ')}
    />
  </g>
))

const ArenaStyle = React.memo((props: any) => (
  <defs>
    <pattern id="grass" width="32" height="32" patternUnits="userSpaceOnUse">
      <image href={'/Lee/battlebots/sprites/tileGrass1.png'} height="32" width="32" />
    </pattern>
    <pattern id="sand" width="32" height="32" patternUnits="userSpaceOnUse">
      <image href={'/Lee/battlebots/sprites/tileSand1.png'} height="32" width="32" />
    </pattern>
    <pattern id="tracks" patternUnits="userSpaceOnUse" width="32" height="32">
      <image href="/Lee/battlebots/sprites/tracksLarge.png" x="0" y="0" width="32" height="32" />
    </pattern>
    <filter id="blur" x="0" y="0">
      <feGaussianBlur in="SourceGraphic" stdDeviation="2" />
    </filter>
    <filter id="darkMode">
      <feComponentTransfer>
        <feFuncR type="linear" slope=".8" />
        <feFuncG type="linear" slope=".8" />
        <feFuncB type="linear" slope=".6" />
      </feComponentTransfer>
      <feComponentTransfer>
        <feFuncR type="linear" slope=".6" intercept="-(0.5 * .6) + 0.5" />
        <feFuncG type="linear" slope=".6" intercept="-(0.5 * .6) + 0.5" />
        <feFuncB type="linear" slope=".4" intercept="-(0.5 * .4) + 0.5" />
      </feComponentTransfer>
    </filter>
    <pattern id="shadedRelief" patternUnits="userSpaceOnUse" width="1600" height="1600">
      <image href="/Lee/battlebots/sprites/contour.png" />
    </pattern>
    <linearGradient id="radar" gradientTransform="rotate(90)">
      <stop offset="0" stopColor="white" stopOpacity=".1" />
      <stop offset="1" stopColor="white" stopOpacity="0" />
    </linearGradient>
  </defs>
))

const Crater = React.memo((props: any) => (
  <g name="crater">
    <image
      href={'/Lee/battlebots/sprites/oilSpill_small.png'}
      height="46"
      width="16"
      opacity=".25"
      transform={[
        'translate(' + props.x + ',' + props.y + ')',
        'rotate(180)',
        'rotate(' + props.orientation + ')',
        'translate(-6, -32)',
      ].join(' ')}
    />
  </g>
))

const drawExplosions = apps =>
  apps.map((app, appIndex) =>
    app.tanks.map((tank, tankIndex) =>
      tank.bullets
        .filter(bullet => bullet.exploded)
        .map((bullet, bulletIndex) => {
          bullet.animation = (bullet.animation || 0) + 1
          return (
            <g key={bullet.id}>
              {bullet.animation > 5 ? null : (
                <image
                  key={bulletIndex}
                  href={`/Lee/battlebots/sprites/explosion${bullet.animation}.png`}
                  height="64"
                  width="64"
                  opacity=".75"
                  transform={[
                    'translate(' + bullet.x + ',' + bullet.y + ')',
                    'rotate(180)',
                    'rotate(' + bullet.orientation + ')',
                    'translate(-32, -48)',
                  ].join(' ')}
                />
              )}
            </g>
          )
        }),
    ),
  )

class Terrain extends React.PureComponent<
  {
    terrain: any
  },
  {}
> {
  constructor(props: any) {
    super(props)
  }

  render() {
    return (
      <g>
        {this.props.terrain.map((column, index) => (
          <g key={index}>{column}</g>
        ))}
      </g>
    )
  }
}

export default class Arena extends React.Component<
  {
    darkMode: boolean
    apps: TankApp[]
  },
  {
    terrain: any[] | null
  }
> {
  constructor(props: any) {
    super(props)

    this.state = { terrain: null }
  }

  componentDidMount() {
    this.setState({ terrain: generateTerrain() })
  }

  render() {
    const apps = this.props.apps
    if (!this.state.terrain) return <></>
    return (
      <>
        <ArenaStyle />
        <g filter={this.props.darkMode ? 'url(#darkMode)' : undefined}>
          <Terrain terrain={this.state.terrain[0]} />
          <g name="craters">
            {apps.map((app, appIndex) =>
              app.tanks.map((tank, tankIndex) =>
                tank.bullets
                  .filter(bullet => bullet.exploded)
                  .map((bullet, bulletIndex) => (
                    <Crater
                      key={bullet.id}
                      x={bullet.x}
                      y={bullet.y}
                      orientation={bullet.orientation}
                    />
                  )),
              ),
            )}
          </g>
          <g name="paths">{drawPaths(apps)}</g>
          <g name="deadTanks">
            {apps.map((app, appIndex) =>
              app.tanks.map((tank, tankIndex) =>
                tank.health <= 0 ? (
                  <Tank
                    tankIndex={tankIndex}
                    tankName={app.name}
                    appIndex={appIndex}
                    x={tank.x}
                    y={tank.y}
                    health={tank.health}
                    bodyOrientation={tank.bodyOrientation}
                    turretOrientation={tank.turretOrientation}
                    radarOrientation={tank.radarOrientation}
                  />
                ) : null,
              ),
            )}
          </g>
          <g name="tanks">
            {apps.map((app, appIndex) =>
              app.tanks.map((tank, tankIndex) =>
                tank.health > 0 ? (
                  <>
                    <Tank
                      key={tankIndex}
                      tankIndex={tankIndex}
                      appIndex={appIndex}
                      x={tank.x}
                      y={tank.y}
                      health={tank.health}
                      bodyOrientation={tank.bodyOrientation}
                      turretOrientation={tank.turretOrientation}
                      radarOrientation={tank.radarOrientation}
                      radarOn={tank.radarOn}
                    />
                    <Link href={`/app/${appIndex}/logs`}>
                      <a>
                        <OverlayTrigger
                          trigger={['hover', 'focus']}
                          placement="auto"
                          overlay={drawTankPopover(app.name, appIndex, tank, tankIndex)}
                        >
                          <rect
                            style={{ cursor: 'pointer' }}
                            opacity={0}
                            height="32"
                            width="32"
                            transform={[
                              'translate(' + tank.x + ',' + tank.y + ')',
                              'rotate(' + tank.bodyOrientation + ')',
                              'translate(-16, -16)',
                            ].join(' ')}
                          />
                        </OverlayTrigger>
                      </a>
                    </Link>{' '}
                  </>
                ) : null,
              ),
            )}
          </g>
          <g name="bullets">
            {apps.map((app, appIndex) =>
              app.tanks.map((tank, tankIndex) =>
                tank.bullets
                  .filter(bullet => !bullet.exploded)
                  .map((bullet, bulletIndex) => (
                    <Bullet
                      id={bullet.id}
                      x={bullet.x}
                      y={bullet.y}
                      orientation={bullet.orientation}
                      appIndex={appIndex}
                    />
                  )),
              ),
            )}
          </g>
          <g name="explosions">{drawExplosions(apps)}</g>
          <Terrain terrain={this.state.terrain[1]} />
        </g>
        ))
      </>
    )
  }
}
