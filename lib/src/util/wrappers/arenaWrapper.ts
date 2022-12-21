import Arena from '../../types/arena'
/*
  This creates an object that the user-provided code interacts with
  to get the details of the arena.
*/

export const createArenaWrapper = (arena:Arena) =>
  // Arena object visible to the bot application
  ({
    getWidth: () => arena.width,
    getHeight: () => arena.height,
  })
