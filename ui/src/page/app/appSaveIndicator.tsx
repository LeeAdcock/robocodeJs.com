import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';
import { FaCircle, FaCloudUploadAlt, FaCheck } from 'react-icons/fa';

// Where the buffer stands relative to the source the server (and therefore the
// arena) is running. 'loading' is the pre-first-load state, where there is
// nothing to compare against yet.
export type SaveState = 'loading' | 'saved' | 'unsaved' | 'saving';

// The core loop is edit → save → watch the arena react, so the editor says at
// all times which side of the save the buffer is on. This sits with the app
// name rather than in the button toolbar: the label's width changes with the
// state, and inside the toolbar's flex row that shifted the buttons and wrapped
// them onto a second line.
export default function SaveIndicator({ saveState }: { saveState: SaveState }) {
  if (saveState === 'loading') return null;
  const { icon, label, tooltip, color } =
    saveState === 'saving'
      ? {
          icon: <FaCloudUploadAlt />,
          label: 'Saving…',
          tooltip: 'Sending your code to the arena.',
          color: undefined,
        }
      : saveState === 'unsaved'
        ? {
            icon: <FaCircle style={{ fontSize: '0.6em' }} />,
            label: 'Unsaved changes',
            tooltip:
              'Your bots are still running the last deployed code. Press Deploy (Ctrl-S) to update them now — otherwise this happens automatically 30 seconds after you stop typing.',
            color: 'var(--link)',
          }
        : {
            // Saving is what deploys: propagateSource re-executes the source in
            // every arena the app is in, so by the time this reads "Saved and
            // Deployed" the bots really are running it — including after a
            // silent autosave. "Saved" alone would undersell that, and whether
            // the arena has your code is the whole question lesson 1's FAQ asks.
            icon: <FaCheck />,
            label: 'Saved and Deployed',
            tooltip: 'Your bots are running this code.',
            color: 'var(--code)',
          };
  return (
    <OverlayTrigger
      placement={'bottom'}
      overlay={<Tooltip id={`save-state`}>{tooltip}</Tooltip>}
    >
      <span
        // Announced on change so the state is available without seeing it.
        role="status"
        aria-live="polite"
        style={{
          marginLeft: '10px',
          fontSize: '0.85em',
          whiteSpace: 'nowrap',
          color,
          opacity: 0.85,
          cursor: 'default',
        }}
      >
        <span style={{ marginRight: '4px' }}>{icon}</span>
        {label}
      </span>
    </OverlayTrigger>
  );
}
