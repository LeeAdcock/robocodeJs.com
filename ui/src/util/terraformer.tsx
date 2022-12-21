import React from 'react'
import OverlayTrigger from 'react-bootstrap/OverlayTrigger'
import Tooltip from 'react-bootstrap/Tooltip'

const seed = Math.floor(Math.random() * 10)

/*
  These functions build the randomized terrain for the arena. The resulting output
  is an array containing both a list of foreground svg sprites and a list of background
  svg sprites. These are consumed by the arena component and written directly to the
  screen.
*/

const roadBuilderVert = (terrain, x, y, oldX, oldY, direction, isSand) => {
    if (x < 0 || y < 0 || x >= terrain[0].length || y >= terrain[0][0].length)
        return
    const isStraight = Math.random() > 0.2
    let newX = x
    let newY = y
    const isSandTransition = isSand(oldX, oldY) !== isSand(x, y)
    if (isSandTransition || isStraight) {
        newY = y + direction
        if (terrain[0]?.[newX]?.[newY])
            return roadBuilderVert(terrain, x, y, oldX, oldY, direction, isSand)
        if (oldY + direction === y)
            terrain[0][x][y] = (
                <image
                    href={`/sprites/tile${
                        isSand(x, y) && !isSandTransition ? 'Sand' : 'Grass'
                    }_${
                        isSandTransition ? 'roadTransitionS_dirt' : 'roadNorth'
                    }.png`}
                    x={32 * x}
                    y={32 * y}
                    height={32}
                    width={32}
                />
            )
        if (oldX + 1 === x)
            terrain[0][x][y] = (
                <image
                    href={
                        direction === 1
                            ? `/sprites/tile${
                                  isSand(x, y) ? 'Sand' : 'Grass'
                              }_roadCornerLL.png`
                            : `/sprites/tile${
                                  isSand(x, y) ? 'Sand' : 'Grass'
                              }_roadCornerUL.png`
                    }
                    x={32 * x}
                    y={32 * y}
                    height={32}
                    width={32}
                />
            )
        if (oldX - 1 === x)
            terrain[0][x][y] = (
                <image
                    href={
                        direction === 1
                            ? `/sprites/tile${
                                  isSand(x, y) ? 'Sand' : 'Grass'
                              }_roadCornerLR.png`
                            : `/sprites/tile${
                                  isSand(x, y) ? 'Sand' : 'Grass'
                              }_roadCornerUR.png`
                    }
                    x={32 * x}
                    y={32 * y}
                    height={32}
                    width={32}
                />
            )
    } else if (Math.random() > 0.5) {
        newX = x + 1
        if (terrain[0]?.[newX]?.[newY])
            return roadBuilderVert(terrain, x, y, oldX, oldY, direction, isSand)
        if (oldY + direction === y)
            terrain[0][x][y] = (
                <image
                    href={
                        direction === 1
                            ? `/sprites/tile${
                                  isSand(x, y) ? 'Sand' : 'Grass'
                              }_roadCornerUR.png`
                            : `/sprites/tile${
                                  isSand(x, y) ? 'Sand' : 'Grass'
                              }_roadCornerLR.png`
                    }
                    x={32 * x}
                    y={32 * y}
                    height={32}
                    width={32}
                />
            )
        if (oldX + 1 === x)
            terrain[0][x][y] = (
                <image
                    href={`/sprites/tile${
                        isSand(x, y) ? 'Sand' : 'Grass'
                    }_roadEast.png`}
                    x={32 * x}
                    y={32 * y}
                    height={32}
                    width={32}
                />
            )
        if (oldX === newX)
            return roadBuilderVert(terrain, x, y, oldX, oldY, direction, isSand)
    } else {
        newX = x - 1
        if (terrain[0]?.[newX]?.[newY])
            return roadBuilderVert(terrain, x, y, oldX, oldY, direction, isSand)
        if (oldY + direction === y)
            terrain[0][x][y] = (
                <image
                    href={
                        direction === 1
                            ? `/sprites/tile${
                                  isSand(x, y) ? 'Sand' : 'Grass'
                              }_roadCornerUL.png`
                            : `/sprites/tile${
                                  isSand(x, y) ? 'Sand' : 'Grass'
                              }_roadCornerLL.png`
                    }
                    x={32 * x}
                    y={32 * y}
                    height={32}
                    width={32}
                />
            )
        if (oldX - 1 === x)
            terrain[0][x][y] = (
                <image
                    href={`/sprites/tile${
                        isSand(x, y) ? 'Sand' : 'Grass'
                    }_roadEast.png`}
                    x={32 * x}
                    y={32 * y}
                    height={32}
                    width={32}
                />
            )
        if (oldX === newX)
            return roadBuilderVert(terrain, x, y, oldX, oldY, direction, isSand)
    }

    roadBuilderVert(terrain, newX, newY, x, y, direction, isSand)
}

