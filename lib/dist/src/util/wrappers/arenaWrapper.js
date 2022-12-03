"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createArenaWrapper = void 0;
const createArenaWrapper = (arenaHeightProvider, arenaWidthProvider) => ({
    getWidth: arenaWidthProvider,
    getHeight: arenaHeightProvider,
});
exports.createArenaWrapper = createArenaWrapper;
//# sourceMappingURL=arenaWrapper.js.map