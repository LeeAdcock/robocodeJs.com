import React from 'react'
import Navbar from 'react-bootstrap/Navbar'
import Nav from 'react-bootstrap/Nav'
import NavDropdown from 'react-bootstrap/NavDropdown'
import OverlayTrigger from 'react-bootstrap/OverlayTrigger'
import Tooltip from 'react-bootstrap/Tooltip'
import { FaSyncAlt, FaPauseCircle, FaPlayCircle } from 'react-icons/fa'
import { colors } from '../util/colors'
import { Link } from 'react-router-dom'
import TankApp from '../types/tankApp'
import User from '../types/user'
import Arena from '../types/arena'

const titleCase = (str: string) =>
    str
        .toLowerCase()
        .split(' ')
        .map(function (word) {
            return word.charAt(0).toUpperCase() + word.slice(1)
        })
        .join(' ')

interface AppLinkProps {
    arena: Arena
    app: TankApp
}

const AppLink = function (props: AppLinkProps) {
    const appIndex = props.arena?.apps
        .map((app) => app.id)
        .indexOf(props.app.id)
    if (appIndex === -1) {
        return <>{titleCase(props.app.name || 'Unknown')}</>
    } else {
        return (
            <>
                <img
                    src={'/sprites/tank_' + colors[appIndex] + '.png'}
                    style={{ height: '1em', marginRight: '5px' }}
                />
                {titleCase(props.app.name || 'Unknown')}
            </>
        )
    }
}

interface NavBarProps {
    apps: TankApp[]
    user: User
    arena: Arena
    isPaused: boolean
    doPause: Function
    doResume: Function
    doRestart: Function
    doSave: Function
    doCreateApp: Function
    doLogin: Function
}

export default function NavBar(props: NavBarProps) {
    return (
        <>
            <Navbar
                bg="dark"
                variant="dark"
                expand="sm"
                style={{ padding: '10px' }}
            >
                <Navbar.Brand className="nav-item">
                    <span
                        style={{
                            fontWeight: '700',
                            fontSize: '1.25em',
                            color: 'gold',
                            fontFamily: 'Megrim',
                            textDecoration: 'none!important',
                        }}
                    >
                        robocode.io
                    </span>
                </Navbar.Brand>
                <Navbar.Toggle aria-controls="basic-navbar-nav" />
                <Navbar.Collapse id="basic-navbar-nav">
                    <Nav>
                        <Navbar.Text>
                            <Link
                                to={{
                                    pathname: '/',
                                }}
                            >
                                <a
                                    className="nav-link"
                                    style={{ padding: '0px' }}
                                >
                                    Home
                                </a>
                            </Link>
                        </Navbar.Text>
                        <Navbar.Text style={{ marginLeft: '10px' }}>
                            |
                        </Navbar.Text>
                        {props.user && (
                            <>
                                <NavDropdown
                                    title="Arena"
                                    id="basic-nav-dropdown"
                                >
                                    <NavDropdown.Item
                                        onClick={() => props.doRestart()}
                                    >
                                        <FaSyncAlt /> Restart
                                    </NavDropdown.Item>
                                    {!props.isPaused && (
                                        <NavDropdown.Item
                                            onClick={() => props.doPause()}
                                        >
                                            <FaPauseCircle /> Pause
                                        </NavDropdown.Item>
                                    )}
                                    {props.isPaused && (
                                        <NavDropdown.Item
                                            onClick={() => props.doResume()}
                                        >
                                            <FaPlayCircle /> Resume
                                        </NavDropdown.Item>
                                    )}
                                </NavDropdown>
                                <Navbar.Text>|</Navbar.Text>
                                <NavDropdown
                                    title="Apps"
                                    id="basic-nav-dropdown"
                                >
                                    {props.apps?.map((app, appIndex) => (
                                        <NavDropdown.Item key={app.id}>
                                            <Link
                                                to={{
                                                    pathname: `/user/${props.user.id}/app/${app.id}`,
                                                }}
                                            >
                                                <AppLink
                                                    arena={props.arena}
                                                    app={app}
                                                />
                                            </Link>
                                        </NavDropdown.Item>
                                    ))}
                                    { props.apps && props.apps.length && <NavDropdown.Divider /> }
                                    <NavDropdown.Item
                                        disabled={props.apps?.length >= 9}
                                        onClick={() => props.doCreateApp()}
                                    >
                                        Create new application
                                    </NavDropdown.Item>
                                    <NavDropdown.Item
                                        onClick={() => {
                                            window.open(
                                                'https://github.com/LeeAdcock/battletank.io/tree/master/docs/samples',
                                                '_new'
                                            )
                                        }}
                                    >
                                        View sample applications
                                    </NavDropdown.Item>
                                </NavDropdown>
                                <Navbar.Text>|</Navbar.Text>
                            </>
                        )}
                        <Nav.Link
                            target="_new"
                            href="https://github.com/LeeAdcock/battletank.io/blob/master/README.md"
                        >
                            Docs
                        </Nav.Link>
                    </Nav>
                </Navbar.Collapse>
                <Navbar.Collapse className="justify-content-end">
                    <Nav>
                        {props.user && (
                            <Nav.Link href={`/user/${props.user?.id}`}>
                                <OverlayTrigger
                                    placement={'bottom'}
                                    overlay={
                                        <Tooltip id={`user`}>
                                            {props.user?.name}
                                        </Tooltip>
                                    }
                                >
                                    <img
                                        src={props.user?.picture}
                                        style={{
                                            borderRadius: '24px',
                                            height: '24px',
                                            width: '24px',
                                        }}
                                    />
                                </OverlayTrigger>
                            </Nav.Link>
                        )}
                        {!props.user && (
                            <Nav.Link onClick={() => props.doLogin()}>
                                Login
                            </Nav.Link>
                        )}
                    </Nav>
                </Navbar.Collapse>
            </Navbar>
        </>
    )
}
