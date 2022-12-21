import React from 'react'
import Bullet from '../../types/bullet'

interface CraterProps {
    id: string
    x: number
    y: number
    orientation: number
}

const CraterSvg = React.memo((props: CraterProps) => (
    <g key={props.id} name="crater">
        <image
            href={'/sprites/oilSpill_small.png'}
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

export default CraterSvg
