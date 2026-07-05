import React from 'react';
import Button from 'react-bootstrap/Button';
import ButtonGroup from 'react-bootstrap/ButtonGroup';
import ButtonToolbar from 'react-bootstrap/ButtonToolbar';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';

import {
  FaCode,
  FaCheck,
  FaDownload,
  FaTrash,
  FaSave,
  FaSearchMinus,
  FaSearchPlus,
  FaPowerOff,
} from 'react-icons/fa';

import { EDITOR_FONT_MIN, EDITOR_FONT_MAX } from './appEditor';

interface EditorToolbarProps {
  code: string;
  appName: string;
  doDelete: () => void;
  doClean: () => void;
  doCheck: () => void;
  doExecute: () => void;
  doReboot: () => void;
  fontSize: number;
  doZoomIn: () => void;
  doZoomOut: () => void;
  doZoomReset: () => void;
}

export default function EditorToolbar(props: EditorToolbarProps) {
  return (
    <>
      <ButtonToolbar style={{ justifyContent: 'flex-end' }}>
        <ButtonGroup style={{ marginRight: '5px' }}>
          <OverlayTrigger
            placement={'bottom'}
            overlay={<Tooltip id={`zoom-out`}>Smaller text (Ctrl--)</Tooltip>}
          >
            <Button
              variant="secondary"
              size="sm"
              aria-label="Smaller text"
              onClick={() => props.doZoomOut()}
              disabled={props.fontSize <= EDITOR_FONT_MIN}
            >
              <FaSearchMinus />
            </Button>
          </OverlayTrigger>
          <OverlayTrigger
            placement={'bottom'}
            overlay={
              <Tooltip id={`zoom-reset`}>Reset text size (Ctrl-0)</Tooltip>
            }
          >
            <Button
              variant="secondary"
              size="sm"
              aria-label="Reset text size"
              onClick={() => props.doZoomReset()}
              style={{ minWidth: '2.5em' }}
            >
              {props.fontSize}
            </Button>
          </OverlayTrigger>
          <OverlayTrigger
            placement={'bottom'}
            overlay={<Tooltip id={`zoom-in`}>Larger text (Ctrl-+)</Tooltip>}
          >
            <Button
              variant="secondary"
              size="sm"
              aria-label="Larger text"
              onClick={() => props.doZoomIn()}
              disabled={props.fontSize >= EDITOR_FONT_MAX}
            >
              <FaSearchPlus />
            </Button>
          </OverlayTrigger>
        </ButtonGroup>

        <ButtonGroup style={{ marginRight: '5px' }}>
          <OverlayTrigger
            placement={'bottom'}
            overlay={<Tooltip id={`save`}>Save (Ctrl-S)</Tooltip>}
          >
            <Button
              variant="secondary"
              size="sm"
              onClick={() => props.doExecute()}
            >
              <FaSave />
            </Button>
          </OverlayTrigger>
          <OverlayTrigger
            placement={'bottom'}
            overlay={<Tooltip id={`reformat`}>Reformat code (Ctrl-R)</Tooltip>}
          >
            <Button
              variant="secondary"
              size="sm"
              onClick={() => props.doClean()}
            >
              <FaCode />
            </Button>
          </OverlayTrigger>
          <OverlayTrigger
            placement={'bottom'}
            overlay={
              <Tooltip id={`check`}>
                Check for errors — dry-run compile without deploying
              </Tooltip>
            }
          >
            <Button
              variant="secondary"
              size="sm"
              aria-label="Check for errors"
              onClick={() => props.doCheck()}
            >
              <FaCheck />
            </Button>
          </OverlayTrigger>
          <OverlayTrigger
            placement={'bottom'}
            overlay={
              <Tooltip id={`reboot`}>
                Reboot — save, reload the code, and re-run the START handler
                (Ctrl-Shift-S)
              </Tooltip>
            }
          >
            <Button
              variant="secondary"
              size="sm"
              aria-label="Reboot bot"
              onClick={() => props.doReboot()}
            >
              <FaPowerOff />
            </Button>
          </OverlayTrigger>
        </ButtonGroup>

        <ButtonGroup>
          <OverlayTrigger
            placement={'bottom'}
            overlay={
              <Tooltip id={`delete-app`}>
                Destroy this application and its bots. Be careful!
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
                const link = document.createElement('a');
                link.download =
                  (props.appName || 'bot').replaceAll(' ', '') + '.js';
                link.href =
                  'data:text/javascript;charset=utf-8,' +
                  encodeURIComponent(props.code);
                link.click();
              }}
            >
              <FaDownload />
            </Button>
          </OverlayTrigger>
        </ButtonGroup>
      </ButtonToolbar>
    </>
  );
}
