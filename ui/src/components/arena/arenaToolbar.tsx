import React, { useState } from 'react';
import Button from 'react-bootstrap/Button';
import ButtonGroup from 'react-bootstrap/ButtonGroup';
import ButtonToolbar from 'react-bootstrap/ButtonToolbar';
import Dropdown from 'react-bootstrap/Dropdown';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';

import {
  FaSyncAlt,
  FaPauseCircle,
  FaPlayCircle,
  FaRobot,
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
  // Advance the paused sim by one tick — a general control shown whenever the
  // arena is paused (stepping frame by frame to inspect state, in any view).
  doStep?: React.MouseEventHandler<HTMLElement>;
  // Copy a public /watch/:arenaId link to the clipboard. Absent until the arena
  // snapshot (which carries the arena id) has loaded.
  doShare?: React.MouseEventHandler<HTMLElement>;
  // Current per-app bot quantity (1–5) and its setter. The quantity dropdown
  // only renders when a handler is provided (owner views).
  botCount?: number;
  doSetBotCount?: (count: number) => void;
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

          {props.isPaused && props.doStep && (
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

          {props.doSetBotCount && (
            <Dropdown as={ButtonGroup}>
              <OverlayTrigger
                placement={'bottom'}
                overlay={<Tooltip id={`bot-count`}>Bots per app</Tooltip>}
              >
                <Dropdown.Toggle
                  variant="secondary"
                  id="bot-count-toggle"
                  aria-label="Bots per app"
                >
                  <FaRobot style={{ marginRight: '0.4em' }} />
                  {props.botCount ?? 5}
                </Dropdown.Toggle>
              </OverlayTrigger>
              <Dropdown.Menu>
                {/* Mirrors the server's Environment.MAX_BOT_COUNT
                    (server/src/types/environment.ts) — the UI can't import
                    server code, so extend this list if that constant changes
                    (REST/MCP validation follows it automatically). */}
                {[1, 2, 3, 4, 5].map((count) => (
                  <Dropdown.Item
                    as="button"
                    key={count}
                    active={count === (props.botCount ?? 5)}
                    onClick={() => props.doSetBotCount?.(count)}
                  >
                    {count} {count === 1 ? 'bot' : 'bots'} per app
                  </Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown>
          )}

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
