/*
  This bot demonstrates a message protocol to share information between
  teammates. Each tick it broadcasts its position and a shared secret as a
  structured message; teammates that see a matching secret steer toward the
  sender, causing the team to cluster together.

  bot.send reaches every bot in the arena — enemies included — so the shared
  `secret` acts as a team tag: messages without it are ignored. Never trust a
  broadcast you didn't send. (A received message also comes with the sender's
  distance, but not its direction, so we still share x/y to steer toward it.)

  Teaches: broadcasting structured messages with bot.send and validating them
  on Event.RECEIVED with a shared team secret.
  Difficulty: intermediate. Pairs with the "Teamwork" (/learn/teamwork) lesson.
  (For using messages to focus-fire an enemy, see the Squad example.)
*/
bot.setName('Magnetic');

let secret = 8; // shared by teammates; identifies our team's messages

bot.on(Event.START, () => {
  bot.turret.setOrientation(0);
  bot.setSpeed(5);
});

clock.on(Event.TICK, () => {
  // Broadcast our team tag and current position as a structured message.
  bot.send({ secret: secret, x: bot.getX(), y: bot.getY() });
});

bot.on(Event.RECEIVED, (message) => {
  // Ignore anything that isn't a well-formed message from a teammate (same
  // secret) — enemies broadcast too, so validate before acting on it.
  if (!message || message.secret !== secret) return;

  // Steer toward the sender's reported position.
  let angle =
    Math.atan2(message.x - bot.getX(), bot.getY() - message.y) *
    (180 / Math.PI);
  let distance = Math.sqrt(
    Math.pow(message.y - bot.getY(), 2) + Math.pow(message.x - bot.getX(), 2)
  );

  return Promise.all([
    bot.setOrientation(angle),
    distance < 50 ? bot.setSpeed(0) : null,
  ]);
});
