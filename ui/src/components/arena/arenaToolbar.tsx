import React, { useState } from 'react';
import Button from 'react-bootstrap/Button';
import ButtonGroup from 'react-bootstrap/ButtonGroup';
import ButtonToolbar from 'react-bootstrap/ButtonToolbar';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';

import {
  FaSyncAlt,
  FaPauseCircle,
  FaPlayCircle,
  FaShareAlt,
} from 'react-icons/fa';

interface EditorToolbarProps {
  isPaused: boolean;
  doPause: React.MouseEventHandler<HTMLElement>;
  doResume: React.MouseEventHandler<HTMLElement>;
  doRestart: React.MouseEventHandler<HTMLElement>;
  // Copy a public /watch/:arenaId link to the clipboard. Absent until the arena
  // snapshot (which carries the arena id) has loaded.
  doShare?: React.MouseEventHandler<HTMLElement>;
}

export default function EditorToolbar(props: EditorToolbarProps) {
  // The share tooltip is controlled so a click can dismiss it: on hover it would
  // otherwise stay up (the cursor is still over the button) and cover the "copied"
  // toast that appears just below the toolbar. Hover still opens it normally.
  const [showShareTip, setShowShareTip] = useState(false);
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
              <Button variant="secondary" size="sm" onClick={props.doPause}>
                <FaPauseCircle />
              </Button>
            </OverlayTrigger>
          )}

          <OverlayTrigger
            placement={'bottom'}
            overlay={<Tooltip id={`reset`}>Reset</Tooltip>}
          >
            <Button variant="secondary" size="sm" onClick={props.doRestart}>
              <FaSyncAlt />
            </Button>
          </OverlayTrigger>

          {props.doShare && (
            <OverlayTrigger
              placement={'bottom'}
              show={showShareTip}
              onToggle={(next) => setShowShareTip(next)}
              overlay={<Tooltip id={`share`}>Copy public watch link</Tooltip>}
            >
              <Button
                variant="secondary"
                size="sm"
                onClick={(e) => {
                  // Dismiss the tooltip so it doesn't overlap the "copied" toast;
                  // it reopens on the next hover.
                  setShowShareTip(false);
                  props.doShare?.(e);
                }}
              >
                <FaShareAlt />
              </Button>
            </OverlayTrigger>
          )}
        </ButtonGroup>
      </ButtonToolbar>
    </>
  );
}
