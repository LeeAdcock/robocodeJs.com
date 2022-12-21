import React from 'react'
import Button from 'react-bootstrap/Button'
import ButtonGroup from 'react-bootstrap/ButtonGroup'
import ButtonToolbar from 'react-bootstrap/ButtonToolbar'
import OverlayTrigger from 'react-bootstrap/OverlayTrigger'
import Tooltip from 'react-bootstrap/Tooltip'

import { FaSyncAlt, FaPauseCircle, FaPlayCircle } from 'react-icons/fa'

interface EditorToolbarProps {
    isPaused: boolean
    doPause: React.MouseEventHandler<any>
    doResume: React.MouseEventHandler<any>
    doRestart: React.MouseEventHandler<any>
}

export default function EditorToolbar(props: EditorToolbarProps) {
    return (
        <>
            <ButtonToolbar style={{ justifyContent: 'flex-end' }}>
                <ButtonGroup style={{ marginRight: '5px' }}>
                    {props.isPaused && (
                        <OverlayTrigger
                            placement={'bottom'}
                            overlay={<Tooltip id={`resume`}>Resume</Tooltip>}
                        >
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={props.doResume}
                                style={{ color: 'gold' }}
                            >
                                <FaPlayCircle />
                            </Button>
                        </OverlayTrigger>
                    )}
                    {!props.isPaused && (
                        <OverlayTrigger
                            placement={'bottom'}
                            overlay={<Tooltip id={`pause`}>Pause</Tooltip>}
                        >
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={props.doPause}
                            >
                                <FaPauseCircle />
                            </Button>
                        </OverlayTrigger>
                    )}

                    <OverlayTrigger
                        placement={'bottom'}
                        overlay={<Tooltip id={`reset`}>Reset</Tooltip>}
                    >
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={props.doRestart}
                        >
                            <FaSyncAlt />
                        </Button>
                    </OverlayTrigger>
                </ButtonGroup>
            </ButtonToolbar>
        </>
    )
}
