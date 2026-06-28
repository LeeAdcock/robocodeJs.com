/*
  This bot demonstrates using a message protocol to share information
  between teammates. Each tick it packs its position and a shared secret
  into a single integer message; teammates that decode a matching secret
  steer toward the sender, causing the team to cluster together.

  Message layout (low to high bits): [check:2][y:10][x:10][secret:9]
*/
bot.setName('Magnetic');

let secret = 8; // shared by teammates; 0 - 511

bot.on(Event.START, () => {
  bot.turret.setOrientation(0);
  bot.setSpeed(5);
});

clock.on(Event.TICK, () => {
  // Pack position (0 - 1023 each) and the secret into one integer.
  let x = Math.min(1023, Math.ceil(bot.getX()));
  let y = Math.min(1023, Math.ceil(bot.getY()));
  let content = (secret << 22) | (x << 12) | (y << 2);

  // Append a small check value so corrupt or foreign messages can be rejected.
  let checkDigit = (content >> 2) % 4;
  bot.send(content | checkDigit);
});

bot.on(Event.RECEIVED, (message) => {
  // Reject anything whose check value doesn't match.
  let checkDigit = message & 0x3;
  let content = message & ~0x3;
  if (checkDigit !== (content >> 2) % 4) return;

  // Reject messages that aren't from a teammate (different secret).
  let allegedSecret = (content >> 22) & 0x1ff;
  if (allegedSecret !== secret) return;

  // Decode the sender's position and steer toward it.
  let y = (content >> 2) & 0x3ff;
  let x = (content >> 12) & 0x3ff;
  // North-zero compass heading toward the sender (0 = north/up, clockwise).
  let angle = Math.atan2(x - bot.getX(), bot.getY() - y) * (180 / Math.PI);
  let distance = Math.sqrt(
    Math.pow(y - bot.getY(), 2) + Math.pow(x - bot.getX(), 2)
  );

  return Promise.all([
    bot.setOrientation(angle),
    distance < 50 ? bot.setSpeed(0) : null,
  ]);
});
