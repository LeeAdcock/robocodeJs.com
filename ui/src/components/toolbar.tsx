import React from 'react'
import { Button, ButtonGroup, ButtonToolbar, OverlayTrigger, Tooltip } from 'react-bootstrap'
import { FaCode, FaDownload, FaTrash, FaPlusSquare, FaMinusSquare } from 'react-icons/fa'
import { TankApp } from 'battle-bots'

export default class NavBar extends React.Component<
  {
    tankCount: number
    selectedTankApp: TankApp
    apps: TankApp[]
    addTank: React.MouseEventHandler<JSX.Element | HTMLElement>
    removeTank: React.MouseEventHandler<JSX.Element | HTMLElement>
    removeApp: React.MouseEventHandler<JSX.Element | HTMLElement>
    cleanCode: React.MouseEventHandler<JSX.Element | HTMLElement>
  },
  {}
> {
  constructor(props: any) {
    super(props)
    this.state = {
      error: null,
    }
  }

  shouldComponentUpdate(nextProps, nextState) {
    return (
      this.props.tankCount !== nextProps.tankCount ||
      this.props.selectedTankApp.name !== nextProps.selectedTankApp.name ||
      this.props.selectedTankApp.source !== nextProps.selectedTankApp.source ||
      this.props.apps.length !== nextProps.apps.length
    )
  }

  render() {
    return (
      <>
        <ButtonToolbar>
          <ButtonGroup style={{ marginRight: '5px' }}>
            <OverlayTrigger
              placement={'bottom'}
              overlay={<Tooltip id={`reformat`}>Reformat code</Tooltip>}
            >
              <Button variant="secondary" size="sm" onClick={this.props.cleanCode}>
                <FaCode />
              </Button>
            </OverlayTrigger>
          </ButtonGroup>

          <ButtonGroup style={{ marginRight: '5px' }}>
            <OverlayTrigger
              placement={'bottom'}
              overlay={<Tooltip id={`add`}>Add a new bot using this application logic.</Tooltip>}
            >
              <Button
                variant="secondary"
                disabled={this.props.tankCount === 9}
                size="sm"
                onClick={this.props.addTank}
              >
                <FaPlusSquare />
              </Button>
            </OverlayTrigger>

            <Button disabled={true} variant="secondary" size="sm">
              {this.props.tankCount}
            </Button>
            <OverlayTrigger
              placement={'bottom'}
              overlay={
                <Tooltip id={`remove`}>Remove a bot that is using this application logic.</Tooltip>
              }
            >
              <Button
                variant="secondary"
                size="sm"
                disabled={this.props.selectedTankApp.tanks.length === 0}
                onClick={this.props.removeTank}
              >
                <FaMinusSquare />
              </Button>
            </OverlayTrigger>
          </ButtonGroup>
          <ButtonGroup>
            <OverlayTrigger
              placement={'bottom'}
              overlay={
                <Tooltip id={`delete-app`}>
                  Detroy this application and its bots. Be careful!
                </Tooltip>
              }
            >
              <Button
                variant="secondary"
                size="sm"
                disabled={this.props.apps.length === 1}
                onClick={this.props.removeApp}
              >
                <FaTrash />
              </Button>
            </OverlayTrigger>

            <OverlayTrigger
              placement={'bottom'}
              overlay={
                <Tooltip id={`download-app`}>Download this application as a js file.</Tooltip>
              }
            >
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const link = document.createElement('a')
                  link.download =
                    (this.props.selectedTankApp.name || 'bot').replaceAll(' ', '') + '.js'
                  link.href =
                    'data:text/javascript;charset=utf-8,' +
                    encodeURIComponent(this.props.selectedTankApp.source)
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
}
