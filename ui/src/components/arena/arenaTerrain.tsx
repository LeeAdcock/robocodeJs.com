import { generateTerrain } from '../../util/terraformer'
import { useState } from 'react'
import React from 'react'

interface TerrainProps {
    children: any
}

interface TerrainLayerProps {
    tiles: any[]
}
const TerrainLayer = React.memo((props: TerrainLayerProps) => (
    <g>
        {props.tiles.map((column, index) => (
            <g key={index}>{column}</g>
        ))}
    </g>
))

const TerrainSvg = (props: TerrainProps) => {
    const [terrain, setTerrain] = useState(generateTerrain())

    return (
        <>
            <TerrainLayer tiles={terrain[0]} />
            <g>{props.children}</g>
            <TerrainLayer tiles={terrain[1]} />
        </>
    )
}

export default TerrainSvg
