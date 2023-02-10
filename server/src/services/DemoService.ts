import appService from "./AppService";
import arenaService from "./ArenaService";
import environmentService from "./EnvironmentService";
import userService from "./UserService";
import Environment from "../types/environment";

let _locked = false;

const getDemoEnvironment = async (): Promise<Environment> => {
  const user = await userService.getDemoUser();

  const arena = await arenaService.getDefaultForUser(user.getId());
  if (!arena) throw new Error("missing arena");

  const apps = await appService.getForUser(user.getId());

  const app1 = apps[0];
  await app1.setName("Demo Bot 1");
  await app1.setSource(`
        bot.turret.setOrientation(0)
        bot.radar.setOrientation(0)

        clock.on(Event.TICK, () => {

        if(Math.random() < .05) bot.turret.setOrientation(-30) 
        if(Math.random() > .95) bot.turret.setOrientation(30) 


        console.log(bot.radar.isReady())  
        
        if(Math.random() < .02) {
            bot.turn(15)
        }
        if(Math.random() < .02) {
            bot.turn(-15)
        }


        if(bot.radar.isReady() && Math.random() > .75) {
            bot.radar.scan().then((targets) => {
            if(targets.find(target=>!target.friendly)) {
                bot.turret.fire()
            }
            })
        }

        if(bot.getX() < 50 || bot.getX() > 700 || bot.getY() < 50 || bot.getY() > 700) {
            bot.setSpeed(2)
            bot.turn(5)
        } else if(bot.getX() < 30 || bot.getX() > 720 || bot.getY() < 30 || bot.getY() > 720) {
            bot.setSpeed(1)
            bot.turn(10)
        } else {
            bot.setSpeed(5)
        }
        
        })   
    `);

  const env = await environmentService.get(arena);
  if (!env.isRunning() && !_locked) {
    _locked = true;
    await env.restart().then(() => {
      env.resume();
      _locked = false;
    });
  }
  return env;
};

export default {
  getDemoEnvironment,
};
