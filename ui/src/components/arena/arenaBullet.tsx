import React from 'react'
import { colors } from '../../util/colors'
import Bullet from '../../types/bullet'

interface BulletProps {
    appIndex: number

    id: string
    x: number
    y: number
    orientation: number
}

const BulletSvg = React.memo((props: BulletProps) => (
    <g key={props.id} name="bullet">
        <image
            href={'/sprites/shotLarge.png'}
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
                '/sprites/bullet' +
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

export default BulletSvg
