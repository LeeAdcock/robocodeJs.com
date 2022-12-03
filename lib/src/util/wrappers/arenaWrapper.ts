/*
  This creates an object that the user-provided code interacts with
  to get the details of the arena.
*/

export const createArenaWrapper = (arenaHeightProvider: Function, arenaWidthProvider: Function) =>
  // Arena object visible to the bot application
  ({
    getWidth: arenaWidthProvider,
    getHeight: arenaHeightProvider,
  })
