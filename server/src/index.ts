import express from "express";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import path from "path";

import auth from "./middleware/auth";

import healthEndpoints from "./api/health";
import userEndpoints from "./api/user";
import appEndpoints from "./api/app";
import arenaEndpoints from "./api/arena";
import helpEndpoints from "./api/help";
import demoEndpoints from "./api/demo";

const app = express();

app.use("/api", [
  bodyParser.json({}),
  bodyParser.raw({ type: "application/octet-stream" }),
  cookieParser()
]);
app.use("/", express.static("./dist/public"));

app.use("/api/user", auth(true));

app.use(healthEndpoints);
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
