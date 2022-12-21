import React from 'react'
import Button from 'react-bootstrap/Button'
import ButtonGroup from 'react-bootstrap/ButtonGroup'
import ButtonToolbar from 'react-bootstrap/ButtonToolbar'
import OverlayTrigger from 'react-bootstrap/OverlayTrigger'
import Tooltip from 'react-bootstrap/Tooltip'

import { FaCode, FaDownload, FaTrash, FaSave, FaPlay } from 'react-icons/fa'

interface EditorToolbarProps {
    code: string
    appName: string
    doSave: Function
    doDelete: Function
    doClean: Function
    doExecute: Function
}

export default function EditorToolbar(props: EditorToolbarProps) {
    return (
        <>
            <ButtonToolbar style={{ justifyContent: 'flex-end' }}>
                <ButtonGroup style={{ marginRight: '5px' }}>
                    <OverlayTrigger
                        placement={'bottom'}
                        overlay={
                            <Tooltip id={`reformat`}>
                                Save code (Ctrl-S)
                            </Tooltip>
                        }
                    >
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => props.doSave()}
                        >
                            <FaSave />
                        </Button>
                    </OverlayTrigger>
                    <OverlayTrigger
                        placement={'bottom'}
                        overlay={
                            <Tooltip id={`reformat`}>
                                Execute code (Ctrl-Space)
                            </Tooltip>
                        }
                    >
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => props.doExecute()}
                        >
                            <FaPlay />
                        </Button>
                    </OverlayTrigger>
                    <OverlayTrigger
                        placement={'bottom'}
                        overlay={
                            <Tooltip id={`reformat`}>
                                Reformat code (Ctrl-R)
                            </Tooltip>
                        }
                    >
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => props.doClean()}
                        >
                            <FaCode />
                        </Button>
                    </OverlayTrigger>
                </ButtonGroup>

                <ButtonGroup>
                    <OverlayTrigger
                        placement={'bottom'}
                        overlay={
                            <Tooltip id={`delete-app`}>
                                Detroy this application and its bots. Be
                                careful!
                            </Tooltip>
                        }
                    >
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => props.doDelete()}
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
                            onClick={() => {
                                const link = document.createElement('a')
                                link.download =
                                    (props.appName || 'bot').replaceAll(
                                        ' ',
                                        ''
                                    ) + '.js'
                                link.href =
                                    'data:text/javascript;charset=utf-8,' +
                                    encodeURIComponent(props.code)
                                link.click()
                            }}
                        >
                            <FaDownload />
                        </Button>
                    </OverlayTrigger>
                </ButtonGroup>
            </ButtonToolbar>
        </>
    )
}
