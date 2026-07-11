/*
  This bot demonstrates the use of one-shot timers
  and scheduled interval timers.

  Teaches: setInterval / setTimeout scheduled by clock ticks (not real time).
  Difficulty: beginner. Pairs with the "Timers" (/learn/timers) lesson.
*/
bot.setName('Chronometer');

bot.on(Event.START, () => {
  // Turn after every 10 clock ticks
  setInterval(() => {
    bot.turn(15);
    bot.turret.turn(-15);
  }, 10);

  // Dash forward for ever 50 clock ticks
  setInterval(() => {
    bot.setSpeed(5);
    setTimeout(() => bot.setSpeed(0), 10);
  }, 50);
});
