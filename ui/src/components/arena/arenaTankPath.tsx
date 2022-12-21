import React from 'react'
import Tank from '../../types/tank'
import PointInTime from '../../types/pointInTime'

interface TankPathProps {
    id: string
    path: PointInTime[]
    pathIndex: number
    x: number
    y: number
}

const TankPathSvg = (props: TankPathProps) => {
    return (
        props.path && (
            <g name="path" key={props.id}>
                {[
                    ...props.path
                        .filter((a) => a.x && a.y)
                        .sort((a, b) => a.time - b.time),
                    { x: props.x, y: props.y },
                ].map((point, pointIndex, points) => {
                    const next = points[pointIndex + 1]
                    if (!next) return null

                    const distance = Math.sqrt(
                        Math.pow(next.x - point.x, 2) +
                            Math.pow(next.y - point.y, 2)
                    )

                    if (distance < 5) return null
                    const angle: number =
                        Math.atan2(point.y - next.y, point.x - next.x) *
                            (180 / Math.PI) -
                        90

                    return (
                        <rect
                            key={pointIndex}
                            opacity={
                                0.45 - (1 - pointIndex / points.length) * 0.45
                            }
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
        )
    )
}

export default TankPathSvg
