import express from "express";
import Classifier from "ml-classify-text";
import auth, { AuthenticatedRequest } from "../middleware/auth";
import cookieParser from "cookie-parser";

const arena = [
  "how do I create a marker?",
  "how do I get a marker?",
  "How do I calculate distance?",
  "How do I get distance?",
  "how do I calculate angle?",
  "how do I get angle?",
  "how do I calculate bearing?",
  "how do I get bearing?",
  "how do I calculate orientation?",
  "how do I get orientation?",
  "how do i get arena size?",
  "what is the arena size?",
  "how big is the arena?",
  "which direction is up?",
  "which direction is 0 degress?",
  "which direction is north?",
];

const turret = [
  "fire",
  "How do I fire?",
  "How do I use the turret?",
  "How do I fire the turret?",
  "How do I shoot the turret?",
  "why won't the turret shoot?",
  "How to move the turret?",
  "How to aim turret?",
  "Turret won't stay still?",
  "How long until turret ready to fire?",
  "How do I know if I shot something?",
];

const radar = [
  "scan",
  "How do I scan?",
  "How do I scan the radar?",
  "How do I use the radar?",
  "How do I scan with the radar?",
  "How do I find other bots?",
  "what does the radar scan return?",
  "How to move the radar?",
  "How to aim radar?",
  "How to point radar?",
  "Radar won't stay still?",
  "How long until radar ready to scan?",
  "How do I know if I scanned something?",
];

const bot = [
  "move",
  "turn",
  "stop",
  "go",
  "How do move?",
  "How stop the bot?",
  "how do I make the bot move?",
  "why does the bot stop?",
  "how fast does the bot go?",
  "how fast does it go?",
  "how do I turn left?",
  "How do I turn right?",
  "Can the bot turn faster?",
  "How do I turn?",
];

const logs = [
  "how do I view the logs?",
  "how do I get the logs?",
  "where are the logs?",
  "can i get the logs?",
  "how do I view the console?",
  "how do I get the console?",
  "where is the console?",
  "can i get to the console?",
  "where does console.log go",
];

const clock = [
  "how to set an interval timer?",
  "how to set an timeout timer?",
  "how to set a timer?",
  "how to stop a timer?",
  "how to stop an interval?",
  "what is the clock?",
  "how does the clock work?",
  "how do timers work?",
  "what time is it?",
  "what is the time?",
  "what is a clock tick?",
  "how may ticks are in a second?",
  "how fast does it tick?",
];

const classifier = new Classifier();
classifier.train(arena, "arena");
classifier.train(turret, "turret");
classifier.train(logs, "logs");
classifier.train(radar, "radar");
classifier.train(bot, "bot");
classifier.train(clock, "clock");

const app = express();

// Get current user
app.get("/api/ask", [
  cookieParser(),
  auth(false),
  async (req, res) => {
    if (req.query.question) {
      const predictions = classifier.predict(req.query.question);
      if (predictions.length) {
        switch (predictions[0]["_label"]) {
          case "arena":
            return res.send({ answer: "/dev#arena" });
          case "clock":
            return res.send({ answer: "/dev#clock" });
          case "bot":
            return res.send({ answer: "/dev#bot" });
          case "radar":
            return res.send({ answer: "/dev#radar" });
          case "turret":
            return res.send({ answer: "/dev#turret" });
          case "logs": {
            const user = (req as unknown as AuthenticatedRequest).user;
            if (user)
              return res.send({ answer: `/user/${user.getId()}/arena/logs` });
            else return res.send({ answer: "/dev#consolelogging" });
          }
          default:
            return res.send({ answer: "/help" });
        }
      }
    }
    return res.send({ answer: "/help" });
  },
]);

export default app;