const roadBuilderHoriz = (terrain, x, y, oldX, oldY, isSand) => {
    if (x < 0 || y < 0 || x >= terrain[0].length || y >= terrain[0][0].length)
        return
    const isStayStraight = Math.random() > 0.2
    let newX = x
    let newY = y
    const isSandTransition = isSand(oldX, oldY) !== isSand(x, y)
    if (isSandTransition || isStayStraight) {
        newX = x + 1
        if (terrain[0]?.[newX]?.[newY])
            return roadBuilderHoriz(terrain, x, y, oldX, oldY, isSand)
        if (oldX + 1 === x) {
            terrain[0][x][y] = (
                <image
                    href={`/sprites/tile${
                        isSand(x, y) && !isSandTransition ? 'Sand' : 'Grass'
                    }_${
                        isSandTransition ? 'roadTransitionE_dirt' : 'roadEast'
                    }.png`}
                    x={32 * x}
                    y={32 * y}
                    height={32}
                    width={32}
                />
            )
            if (!isSandTransition && (x + seed) % 10 === 8) {
                // Create an intersection with a vertical road
                if (Math.random() > 0.5) {
                    terrain[0][x][y] = (
                        <image
                            href={`/sprites/tile${
                                isSand(x, y) ? 'Sand' : 'Grass'
                            }_roadSplitN.png`}
                            x={32 * x}
                            y={32 * y}
                            height={32}
                            width={32}
                        />
                    )
                    roadBuilderVert(terrain, x, y - 1, x, y, -1, isSand)
                } else {
                    terrain[0][x][y] = (
                        <image
                            href={`/sprites/tile${
                                isSand(x, y) ? 'Sand' : 'Grass'
                            }_roadSplitS.png`}
                            x={32 * x}
                            y={32 * y}
                            height={32}
                            width={32}
                        />
                    )
                    roadBuilderVert(terrain, x, y + 1, x, y, 1, isSand)
                }
            }
        }
        if (oldY + 1 === y)
            terrain[0][x][y] = (
                <image
                    href={`/sprites/tile${
                        isSand(x, y) ? 'Sand' : 'Grass'
                    }_roadCornerUR.png`}
                    x={32 * x}
                    y={32 * y}
                    height={32}
                    width={32}
                />
            )
        if (oldY - 1 === y)
            terrain[0][x][y] = (
                <image
                    href={`/sprites/tile${
                        isSand(x, y) ? 'Sand' : 'Grass'
                    }_roadCornerLR.png`}
                    x={32 * x}
                    y={32 * y}
                    height={32}
                    width={32}
                />
            )
    } else if (Math.random() > 0.5) {
        newY = y + 1
        if (terrain[0]?.[newX]?.[newY])
            return roadBuilderHoriz(terrain, x, y, oldX, oldY, isSand)
        if (oldX + 1 === x)
            terrain[0][x][y] = (
                <image
                    href={`/sprites/tile${
                        isSand(x, y) ? 'Sand' : 'Grass'
                    }_roadCornerLL.png`}
                    x={32 * x}
                    y={32 * y}
                    height={32}
                    width={32}
                />
            )
        if (oldY + 1 === y)
            terrain[0][x][y] = (
                <image
                    href={`/sprites/tile${
                        isSand(x, y) ? 'Sand' : 'Grass'
                    }_roadNorth.png`}
                    x={32 * x}
                    y={32 * y}
                    height={32}
                    width={32}
                />
            )
        if (oldY === newY)
            return roadBuilderHoriz(terrain, x, y, oldX, oldY, isSand)
    } else {
        newY = y - 1
        if (terrain[0][newX][newY])
            return roadBuilderHoriz(terrain, x, y, oldX, oldY, isSand)
        if (oldY - 1 === y)
            terrain[0][x][y] = (
                <image
                    href={`/sprites/tile${
                        isSand(x, y) ? 'Sand' : 'Grass'
                    }_roadNorth.png`}
                    x={32 * x}
                    y={32 * y}
                    height={32}
                    width={32}
                />
            )
        if (oldX + 1 === x)
            terrain[0][x][y] = (
                <image
                    href={`/sprites/tile${
                        isSand(x, y) ? 'Sand' : 'Grass'
                    }_roadCornerUL.png`}
                    x={32 * x}
                    y={32 * y}
                    height={32}
                    width={32}
                />
            )
        // TODO fix this
        // if (oldY === oldY) return roadBuilderHoriz(terrain, x, y, oldX, oldY, isSand)
    }

    roadBuilderHoriz(terrain, newX, newY, x, y, isSand)
}

const treePlanter = (x, y, isDead) => {
    const treeTypes = [
        'Oak',
        'Poplar',
        'Pine',
        'Maple',
        'Fir',
        'Chestnut',
        'Magnolia',
    ]
    const treeType = treeTypes[Math.floor(Math.random() * treeTypes.length)]

    return (
        <OverlayTrigger
            placement={'bottom'}
            overlay={
                <Tooltip id={'tree' + x + y}>
                    {isDead ? 'Dead' : ''} {treeType} Tree
                </Tooltip>
            }
        >
            <image
                opacity={0.75}
                href={`/sprites/tree${isDead ? 'Brown' : 'Green'}_small.png`}
                transform={[
                    'translate(' + 32 * x + ',' + 32 * y + ')',
                    'translate(16,16)',
                    'rotate(' + Math.floor(Math.random() * 180) + ')',
                    'translate(-16,-16)',
                ].join(' ')}
                height={32 + Math.floor(Math.random() * 32)}
                width={32 + Math.floor(Math.random() * 32)}
            />
        </OverlayTrigger>
    )
}

