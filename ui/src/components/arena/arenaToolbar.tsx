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
  FaVectorSquare,
  FaStepForward,
} from 'react-icons/fa';

import { useDebugMode, toggleDebugMode } from '../../util/debugMode';

interface EditorToolbarProps {
  isPaused: boolean;
  doPause: React.MouseEventHandler<HTMLElement>;
  doResume: React.MouseEventHandler<HTMLElement>;
  doRestart: React.MouseEventHandler<HTMLElement>;
  // Advance the paused sim by one tick — the debug view's step control. Shown
  // only in debug mode while paused (stepping frame by frame to inspect state).
  doStep?: React.MouseEventHandler<HTMLElement>;
  // Copy a public /watch/:arenaId link to the clipboard. Absent until the arena
  // snapshot (which carries the arena id) has loaded.
  doShare?: React.MouseEventHandler<HTMLElement>;
}

export default function EditorToolbar(props: EditorToolbarProps) {
  // The share tooltip is controlled so a click can dismiss it: on hover it would
  // otherwise stay up (the cursor is still over the button) and cover the "copied"
  // toast that appears just below the toolbar. Hover still opens it normally.
  const [showShareTip, setShowShareTip] = useState(false);
  // Debug view is a whole-arena preference held in its own store (like the theme
  // toggle), so this button reads/flips it directly rather than via props.
  const debugMode = useDebugMode();
  return (
    <>
      <ButtonToolbar style={{ justifyContent: 'flex-end' }}>
        <ButtonGroup className="arena-toolbar" style={{ marginRight: '5px' }}>
          {props.isPaused && (
            <OverlayTrigger
              placement={'bottom'}
              overlay={<Tooltip id={`resume`}>Resume</Tooltip>}
            >
              <Button
                variant="secondary"
                aria-label="Resume"
                onClick={props.doResume}
                style={{ color: 'var(--accent)' }}
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
                aria-label="Pause"
                onClick={props.doPause}
              >
                <FaPauseCircle />
              </Button>
            </OverlayTrigger>
          )}

          {debugMode && props.isPaused && props.doStep && (
            <OverlayTrigger
              placement={'bottom'}
              overlay={<Tooltip id={`step`}>Step one tick</Tooltip>}
            >
              <Button
                variant="secondary"
                aria-label="Step one tick"
                onClick={props.doStep}
              >
                <FaStepForward />
              </Button>
            </OverlayTrigger>
          )}

          <OverlayTrigger
            placement={'bottom'}
            overlay={<Tooltip id={`reset`}>Reset</Tooltip>}
          >
            <Button
              variant="secondary"
              aria-label="Reset"
              onClick={props.doRestart}
            >
              <FaSyncAlt />
            </Button>
          </OverlayTrigger>

          <OverlayTrigger
            placement={'bottom'}
            overlay={<Tooltip id={`debug`}>Debug view</Tooltip>}
          >
            <Button
              variant="secondary"
              aria-label="Debug view"
              aria-pressed={debugMode}
              onClick={() => toggleDebugMode()}
              style={{ color: debugMode ? 'var(--accent)' : undefined }}
            >
              <FaVectorSquare />
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
                aria-label="Copy public watch link"
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
