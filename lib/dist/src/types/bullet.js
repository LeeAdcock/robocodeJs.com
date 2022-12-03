"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const point_1 = __importDefault(require("./point"));
class Bullet extends point_1.default {
    constructor() {
        super(...arguments);
        this.id = Math.random();
        this.origin = new point_1.default();
        this.speed = 15;
        this.orientation = 0;
        this.exploded = false;
    }
}
exports.default = Bullet;
//# sourceMappingURL=bullet.js.map