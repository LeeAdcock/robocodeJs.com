import React, { useState } from 'react';
import Button from 'react-bootstrap/Button';
import ButtonGroup from 'react-bootstrap/ButtonGroup';
import ButtonToolbar from 'react-bootstrap/ButtonToolbar';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';
import Modal from 'react-bootstrap/Modal';

import {
  FaCode,
  FaCheck,
  FaDownload,
  FaTrash,
  FaSave,
  FaSearchMinus,
  FaSearchPlus,
  FaPowerOff,
  FaShareAlt,
} from 'react-icons/fa';

import { EDITOR_FONT_MIN, EDITOR_FONT_MAX } from './appEditor';

interface EditorToolbarProps {
  code: string;
  appName: string;
  doDelete: () => void;
  doShare: () => void;
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
  // Deleting an app is destructive and irreversible, so gate the trash button
  // behind a confirmation dialog rather than firing on a single click.
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
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

        {/* Ordered by a typical edit workflow: tidy → check → deploy → reboot. */}
        <ButtonGroup style={{ marginRight: '5px' }}>
          <OverlayTrigger
            placement={'bottom'}
            overlay={<Tooltip id={`reformat`}>Reformat code (Ctrl-R)</Tooltip>}
          >
            <Button
              variant="secondary"
              size="sm"
              aria-label="Reformat code"
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
                (Ctrl-Enter)
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
          {/* Deploy and Reboot carry text labels while the rest of the toolbar
              stays icon-only: they're the two actions the lessons have to name
              in prose, and lesson 1 has to explain the difference between them.
              An icon a beginner needs a parenthetical to identify has failed.
              "Reboot" (not "Restart") matches the API and docs, and leaves
              "restart" meaning the arena. */}
          <OverlayTrigger
            placement={'bottom'}
            overlay={
              <Tooltip id={`deploy`}>
                Deploy — save and update the running bots, keeping their current
                state (does not re-run START). Ctrl-S
              </Tooltip>
            }
          >
            <Button
              variant="secondary"
              size="sm"
              aria-label="Deploy bot"
              onClick={() => props.doExecute()}
            >
              <FaSave /> Deploy
            </Button>
          </OverlayTrigger>
          <OverlayTrigger
            placement={'bottom'}
            overlay={
              <Tooltip id={`reboot`}>
                Reboot — save and update the running bots, then re-run START for
                a fresh start. Ctrl-Shift-S
              </Tooltip>
            }
          >
            <Button
              variant="secondary"
              size="sm"
              aria-label="Reboot bot"
              onClick={() => props.doReboot()}
            >
              <FaPowerOff /> Reboot
            </Button>
          </OverlayTrigger>
        </ButtonGroup>

        <ButtonGroup>
          <OverlayTrigger
            placement={'bottom'}
            overlay={
              <Tooltip id={`share-app`}>
                Copy a share link — anyone who follows it can add this app to
                their own arena (your source stays private).
              </Tooltip>
            }
          >
            <Button
              variant="secondary"
              size="sm"
              aria-label="Copy share link"
              onClick={() => props.doShare()}
            >
              <FaShareAlt />
            </Button>
          </OverlayTrigger>

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
              aria-label="Delete app"
              onClick={() => setShowDeleteConfirm(true)}
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

      <Modal
        show={showDeleteConfirm}
        onHide={() => setShowDeleteConfirm(false)}
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title>Delete this app?</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          Deleting <strong>{props.appName || 'this app'}</strong> permanently
          destroys the application and its bots, and removes it from every
          arena. This can&apos;t be undone.
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={() => setShowDeleteConfirm(false)}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            aria-label="Confirm delete app"
            onClick={() => {
              setShowDeleteConfirm(false);
              props.doDelete();
            }}
          >
            <FaTrash /> Delete app
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
