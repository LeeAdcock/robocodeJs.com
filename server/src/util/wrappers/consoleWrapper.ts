import TankApp from '../../types/app'
import Arena from '../../types/arena'
import Tank from '../../types/tank'

/*
  This creates "monkey-patched" console wrapper so that logging
  output from the tank can be styled for the browser console as
  well as captured and made visible within the web application's
  user interface.
*/

// Create a console logger for the provided tank
export const createConsoleWrapper = (
  arena:Arena,
  app: TankApp,
  tank: Tank
) => {


}
