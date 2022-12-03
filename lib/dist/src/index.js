"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Compiler = exports.Simulation = exports.Event = exports.Stats = exports.Tank = exports.TankApp = void 0;
const simulation_1 = __importDefault(require("./util/simulation"));
exports.Simulation = simulation_1.default;
const compiler_1 = __importDefault(require("./util/compiler"));
exports.Compiler = compiler_1.default;
const tankApp_1 = __importDefault(require("./types/tankApp"));
exports.TankApp = tankApp_1.default;
const event_1 = require("./types/event");
Object.defineProperty(exports, "Event", { enumerable: true, get: function () { return event_1.Event; } });
const tank_1 = __importStar(require("./types/tank"));
exports.Tank = tank_1.default;
Object.defineProperty(exports, "Stats", { enumerable: true, get: function () { return tank_1.Stats; } });
//# sourceMappingURL=index.js.map