const forestPlanter = (terrain, forestX, forestY, isSand) => {
    for (let i = 0; i < 15; i++) {
        const treeX = forestX + Math.floor(Math.random() * 8) - 4
        const treeY = forestY + Math.floor(Math.random() * 8) - 4
        if (
            !(
                treeX < 0 ||
                treeY < 0 ||
                treeX >= terrain[1].length - 1 ||
                treeY >= terrain[1][0].length - 1
            ) &&
            !terrain[0][treeX][treeY] &&
            !terrain[1][treeX][treeY]
        ) {
            terrain[1][treeX][treeY] = treePlanter(
                treeX,
                treeY,
                isSand(treeX, treeY)
            )
        }
    }
    for (let i = 0; i < 5; i++) {
        const treeX = forestX + Math.floor(Math.random() * 16) - 4
        const treeY = forestY + Math.floor(Math.random() * 16) - 4
        if (
            !(
                treeX < 0 ||
                treeY < 0 ||
                treeX >= terrain[1].length - 1 ||
                treeY >= terrain[1][0].length - 1
            ) &&
            !terrain[0][treeX][treeY]
        ) {
            terrain[1][treeX][treeY] = treePlanter(
                treeX,
                treeY,
                isSand(treeX, treeY)
            )
        }
    }
}

const sander = (terrain, isSandHorizontal, sandX, sandY) => {
    if (isSandHorizontal) {
        for (let i = 0; i <= 2; i++) {
            sandY = Math.floor(Math.random() * 20)
            if (!terrain[0][sandX][sandY])
                terrain[0][sandX][sandY] = (
                    <image
                        href={'/sprites/tileGrass_transitionE.png'}
                        x={sandX * 32 + 'px'}
                        y={sandY * 32 + 'px'}
                        height={32}
                        width={32}
                    />
                )
        }
    } else {
        for (let i = 0; i <= 2; i++) {
            sandX = Math.floor(Math.random() * 20)
            if (!terrain[0][sandX][sandY])
                terrain[0][sandX][sandY] = (
                    <image
                        href={'/sprites/tileGrass_transitionS.png'}
                        x={sandX * 32 + 'px'}
                        y={sandY * 32 + 'px'}
                        height={32}
                        width={32}
                    />
                )
        }
    }
}

const generateTerrain = () => {
    // Build an empty 3d data structure
    // terrain[0][x][y] are things below the tanks
    // terrain[1][x][y] are things above the tanks
    const terrain = new Array(2)
    for (let i = 0; i < 2; i++) {
        terrain[i] = new Array(30)
        for (let x = 0; x < 40; x++) {
            terrain[i][x] = new Array(30)
            for (let y = 0; y < 40; y++) terrain[i][x][y] = null
        }
    }

    // Create sand transitions
    const isSandHorizontal = Math.random() > 0.5
    const sandX = Math.floor(Math.random() * 20)
    const sandY = Math.floor(Math.random() * 20)
    sander(terrain, isSandHorizontal, sandX, sandY)
    const isSand = (x, y) => (isSandHorizontal ? x > sandX : y > sandY)

    // Create roads
    try {
        roadBuilderHoriz(
            terrain,
            0,
            Math.floor(Math.random() * 20),
            -1,
            0,
            isSand
        )
    } catch (e) {
        // Sometimes gets throws a maximum stack size exceeded exception
    }

    // Create a forest
    for (let i = 0; i < Math.random() * 3; i++) {
        const forestX = Math.floor(Math.random() * 20)
        const forestY = Math.floor(Math.random() * 20)
        forestPlanter(terrain, forestX, forestY, isSand)
    }

    // Flatten the data structure to a list of sprites
    terrain[0] = terrain[0]
        .reduce((prev, cur) => [...prev, ...cur], [])
        .filter((e) => e)
    terrain[1] = terrain[1]
        .reduce((prev, cur) => [...prev, ...cur], [])
        .filter((e) => e)

    // Add some shaded contours
    terrain[0].unshift(
        <rect
            opacity=".05"
            height="100%"
            width="100%"
            fill="url(#shadedRelief)"
        />
    )

    // Build the sand region
    terrain[0].unshift(
        <rect
            height="100%"
            width="100%"
            x={(isSandHorizontal ? sandX * 32 + 16 : 0) + 'px'}
            y={(isSandHorizontal ? 0 : sandY * 32 + 16) + 'px'}
            fill="url(#sand)"
        />
    )

    // A background of grass under everything else
    terrain[0].unshift(<rect height="100%" width="100%" fill="url(#grass)" />)

    return terrain
}

export { generateTerrain }
