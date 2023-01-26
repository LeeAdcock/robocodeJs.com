import React from 'react'

import Arena from '../../types/arena'

import CraterSvg from './arenaCrater'
import TerrainSvg from './arenaTerrain'
import BulletSvg from './arenaBullet'
import TankSvg from './arenaTank'
import TankPathSvg from './arenaTankPath'

const ArenaStyle = React.memo((props: {width:number, height:number}) => (
    <defs>
        <clipPath id="trim-extra">
            <rect x="0" y="0" width={props.width || 750} height={props.height || 750} />
        </clipPath>
        <pattern
            id="grass"
            width="32"
            height="32"
            patternUnits="userSpaceOnUse"
        >
            <image href={'/sprites/tileGrass1.png'} height="32" width="32" />
        </pattern>
        <pattern
            id="ocean"
            width="32"
            height="32"
            patternUnits="userSpaceOnUse"
        >
            <image href={'/sprites/ocean.png'} height="32" width="32" />
        </pattern>
        <pattern id="sand" width="32" height="32" patternUnits="userSpaceOnUse">
            <image href={'/sprites/tileSand1.png'} height="32" width="32" />
        </pattern>
        <pattern
            id="tracks"
            patternUnits="userSpaceOnUse"
            width="32"
            height="32"
        >
            <image
                href="/sprites/tracksLarge.png"
                x="0"
                y="0"
                width="32"
                height="32"
            />
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
                <feFuncR
                    type="linear"
                    slope=".6"
                    intercept="-(0.5 * .6) + 0.5"
                />
                <feFuncG
                    type="linear"
                    slope=".6"
                    intercept="-(0.5 * .6) + 0.5"
                />
                <feFuncB
                    type="linear"
                    slope=".4"
                    intercept="-(0.5 * .4) + 0.5"
                />
            </feComponentTransfer>
        </filter>
        <filter id='shadow' color-interpolation-filters="sRGB">
            <feDropShadow dx="0" dy="0" stdDeviation="3" flood-opacity="0.5"/>
        </filter>       
        <pattern
            id="shadedRelief"
            patternUnits="userSpaceOnUse"
            width="1600"
            height="1600"
        >
            <image href="/sprites/contour.jpg" />
        </pattern>
        <linearGradient id="radar" gradientTransform="rotate(90)">
            <stop offset="0" stopColor="white" stopOpacity=".1" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
    </defs>
))

interface ArenaSvgProps {
    arena: Arena
    darkMode: boolean
    time: number
}

export default function ArenaSvg(props: ArenaSvgProps) {
    const apps = props.arena.apps
    return (
        <svg
            width="100%"
            height="100%"
            viewBox="-10 -10 770 770"
            preserveAspectRatio="xMidYMid meet"
            xmlns="http://www.w3.org/2000/svg"
            style={{
                border: '2px solid rgb(33,37,41)',
            }}
        >
            <ArenaStyle width={props.arena.width} height={props.arena.height}/>
            <rect
                x="-100%"
                y="-100%"
                height="300%"
                width="300%"
                fill="url(#ocean)"
            />
            <g
                clipPath="url(#trim-extra)"
                filter={props.darkMode ? 'url(#darkMode)' : undefined}
            >
                <TerrainSvg>
                    <g name="craters">
                        {apps.map((app) =>
                            app.tanks.map((tank) =>
                                tank.bullets
                                    .filter((bullet) => bullet.explodedAt)
                                    .map((bullet) => (
                                        <CraterSvg
                                            key={bullet.id}
                                            id={bullet.id}
                                            x={bullet.x}
                                            y={bullet.y}
                                            orientation={bullet.orientation}
                                        />
                                    ))
                            )
                        )}
                    </g>
                    <g name="paths">
                        {apps.map((app) =>
                            app.tanks.map((tank) => (
                                <TankPathSvg
                                    id={tank.id}
                                    key={tank.id}
                                    path={tank.path}
                                    pathIndex={tank.pathIndex}
                                    x={tank.x}
                                    y={tank.y}
                                />
                            ))
                        )}
                    </g>
                    <g name="tanks">
                        {apps.map((app) => {
                            const appIndex =
                                props.arena?.apps
                                    .map((app) => app.id)
                                    .indexOf(app.id) || 0 //todo
                            return app.tanks.map((tank, tankIndex) => {
                                return tank.health <= 0 ? (
                                    <TankSvg
                                        key={tank.id}
                                        tankIndex={tankIndex}
                                        appIndex={appIndex}
                                        appName={app.name}
                                        id={tank.id}
                                        health={tank.health}
                                        bodyOrientation={tank.bodyOrientation}
                                        turretOrientation={
                                            tank.turretOrientation
                                        }
                                        radarOrientation={tank.radarOrientation}
                                        x={tank.x}
                                        y={tank.y}
                                        radarOn={false}
                                    />
                                ) : null
                            })
                        })}
                        {apps.map((app) => {
                            const appIndex =
                                props.arena?.apps
                                    .map((app) => app.id)
                                    .indexOf(app.id) || 0 //todo
                            return app.tanks.map((tank, tankIndex) =>
                                tank.health > 0 ? (
                                    <TankSvg
                                        key={tank.id}
                                        tankIndex={tankIndex}
                                        appIndex={appIndex}
                                        appName={app.name}
                                        id={tank.id}
                                        health={tank.health}
                                        bodyOrientation={tank.bodyOrientation}
                                        turretOrientation={
                                            tank.turretOrientation
                                        }
                                        radarOrientation={tank.radarOrientation}
                                        x={tank.x}
                                        y={tank.y}
                                        radarOn={tank.radarOn}
                                    />
                                ) : null
                            )
                        })}
                    </g>
                    <g name="bullets">
                        {apps.map((app, appIndex) =>
                            app.tanks.map((tank) => (
                                <g key={tank.id}>
                                    {tank.bullets
                                        .filter((bullet) => !bullet.explodedAt)
                                        .map((bullet) => (
                                            <BulletSvg
                                                key={bullet.id}
                                                appIndex={appIndex}
                                                id={bullet.id}
                                                x={bullet.x}
                                                y={bullet.y}
                                                orientation={bullet.orientation}
                                            />
                                        ))}
                                </g>
                            ))
                        )}
                    </g>
                </TerrainSvg>
            </g>
        </svg>
    )
}
