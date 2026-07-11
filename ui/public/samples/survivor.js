/*
  Survivor — stays alive first, fights second.

  Teaches: reading your own health with bot.getHealth() and using THRESHOLDS to
  switch behavior, DODGING incoming fire on Event.HIT, and reacting to
  Event.DETECTED (an enemy's radar swept over you). It picks fights when healthy
  and runs and weaves when hurt.
  Difficulty: intermediate. Pairs with the "Survival" (/learn/survival) lesson.
*/

bot.setName('Survivor');

const HURT = 50; // below this, stop pressing the attack and play cautious
const DANGER = 25; // below this, drop everything and flee

bot.on(Event.START, () => {
  bot.setSpeed(3);
  bot.radar.setOrientation(0);
  bot.turret.setOrientation(0);
});

clock.on(Event.TICK, async () => {
  const health = bot.getHealth();

  // Critical health: full speed, weave hard, and don't stop to shoot.
  if (health < DANGER) {
    bot.setSpeed(5);
    if (!bot.isTurning()) bot.turn(60).catch(() => {});
    return;
  }

  // Healthy enough to look for a fight. Scan, and only commit to a shot while
  // our health is good — a hurt Survivor keeps moving instead.
  const targets = await bot.radar
    .onReady()
    .then(bot.radar.scan)
    .catch(() => []);
  const enemy = targets.find((t) => !t.friendly);

  if (enemy && health > HURT) {
    bot.turret.setOrientation(enemy.angle).catch(() => {});
    if (bot.turret.isReady()) bot.turret.fire().catch(() => {});
    bot.setSpeed(3);
  } else {
    // Hurt, or nothing to shoot at — keep roaming and searching.
    bot.setSpeed(4);
    if (!bot.isTurning()) bot.turn(20).catch(() => {});
  }
});

bot.on(Event.HIT, (info) => {
  // A bullet hit us. info.angle points back at the shooter, relative to our
  // heading, so we turn BY it. Badly hurt? Turn straight away (+180) to flee;
  // otherwise veer sideways (+90) to dodge the next shot but stay in the fight.
  const escape = bot.getHealth() < HURT ? 180 : 90;
  bot.turn(info.angle + escape).catch(() => {});
});

bot.on(Event.DETECTED, () => {
  // An enemy's radar found us — we're a target now. Break their aim by speeding
  // up and changing course before their shot arrives.
  bot.setSpeed(5);
  if (!bot.isTurning()) bot.turn(45).catch(() => {});
});
