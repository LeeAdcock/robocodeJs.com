import express from "express";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import path from "path";

import auth from "./middleware/auth";

import healthEndpoints from "./api/health";
import sessionEndpoints from "./api/session";
import userEndpoints from "./api/user";
import appEndpoints from "./api/app";
import arenaEndpoints from "./api/arena";
import helpEndpoints from "./api/help";
import demoEndpoints from "./api/demo";

const app = express();

app.use("/api", [
  // Bound request body sizes: JSON covers the auth credential and small
  // payloads; the octet-stream body is bot source code.
  bodyParser.json({ limit: "256kb" }),
  bodyParser.raw({ type: "application/octet-stream", limit: "64kb" }),
  cookieParser(),
]);
app.use("/", express.static("./dist/public"));

app.use("/api/user", auth(true));

app.use(healthEndpoints);
app.use(sessionEndpoints);
app.use(demoEndpoints);
app.use(helpEndpoints);
app.use(userEndpoints);
app.use(appEndpoints);
app.use(arenaEndpoints);

app.all("*", function (req, res) {
  res.sendFile(path.resolve(__dirname + "/../public/index.html"));
});

const port = 8080;
app.listen(port, () => {
  // tslint:disable-next-line:no-console
  console.log(`server started at http://localhost:${port}`);
});
